import { db, type ReportReason, sql, type Tx } from "@klipstack/db"
import { emailT } from "@klipstack/email"
import { errorLabel } from "@klipstack/log"
import {
	ADMIN_LIMITS,
	type AdminContext,
	adminMutation,
	assertAdminContext,
	auditActor,
	checkAdminLimit,
} from "~/lib/admin.server"
import { AppError, notFound } from "~/lib/app-error"
import { REMOVAL_NOTE_MAX } from "~/lib/edition-reports"
import { editionTitle } from "~/lib/editions"
import { renderEmail, sendEmail } from "~/lib/email.server"
import { env } from "~/lib/env.server"
import { SUPPORT_CONTACT } from "~/lib/privacy-policy/types"
import { recordAudit } from "./admin-audit.server"

/** Editions the queue shows at once, and reports under each. */
export const REPORTED_EDITIONS_MAX = 50
export const REPORTS_SHOWN_MAX = 20

export interface AdminReport {
	id: string
	reason: ReportReason
	details: string
	email: string | null
	createdAt: string
}

export interface AdminReportedEdition {
	/** What is reported: a public edition, or a shared highlight. */
	kind: "edition" | "share"
	id: string
	publicId: string
	/** The public page. */
	href: string
	/** The public page's title, as readers saw it. */
	title: string
	owner: { id: string; name: string }
	/** Every open report on it; `reports` holds the newest `REPORTS_SHOWN_MAX`. */
	count: number
	reports: AdminReport[]
}

export interface AdminRemovedEdition {
	kind: "edition" | "share"
	id: string
	publicId: string
	href: string
	title: string
	owner: { id: string; name: string }
	ground: ReportReason
	note: string
	removedAt: string
}

/**
 * What makes the public page's title, as readers saw it: its published title, else the date of its
 * first publish, as the page showed it (`shownTitle`). Only published editions get reports.
 */
const TITLE = sql`e.published->>'title' as title, e.published_at, e.time_zone, e.locale`
type TitleColumns = {
	title: string | null
	published_at: string | null
	time_zone: string
	locale: string
}

function shownTitle(row: TitleColumns): string {
	if (!row.published_at) return row.title ?? ""
	const published = { publishedAt: new Date(row.published_at), ...row, timeZone: row.time_zone }
	return editionTitle(row.title, published)
}

/** Editions with open reports, the most recently reported first, with their reports. */
export async function listReportedEditions(ctx: AdminContext): Promise<AdminReportedEdition[]> {
	assertAdminContext(ctx)
	const result = await db.execute<
		TitleColumns & {
			id: string
			public_id: string
			owner_id: string
			owner_name: string
			count: number
			reports: Array<{
				id: string
				reason: ReportReason
				details: string
				email: string | null
				created_at: string
			}>
		}
	>(sql`
		select e.id, e.public_id, ${TITLE}, u.id as owner_id, u.name as owner_name,
			(select count(*)::int from edition_reports r where r.edition_id = e.id) as count,
			(
				select json_agg(r order by r.created_at desc) from (
					select r.id, r.reason, r.details, r.email, r.created_at from edition_reports r
					where r.edition_id = e.id order by r.created_at desc limit ${REPORTS_SHOWN_MAX}
				) r
			) as reports
		from editions e
		join "user" u on u.id = e.user_id
		where exists (select 1 from edition_reports r where r.edition_id = e.id)
		order by (select max(r.created_at) from edition_reports r where r.edition_id = e.id) desc, e.id
		limit ${REPORTED_EDITIONS_MAX}
	`)
	return result.rows.map((row) => ({
		kind: "edition" as const,
		id: row.id,
		publicId: row.public_id,
		href: `/e/${row.public_id}`,
		title: shownTitle(row),
		owner: { id: row.owner_id, name: row.owner_name },
		count: row.count,
		reports: (row.reports ?? []).map((report) => ({
			id: report.id,
			reason: report.reason,
			details: report.details,
			email: report.email,
			createdAt: new Date(report.created_at).toISOString(),
		})),
	}))
}

/** Editions an admin took down, the latest first: the place to undo a mistake. */
export async function listRemovedEditions(ctx: AdminContext): Promise<AdminRemovedEdition[]> {
	assertAdminContext(ctx)
	const result = await db.execute<
		TitleColumns & {
			id: string
			public_id: string
			owner_id: string
			owner_name: string
			removed_ground: ReportReason
			removed_note: string
			removed_at: string
		}
	>(sql`
		select e.id, e.public_id, ${TITLE}, u.id as owner_id, u.name as owner_name,
			e.removed_ground, e.removed_note, e.removed_at
		from editions e join "user" u on u.id = e.user_id
		where e.removed_at is not null
		order by e.removed_at desc, e.id
		limit ${REPORTED_EDITIONS_MAX}
	`)
	return result.rows.map((row) => ({
		kind: "edition" as const,
		id: row.id,
		publicId: row.public_id,
		href: `/e/${row.public_id}`,
		title: shownTitle(row),
		owner: { id: row.owner_id, name: row.owner_name },
		ground: row.removed_ground,
		note: row.removed_note,
		removedAt: new Date(row.removed_at).toISOString(),
	}))
}

type Reporter = { email: string; locale: string }

/** Deletes the page's open reports; the addresses that came with them, once each. */
async function closeReports(
	tx: Tx,
	id: string,
	kind: "edition" | "share" = "edition",
): Promise<{ count: number; reporters: Reporter[] }> {
	const closed = await tx.execute<{ email: string | null; locale: string }>(
		kind === "edition"
			? sql`delete from edition_reports where edition_id = ${id}::uuid returning email, locale`
			: sql`delete from edition_reports where share_id = ${id}::uuid returning email, locale`,
	)
	const reporters = new Map<string, Reporter>()
	for (const row of closed.rows) if (row.email) reporters.set(row.email, row as Reporter)
	return { count: closed.rows.length, reporters: [...reporters.values()] }
}

/** Sends after the commit; a failure is logged by kind (it may name the address) and counted. */
async function sendAll(emails: Array<Parameters<typeof sendEmail>[0]>): Promise<number> {
	let sent = 0
	for (const email of emails) {
		try {
			await sendEmail(email)
			sent++
		} catch (error) {
			console.warn(`[reports] email failed: ${errorLabel(error)}`)
		}
	}
	return sent
}

function reporterEmail(
	{ email, locale }: Reporter,
	outcome: "removed" | "kept",
	title: string,
): Parameters<typeof sendEmail>[0] {
	const t = emailT(locale, "editions")
	const subject = t(`report.outcome.${outcome}Subject`)
	return {
		to: email,
		subject,
		...renderEmail({
			heading: subject,
			body: t(`report.outcome.${outcome}Body`, { title }),
			footer: t("report.outcome.footer"),
		}),
	}
}

/**
 * Takes a public edition down: it is unpublished, and the owner cannot publish it again until an
 * admin restores it. Its open reports close. After the commit the owner is told why (the ground,
 * the admin's note, that a person decided, and where to object), and each reporter who left an
 * address is told the decision.
 */
export async function removeEdition(
	ctx: AdminContext,
	editionId: string,
	{ ground, note }: { ground: ReportReason; note: string },
): Promise<{ reports: number; ownerEmailed: boolean; reportersEmailed: number }> {
	const clean = note.trim()
	if (!clean || clean.length > REMOVAL_NOTE_MAX)
		throw new AppError("invalid_request", `Write why, in ${REMOVAL_NOTE_MAX} characters at most.`)
	const removed = await adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.reportDecide, ctx.userId)
		const found = await tx.execute<
			TitleColumns & {
				owner_id: string
				owner_email: string
				owner_locale: string | null
				removed_at: string | null
			}
		>(sql`
			select ${TITLE}, u.id as owner_id, u.email as owner_email,
				u.locale as owner_locale, e.removed_at
			from editions e join "user" u on u.id = e.user_id
			where e.id = ${editionId}::uuid
			for update of e
		`)
		const edition = found.rows[0]
		// Removed already, by another admin a moment ago: it is gone from the queue as well.
		if (!edition || edition.removed_at) throw notFound("No such edition, or it is removed already.")
		await tx.execute(sql`
			update editions set removed_at = now(), removed_ground = ${ground}, removed_note = ${clean},
				unpublished_at = coalesce(unpublished_at, now())
			where id = ${editionId}::uuid
		`)
		const { count, reporters } = await closeReports(tx, editionId)
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "edition.remove",
			targetKind: "edition",
			targetId: editionId,
			correlationId: ctx.correlationId,
			metadata: { ownerId: edition.owner_id, ground, reports: count },
		})
		return { ...edition, title: shownTitle(edition), count, reporters }
	})

	const t = emailT(removed.owner_locale, "editions")
	const subject = t("removal.email.subject", { title: removed.title })
	const groundText = t(`removal.grounds.${ground}`)
	const owner = {
		to: removed.owner_email,
		subject,
		...renderEmail({
			heading: subject,
			body: [
				t("removal.email.body", { title: removed.title, ground: groundText }),
				t("removal.email.note", { note: clean }),
				t("removal.email.facts"),
				t("removal.email.terms", { url: new URL("/terms#editions", env.APP_URL).href }),
				t("removal.email.contest", { contact: SUPPORT_CONTACT }),
			].join("\n\n"),
			footer: t("removal.email.footer"),
		}),
	}
	const ownerEmailed = (await sendAll([owner])) === 1
	const reportersEmailed = await sendAll(
		removed.reporters.map((reporter) => reporterEmail(reporter, "removed", removed.title)),
	)
	return { reports: removed.count, ownerEmailed, reportersEmailed }
}

/** Closes an edition's reports and leaves it up; reporters who left an address are told so. */
export async function dismissReports(
	ctx: AdminContext,
	editionId: string,
): Promise<{ reports: number; reportersEmailed: number }> {
	const dismissed = await adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.reportDecide, ctx.userId)
		const found = await tx.execute<TitleColumns>(
			sql`select ${TITLE} from editions e where e.id = ${editionId}::uuid for update`,
		)
		const edition = found.rows[0]
		if (!edition) throw notFound("No such edition.")
		const { count, reporters } = await closeReports(tx, editionId)
		if (count === 0) throw notFound("That edition has no open reports.")
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "edition_reports.dismiss",
			targetKind: "edition",
			targetId: editionId,
			correlationId: ctx.correlationId,
			metadata: { reports: count },
		})
		return { title: shownTitle(edition), count, reporters }
	})
	const reportersEmailed = await sendAll(
		dismissed.reporters.map((reporter) => reporterEmail(reporter, "kept", dismissed.title)),
	)
	return { reports: dismissed.count, reportersEmailed }
}

/**
 * Undoes a removal: the owner may publish the edition again. It stays unpublished until they do.
 * Nobody is emailed.
 */
export function restoreEdition(ctx: AdminContext, editionId: string): Promise<{ changed: true }> {
	return adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.editionRestore, ctx.userId)
		const restored = await tx.execute<{ owner_id: string }>(sql`
			update editions set removed_at = null, removed_ground = null, removed_note = null
			where id = ${editionId}::uuid and removed_at is not null
			returning user_id as owner_id
		`)
		const row = restored.rows[0]
		if (!row) throw notFound("No removed edition with that id.")
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "edition.restore",
			targetKind: "edition",
			targetId: editionId,
			correlationId: ctx.correlationId,
			metadata: { ownerId: row.owner_id },
		})
		return { changed: true as const }
	})
}

// ---- shared highlights ----

/**
 * What names a shared highlight to admins and in emails: the start of its quote and its article,
 * from the snapshot (kept while it is removed).
 */
const SHARE_TITLE = sql`s.published->>'exact' as exact, s.published->'article'->>'title' as article`
type ShareTitleColumns = { exact: string | null; article: string | null }

function shareTitle(row: ShareTitleColumns): string {
	const quote = (row.exact ?? "").replace(/\s+/g, " ").trim()
	const short = quote.length > 80 ? `${quote.slice(0, 79).trimEnd()}…` : quote
	return [short || null, row.article].filter(Boolean).join(" — ")
}

/** Shared highlights with open reports, the most recently reported first, with their reports. */
export async function listReportedShares(ctx: AdminContext): Promise<AdminReportedEdition[]> {
	assertAdminContext(ctx)
	const result = await db.execute<
		ShareTitleColumns & {
			id: string
			public_id: string
			owner_id: string
			owner_name: string
			count: number
			reports: Array<{
				id: string
				reason: ReportReason
				details: string
				email: string | null
				created_at: string
			}>
		}
	>(sql`
		select s.id, s.public_id, ${SHARE_TITLE}, u.id as owner_id, u.name as owner_name,
			(select count(*)::int from edition_reports r where r.share_id = s.id) as count,
			(
				select json_agg(r order by r.created_at desc) from (
					select r.id, r.reason, r.details, r.email, r.created_at from edition_reports r
					where r.share_id = s.id order by r.created_at desc limit ${REPORTS_SHOWN_MAX}
				) r
			) as reports
		from highlight_shares s
		join "user" u on u.id = s.user_id
		where exists (select 1 from edition_reports r where r.share_id = s.id)
		order by (select max(r.created_at) from edition_reports r where r.share_id = s.id) desc, s.id
		limit ${REPORTED_EDITIONS_MAX}
	`)
	return result.rows.map((row) => ({
		kind: "share" as const,
		id: row.id,
		publicId: row.public_id,
		href: `/h/${row.public_id}`,
		title: shareTitle(row),
		owner: { id: row.owner_id, name: row.owner_name },
		count: row.count,
		reports: (row.reports ?? []).map((report) => ({
			id: report.id,
			reason: report.reason,
			details: report.details,
			email: report.email,
			createdAt: new Date(report.created_at).toISOString(),
		})),
	}))
}

/** Shared highlights an admin took down, the latest first. */
export async function listRemovedShares(ctx: AdminContext): Promise<AdminRemovedEdition[]> {
	assertAdminContext(ctx)
	const result = await db.execute<
		ShareTitleColumns & {
			id: string
			public_id: string
			owner_id: string
			owner_name: string
			removed_ground: ReportReason
			removed_note: string
			removed_at: string
		}
	>(sql`
		select s.id, s.public_id, ${SHARE_TITLE}, u.id as owner_id, u.name as owner_name,
			s.removed_ground, s.removed_note, s.removed_at
		from highlight_shares s join "user" u on u.id = s.user_id
		where s.removed_at is not null
		order by s.removed_at desc, s.id
		limit ${REPORTED_EDITIONS_MAX}
	`)
	return result.rows.map((row) => ({
		kind: "share" as const,
		id: row.id,
		publicId: row.public_id,
		href: `/h/${row.public_id}`,
		title: shareTitle(row),
		owner: { id: row.owner_id, name: row.owner_name },
		ground: row.removed_ground,
		note: row.removed_note,
		removedAt: new Date(row.removed_at).toISOString(),
	}))
}

/**
 * Takes a shared highlight down: its page says an admin removed it, and the owner cannot share it
 * again until an admin restores it. Its open reports close. After the commit the owner is told why,
 * and each reporter who left an address is told the decision, as for editions.
 */
export async function removeShare(
	ctx: AdminContext,
	shareId: string,
	{ ground, note }: { ground: ReportReason; note: string },
): Promise<{ reports: number; ownerEmailed: boolean; reportersEmailed: number }> {
	const clean = note.trim()
	if (!clean || clean.length > REMOVAL_NOTE_MAX)
		throw new AppError("invalid_request", `Write why, in ${REMOVAL_NOTE_MAX} characters at most.`)
	const removed = await adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.reportDecide, ctx.userId)
		const found = await tx.execute<
			ShareTitleColumns & {
				owner_id: string
				owner_email: string
				owner_locale: string | null
				removed_at: string | null
			}
		>(sql`
			select ${SHARE_TITLE}, u.id as owner_id, u.email as owner_email,
				u.locale as owner_locale, s.removed_at
			from highlight_shares s join "user" u on u.id = s.user_id
			where s.id = ${shareId}::uuid
			for update of s
		`)
		const share = found.rows[0]
		if (!share || share.removed_at)
			throw notFound("No such shared highlight, or it is removed already.")
		await tx.execute(sql`
			update highlight_shares set removed_at = now(), removed_ground = ${ground},
				removed_note = ${clean}
			where id = ${shareId}::uuid
		`)
		const { count, reporters } = await closeReports(tx, shareId, "share")
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "share.remove",
			targetKind: "highlight_share",
			targetId: shareId,
			correlationId: ctx.correlationId,
			metadata: { ownerId: share.owner_id, ground, reports: count },
		})
		return { ...share, title: shareTitle(share), count, reporters }
	})

	const t = emailT(removed.owner_locale, "editions")
	const subject = t("shareRemoval.email.subject")
	const groundText = t(`removal.grounds.${ground}`)
	const owner = {
		to: removed.owner_email,
		subject,
		...renderEmail({
			heading: subject,
			body: [
				t("shareRemoval.email.body", { title: removed.title, ground: groundText }),
				t("removal.email.note", { note: clean }),
				t("shareRemoval.email.facts"),
				t("shareRemoval.email.terms", { url: new URL("/terms#editions", env.APP_URL).href }),
				t("removal.email.contest", { contact: SUPPORT_CONTACT }),
			].join("\n\n"),
			footer: t("shareRemoval.email.footer"),
		}),
	}
	const ownerEmailed = (await sendAll([owner])) === 1
	const reportersEmailed = await sendAll(
		removed.reporters.map((reporter) => reporterEmail(reporter, "removed", removed.title)),
	)
	return { reports: removed.count, ownerEmailed, reportersEmailed }
}

/** Closes a shared highlight's reports and leaves it up; reporters who left an address are told. */
export async function dismissShareReports(
	ctx: AdminContext,
	shareId: string,
): Promise<{ reports: number; reportersEmailed: number }> {
	const dismissed = await adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.reportDecide, ctx.userId)
		const found = await tx.execute<ShareTitleColumns>(
			sql`select ${SHARE_TITLE} from highlight_shares s where s.id = ${shareId}::uuid for update`,
		)
		const share = found.rows[0]
		if (!share) throw notFound("No such shared highlight.")
		const { count, reporters } = await closeReports(tx, shareId, "share")
		if (count === 0) throw notFound("That shared highlight has no open reports.")
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "share_reports.dismiss",
			targetKind: "highlight_share",
			targetId: shareId,
			correlationId: ctx.correlationId,
			metadata: { reports: count },
		})
		return { title: shareTitle(share), count, reporters }
	})
	const reportersEmailed = await sendAll(
		dismissed.reporters.map((reporter) => reporterEmail(reporter, "kept", dismissed.title)),
	)
	return { reports: dismissed.count, reportersEmailed }
}

/**
 * Undoes a removal: the owner may share the highlight again, at a new address. Until they do, it
 * is not shared, and what it showed is dropped. Nobody is emailed.
 */
export function restoreShare(ctx: AdminContext, shareId: string): Promise<{ changed: true }> {
	return adminMutation(ctx, async (tx) => {
		await checkAdminLimit(tx, ADMIN_LIMITS.editionRestore, ctx.userId)
		const restored = await tx.execute<{ owner_id: string }>(sql`
			update highlight_shares set removed_at = null, removed_ground = null, removed_note = null,
				published = null
			where id = ${shareId}::uuid and removed_at is not null
			returning user_id as owner_id
		`)
		const row = restored.rows[0]
		if (!row) throw notFound("No removed shared highlight with that id.")
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "share.restore",
			targetKind: "highlight_share",
			targetId: shareId,
			correlationId: ctx.correlationId,
			metadata: { ownerId: row.owner_id },
		})
		return { changed: true as const }
	})
}
