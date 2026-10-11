import { ArticleTitle, Id, Ids, TagNames } from "@klipstack/api-contract"
import {
	and,
	db,
	documentRaw,
	documentSearchVector,
	documents,
	documentVia,
	eq,
	inArray,
	isNotNull,
	isNull,
	notifyDocumentEvent,
	readingCompletions,
	sql,
	type Tx,
} from "@klipstack/db"
import { admitExtract } from "@klipstack/queue"
import { z } from "zod"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { READ_PROGRESS } from "~/lib/inbox-filters"
import { isUniqueViolation } from "~/lib/postgres-errors.server"
import {
	type Before,
	type Column,
	emptyUndo,
	revertChanges,
	type UndoRecord,
} from "~/services/article-undo.server"
import {
	getDocument,
	INBOX_FILTER_WHERE,
	liveDuplicateOf,
	restoreDocument,
} from "~/services/documents.server"
import { addToDraft, currentDraft, draftCopies, removeFromDraft } from "~/services/editions.server"
import { changeTagsIn } from "~/services/tags.server"

/**
 * Changes to the user's articles, for the web, the API and MCP alike. Changes act on the user's
 * articles that are not in the trash, failed saves included; a change to one article is a batch of
 * one.
 */

export const NO_ARTICLE = "No article with that id in the library."

const idList = Ids.transform((ids) => [...new Set(ids)])
const one = (id: string) => parseInput(Id, id)

const CHANGES = [
	"location",
	"starred",
	"shortlisted",
	"finished",
	"addTags",
	"removeTags",
	"title",
	"kept",
] as const

const ArticleUpdate = z
	.object({
		ids: idList,
		/** The library (inbox) or the archive. Back in the library, an article is no longer finished. */
		location: z.enum(["inbox", "archive"]).optional(),
		starred: z.boolean().optional(),
		/** For the next edition. */
		shortlisted: z.boolean().optional(),
		/** true finishes (and archives); false marks unread. */
		finished: z.boolean().optional(),
		addTags: TagNames.optional(),
		/** A tag an article does not have is left alone. */
		removeTags: TagNames.optional(),
		/** Only with a single article. */
		title: ArticleTitle.optional(),
		/**
		 * Kept when reviewing old saves: not suggested for letting go for a while. Web only, for now.
		 * Keeping again starts that while again.
		 */
		kept: z.boolean().optional(),
	})
	.refine((v) => CHANGES.some((key) => v[key] !== undefined), {
		// Without `kept`: only the web keeps, and MCP callers get this message.
		message: `Pass at least one change: ${CHANGES.filter((key) => key !== "kept").join(", ")}.`,
	})
	.refine((v) => !(v.finished === true && v.location === "inbox"), {
		message: "finished: true moves articles to the archive; they cannot also go to the library.",
		path: ["location"],
	})
	.refine((v) => v.title === undefined || v.ids.length === 1, {
		message: "A title applies to a single article.",
		path: ["title"],
	})

export type ArticleUpdate = z.input<typeof ArticleUpdate>
export type ArticleChanges = Omit<ArticleUpdate, "ids">

type Row = { id: string; title: string | null } & Record<Column, string | number | null>

/** Per state change: the articles it changes (the rest are left alone), and the columns it writes. */
const PLANS = {
	star: { changes: (r: Row) => r.starredAt === null, columns: ["starredAt"] },
	unstar: { changes: (r: Row) => r.starredAt !== null, columns: ["starredAt"] },
	shortlist: { changes: (r: Row) => r.shortlistedAt === null, columns: ["shortlistedAt"] },
	unshortlist: { changes: (r: Row) => r.shortlistedAt !== null, columns: ["shortlistedAt"] },
	keep: { changes: () => true, columns: ["keptAt"] },
	unkeep: { changes: (r: Row) => r.keptAt !== null, columns: ["keptAt"] },
	archive: { changes: (r: Row) => r.archivedAt === null, columns: ["archivedAt"] },
	unarchive: {
		changes: (r: Row) => r.archivedAt !== null,
		columns: ["archivedAt", "readAt", "readingProgress", "readingPosition", "readingCycle"],
	},
	// Finishing archives: a finished article still in the library is finished again, into the archive.
	finish: {
		changes: (r: Row) => r.readAt === null || r.archivedAt === null,
		columns: ["readAt", "readingProgress", "firstOpenedAt", "archivedAt", "lastReadAt"],
	},
	unread: {
		changes: (r: Row) =>
			r.firstOpenedAt !== null || r.readAt !== null || Number(r.readingProgress) > 0,
		columns: [
			"firstOpenedAt",
			"readingProgress",
			"readingPosition",
			"readAt",
			"lastReadAt",
			"readingCycle",
		],
	},
} satisfies Record<string, { changes: (r: Row) => boolean; columns: Column[] }>
type StateChange = keyof typeof PLANS

/**
 * The state changes asked for, in the order they apply: finished, where it is, the star, the mark
 * for the next edition, kept.
 */
function stateChanges(v: z.output<typeof ArticleUpdate>): StateChange[] {
	const out: StateChange[] = []
	if (v.finished !== undefined) out.push(v.finished ? "finish" : "unread")
	if (v.location) out.push(v.location === "archive" ? "archive" : "unarchive")
	if (v.starred !== undefined) out.push(v.starred ? "star" : "unstar")
	if (v.shortlisted !== undefined) out.push(v.shortlisted ? "shortlist" : "unshortlist")
	if (v.kept !== undefined) out.push(v.kept ? "keep" : "unkeep")
	return out
}

const selection = {
	id: documents.id,
	title: documents.title,
	starredAt: sql<string | null>`${documents.starredAt}::text`,
	shortlistedAt: sql<string | null>`${documents.shortlistedAt}::text`,
	archivedAt: sql<string | null>`${documents.archivedAt}::text`,
	readAt: sql<string | null>`${documents.readAt}::text`,
	firstOpenedAt: sql<string | null>`${documents.firstOpenedAt}::text`,
	lastReadAt: sql<string | null>`${documents.lastReadAt}::text`,
	keptAt: sql<string | null>`${documents.keptAt}::text`,
	readingProgress: documents.readingProgress,
	readingPosition: documents.readingPosition,
	readingCycle: documents.readingCycle,
}

const owned = (userId: string, ids: string[]) =>
	and(eq(documents.userId, userId), inArray(documents.id, ids))

/**
 * Moves, stars, marks for the next edition, finishes, keeps, tags or renames the user's articles among `ids`, all in one transaction
 * with the rows locked: a refusal (too many tags) changes nothing. `changed` names the articles
 * that changed (the others were that way already); `undo` puts them back (`undoChanges`).
 * With a draft in progress, the mark is being in it: marking adds the articles to it (those with a
 * web address), unmarking takes them out. `draft` names the articles added or taken out.
 */
export async function updateArticles(
	userId: string,
	input: ArticleUpdate,
): Promise<{
	found: string[]
	notFound: string[]
	changed: string[]
	undo: UndoRecord
	draft: { added: string[]; removed: string[] }
}> {
	const update = parseInput(ArticleUpdate, input)
	const { ids } = update
	// Marking with a draft in progress: the copies it takes, made first, as `addItem` makes them.
	const ahead = update.shortlisted ? await currentDraft(db, userId) : null
	const copies = ahead ? await draftCopies(userId, ahead, ids) : new Map()
	return db.transaction(async (tx) => {
		// The draft before the articles: the order every change takes its locks in.
		const draft = update.shortlisted === undefined ? null : await currentDraft(tx, userId, true)
		const rows = (await tx
			.select(selection)
			.from(documents)
			.where(and(owned(userId, ids), isNull(documents.deletedAt)))
			.for("update")) as Row[]
		const found = new Set(rows.map((r) => r.id))
		const changed = new Set<string>()
		const undo = emptyUndo()
		const inDraft = { added: [] as string[], removed: [] as string[] }
		const before = new Map<string, Before>()
		const record = (row: Row, columns: Column[]) => {
			const entry = before.get(row.id) ?? { id: row.id }
			for (const column of columns) if (!(column in entry)) entry[column] = row[column]
			before.set(row.id, entry)
			changed.add(row.id)
		}
		for (const change of stateChanges(update)) {
			const plan = PLANS[change]
			const affected = rows.filter(plan.changes)
			for (const row of affected) record(row, plan.columns)
			if (affected.length > 0) await applyState(tx, userId, change, affected, undo)
		}
		if (draft && update.shortlisted !== undefined) {
			// In the order given: the draft takes them in it.
			const live = ids.filter((id) => found.has(id))
			const done = update.shortlisted
				? await addToDraft(tx, draft, live, copies)
				: await removeFromDraft(tx, draft, live)
			for (const id of done.documentIds) changed.add(id)
			if (done.documentIds.length > 0) undo.draft = done.change
			inDraft[update.shortlisted ? "added" : "removed"] = done.documentIds
		}
		if (update.addTags || update.removeTags) {
			const tags = await changeTagsIn(tx, {
				userId,
				documentIds: [...found],
				add: update.addTags,
				remove: update.removeTags,
			})
			undo.tagLinks = tags.added
			undo.removedLinks = tags.removed
			undo.tags = tags.created
			for (const link of [...tags.added, ...tags.removed]) changed.add(link.documentId)
		}
		const [row] = rows
		if (update.title !== undefined && row && row.title !== update.title) {
			await tx
				.update(documents)
				.set(titleSet(update.title))
				.where(owned(userId, [row.id]))
			changed.add(row.id)
		}
		undo.docs = [...before.values()]
		return {
			found: ids.filter((id) => found.has(id)),
			notFound: ids.filter((id) => !found.has(id)),
			changed: ids.filter((id) => changed.has(id)),
			undo,
			draft: inDraft,
		}
	})
}

/** `updateArticles` on one article; `not_found` when it is not in the library. */
export async function updateArticle(userId: string, id: string, changes: ArticleChanges) {
	const result = await updateArticles(userId, { ...changes, ids: [one(id)] })
	if (result.notFound.length > 0) throw notFound(NO_ARTICLE)
	return { changed: result.changed.length > 0, undo: result.undo }
}

async function applyState(
	tx: Tx,
	userId: string,
	change: StateChange,
	rows: Row[],
	undo: UndoRecord,
) {
	const where = owned(
		userId,
		rows.map((r) => r.id),
	)
	switch (change) {
		case "star":
		case "unstar":
			await tx
				.update(documents)
				.set({ starredAt: change === "star" ? new Date() : null })
				.where(where)
			return
		case "shortlist":
		case "unshortlist":
			await tx
				.update(documents)
				.set({ shortlistedAt: change === "shortlist" ? new Date() : null })
				.where(where)
			return
		case "keep":
		case "unkeep":
			await tx
				.update(documents)
				.set({ keptAt: change === "keep" ? new Date() : null })
				.where(where)
			return
		case "archive":
			await tx
				.update(documents)
				.set({ archivedAt: sql`coalesce(${documents.archivedAt}, now())` })
				.where(where)
			return
		case "unarchive": {
			// Back in the library, the article is no longer finished: its progress drops to where the
			// reader left off, or to the start if that was the end.
			const resumeAt = sql`case when ${documents.readingPosition} < ${READ_PROGRESS} then ${documents.readingPosition} else 0 end`
			await tx
				.update(documents)
				.set({
					archivedAt: null,
					readAt: null,
					readingProgress: resumeAt,
					readingPosition: resumeAt,
					readingCycle: sql`${documents.readingCycle} + 1`,
				})
				.where(where)
			return
		}
		case "finish":
			undo.completions.push(...(await finishIn(tx, where)))
			return
		case "unread":
			// Back to "new": never opened, no progress, not finished.
			await tx
				.update(documents)
				.set({
					firstOpenedAt: null,
					readingProgress: 0,
					readingPosition: 0,
					readAt: null,
					lastReadAt: null,
					readingCycle: sql`${documents.readingCycle} + 1`,
				})
				.where(where)
	}
}

/**
 * Finished, progress full, archived if they were not, and a completion recorded for the reading
 * cycle. Returns the ids of the completions it added (none for a cycle already completed).
 */
async function finishIn(tx: Tx, where: ReturnType<typeof owned>): Promise<string[]> {
	const docs = await tx
		.update(documents)
		.set({
			readAt: sql`coalesce(${documents.readAt}, now())`,
			readingProgress: 1,
			firstOpenedAt: sql`coalesce(${documents.firstOpenedAt}, now())`,
			archivedAt: sql`coalesce(${documents.archivedAt}, now())`,
			lastReadAt: new Date(),
		})
		.where(where)
		.returning({
			id: documents.id,
			userId: documents.userId,
			cycle: documents.readingCycle,
			completedAt: documents.readAt,
		})
	if (docs.length === 0) return []
	const added = await tx
		.insert(readingCompletions)
		.values(
			docs.map((doc) => ({
				userId: doc.userId,
				documentId: doc.id,
				cycle: doc.cycle,
				completedAt: doc.completedAt!,
				source: "manual" as const,
			})),
		)
		.onConflictDoNothing({ target: [readingCompletions.documentId, readingCompletions.cycle] })
		.returning({ id: readingCompletions.id })
	return added.map((c) => c.id)
}

/** A user-set title. Extraction keeps it (title_edited); the search vector follows it. */
function titleSet(title: string) {
	return {
		title,
		titleEdited: true,
		search: documentSearchVector({
			title,
			author: sql`${documents.author}`,
			body: sql`(select v.text from document_versions v where v.id = ${documents.currentVersionId})`,
			language: sql`${documents.language}`,
		}),
	}
}

/** Puts back what an article change recorded (see `updateArticles`). The ids it wrote to. */
export async function undoChanges(userId: string, undo: UndoRecord): Promise<string[]> {
	return revertChanges(userId, undo)
}

/** Archives every finished article still in the library; their ids, for `undoArchive`. */
export async function archiveFinished(userId: string): Promise<string[]> {
	const rows = await db
		.update(documents)
		.set({ archivedAt: new Date() })
		.where(
			and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				isNull(documents.archivedAt),
				INBOX_FILTER_WHERE.read,
			),
		)
		.returning({ id: documents.id })
	return rows.map((r) => r.id)
}

/**
 * Undo of archiving (one article, or `archiveFinished`): back in the library still finished, unlike
 * moving an article back by hand. The ids it moved.
 */
export async function undoArchive(userId: string, ids: string[]): Promise<string[]> {
	const list = parseInput(idList, ids)
	const rows = await db
		.update(documents)
		.set({ archivedAt: null })
		.where(and(owned(userId, list), isNull(documents.deletedAt), isNotNull(documents.archivedAt)))
		.returning({ id: documents.id })
	return rows.map((r) => r.id)
}

// ---- the trash ----

/** To the trash. `notFound`: not the user's, or in the trash already. */
export async function trashArticles(userId: string, ids: string[]) {
	const list = parseInput(idList, ids)
	const rows = await db
		.update(documents)
		.set({ deletedAt: new Date() })
		.where(and(owned(userId, list), isNull(documents.deletedAt)))
		.returning({ id: documents.id })
	const trashed = new Set(rows.map((r) => r.id))
	return {
		trashed: list.filter((id) => trashed.has(id)),
		notFound: list.filter((id) => !trashed.has(id)),
	}
}

export async function trashArticle(userId: string, id: string) {
	const { notFound: missing } = await trashArticles(userId, [one(id)])
	if (missing.length > 0) throw notFound(NO_ARTICLE)
}

/**
 * Out of the trash, one by one. The library keeps one live article per URL: when the same page was
 * saved again since, the article stays in the trash and `alreadySaved` names the live one.
 */
export async function restoreArticles(userId: string, ids: string[]) {
	const list = parseInput(idList, ids)
	const restored: string[] = []
	const missing: string[] = []
	const alreadySaved: Array<{ id: string; articleId: string }> = []
	for (const id of list) {
		const outcome = await restoreOne(userId, id)
		if (outcome === "restored") restored.push(id)
		else if (outcome === "missing") missing.push(id)
		else alreadySaved.push({ id, articleId: outcome.articleId })
	}
	return { restored, notFound: missing, alreadySaved }
}

/** `restoreArticles` for one: `not_found`, or `already_saved` with the live article's id. */
export async function restoreArticle(userId: string, id: string) {
	const outcome = await restoreOne(userId, one(id))
	if (outcome === "missing") throw notFound("No article with that id in the trash.")
	if (outcome !== "restored")
		throw new AppError(
			"already_saved",
			"The same page was saved again since it went to the trash; that article is in the library.",
			{ details: { articleId: outcome.articleId } },
		)
}

async function restoreOne(
	userId: string,
	id: string,
): Promise<"restored" | "missing" | { articleId: string }> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return (await restoreDocument(userId, id)) ? "restored" : "missing"
		} catch (error) {
			if (!isUniqueViolation(error)) throw error
			const live = await liveDuplicateOf(userId, id)
			if (live) return { articleId: live }
			// The other copy went to the trash in the meantime: try again.
		}
	}
	throw new Error("restore kept conflicting")
}

/**
 * Gone for good, from the trash only: rows cascade (versions, raw capture, highlights); files go
 * with the daily purge.
 */
export async function purgeArticles(userId: string, ids: string[]) {
	const list = parseInput(idList, ids)
	const rows = await db
		.delete(documents)
		.where(and(owned(userId, list), isNotNull(documents.deletedAt)))
		.returning({ id: documents.id })
	const purged = new Set(rows.map((r) => r.id))
	return {
		purged: list.filter((id) => purged.has(id)),
		notFound: list.filter((id) => !purged.has(id)),
	}
}

export async function purgeArticle(userId: string, id: string) {
	const { notFound: missing } = await purgeArticles(userId, [one(id)])
	if (missing.length > 0) throw notFound("No article with that id in the trash.")
}

// ---- reading ----

/** A finished inbox article opened again after this long is being read again, from scratch. */
export const REREAD_AFTER_HOURS = 24

/**
 * The reader opened the article: no longer new, and maybe a new reading cycle. The reading state
 * after it, for the page (its saves carry the cycle) and the API.
 */
export async function openArticle(userId: string, id: string) {
	const rereading = sql`(${documents.archivedAt} is null
		and ${documents.readingProgress} >= ${READ_PROGRESS}
		and ${documents.lastReadAt} < now() - make_interval(hours => ${REREAD_AFTER_HOURS}))`
	const [opened] = await db
		.update(documents)
		.set({
			firstOpenedAt: sql`coalesce(${documents.firstOpenedAt}, now())`,
			readingProgress: sql`case when ${rereading} then 0 else ${documents.readingProgress} end`,
			readAt: sql`case when ${rereading} then null else ${documents.readAt} end`,
			readingCycle: sql`case when ${rereading} then ${documents.readingCycle} + 1 else ${documents.readingCycle} end`,
			lastReadAt: new Date(),
		})
		.where(and(owned(userId, [one(id)]), isNull(documents.deletedAt)))
		.returning({
			firstOpenedAt: documents.firstOpenedAt,
			lastReadAt: documents.lastReadAt,
			readAt: documents.readAt,
			readingProgress: documents.readingProgress,
			readingPosition: documents.readingPosition,
			readingCycle: documents.readingCycle,
		})
	if (!opened) throw notFound(NO_ARTICLE)
	return opened
}

const Position = z.object({
	position: z.number().min(0).max(1),
	/** The reading cycle the reader saw: a save from an older cycle (an old tab) is ignored. */
	cycle: z.number().int().nonnegative().optional(),
})

/**
 * Where the reader is (0 to 1). Progress only grows within a cycle; reaching the end records a
 * completion for it. The row stays locked until then, so concurrent saves, finishes and resets
 * cannot attach a completion to another cycle.
 */
export async function saveReadingPosition(
	userId: string,
	id: string,
	input: z.input<typeof Position>,
) {
	const { position, cycle } = parseInput(Position, input)
	const articleId = one(id)
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ cycle: documents.readingCycle })
			.from(documents)
			.where(and(owned(userId, [articleId]), isNull(documents.deletedAt)))
			.for("update")
		if (!row) throw notFound(NO_ARTICLE)
		if (cycle !== undefined && cycle !== row.cycle) return
		const now = new Date()
		await tx
			.update(documents)
			.set({
				readingProgress: sql`greatest(${documents.readingProgress}, ${position})`,
				readingPosition: position,
				lastReadAt: now,
			})
			.where(eq(documents.id, articleId))
		if (position >= READ_PROGRESS)
			await tx
				.insert(readingCompletions)
				.values({
					userId,
					documentId: articleId,
					cycle: row.cycle,
					completedAt: now,
					source: "progress",
				})
				.onConflictDoNothing({ target: [readingCompletions.documentId, readingCompletions.cycle] })
	})
}

/** The owner's retry of a failed extraction. `queued`: false when it had not failed. */
export async function retryArticle(userId: string, id: string): Promise<{ queued: boolean }> {
	const articleId = one(id)
	if (!(await getDocument(userId, articleId))) throw notFound(NO_ARTICLE)
	const admission = await db.transaction((tx) => admitExtract(tx, articleId, "failed"))
	if (admission.outcome !== "admitted") return { queued: false }
	await notifyDocumentEvent({ userId, documentId: articleId, kind: "queued" })
	return { queued: true }
}

/**
 * Reads the post an article was saved through instead of the article it shared: the article becomes
 * the post again, extracted from the post's capture, and stays the post. `queued`: false when the
 * article wasn't saved as a post.
 */
export async function readPostInstead(userId: string, id: string): Promise<{ queued: boolean }> {
	const articleId = one(id)
	if (!(await getDocument(userId, articleId))) throw notFound(NO_ARTICLE)
	const queued = await db.transaction(async (tx) => {
		const [via] = await tx
			.select()
			.from(documentVia)
			.where(and(eq(documentVia.documentId, articleId), isNotNull(documentVia.rawId)))
			.for("update")
		if (!via?.rawId) return false
		const [raw] = await tx.select().from(documentRaw).where(eq(documentRaw.id, via.rawId))
		if (!raw) return false
		// The post saved again on its own since (from the trash, say): it can't be two articles.
		const [post] = await tx
			.select({ id: documents.id })
			.from(documents)
			.where(
				and(
					eq(documents.userId, userId),
					eq(documents.urlHash, via.urlHash),
					isNull(documents.deletedAt),
				),
			)
		if (post) return false
		// The newest capture is the one the job reads: the post's, again.
		await tx.insert(documentRaw).values({
			documentId: articleId,
			rawHtml: raw.rawHtml,
			finalUrl: raw.finalUrl,
			httpStatus: raw.httpStatus,
			contentType: raw.contentType,
			source: raw.source,
		})
		await tx
			.update(documents)
			.set({ sourceUrl: via.url, fetchUrl: via.url, urlHash: via.urlHash })
			.where(eq(documents.id, articleId))
		await tx.delete(documentVia).where(eq(documentVia.id, via.id))
		const admission = await admitExtract(tx, articleId, "capture")
		// A job that has not started reads the newest capture too.
		return admission.outcome === "admitted" || admission.outcome === "already_pending"
	})
	if (queued) await notifyDocumentEvent({ userId, documentId: articleId, kind: "queued" })
	return { queued }
}
