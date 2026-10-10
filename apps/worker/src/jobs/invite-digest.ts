import { and, db, eq, sql, user } from "@klipstack/db"
import { type Email, emailT, renderEmail } from "@klipstack/email"
import { log } from "../log"
import { appUrl, defaultSend } from "../mail"

/**
 * Once a day: when wait list requests arrived since the last digest, emails every verified admin
 * how many are new and how many wait in all, with a link to /admin/requests. Counts only: nothing a
 * visitor typed reaches an inbox.
 *
 * Requests are marked counted after the emails go out, so a failed send retries the whole digest.
 * With no admin to tell, nothing is marked, and the next digest counts them.
 */
export async function handleInviteDigest({
	send = defaultSend,
}: { send?: (email: Email) => Promise<void> } = {}): Promise<{
	fresh: number
	recipients: number
}> {
	const fresh = await db.execute<{ id: string }>(
		sql`select id from invite_requests where notified_at is null`,
	)
	const ids = fresh.rows.map((row) => row.id)
	if (ids.length === 0) return { fresh: 0, recipients: 0 }
	const admins = await db
		.select({ email: user.email, locale: user.locale })
		.from(user)
		.where(and(eq(user.role, "admin"), eq(user.emailVerified, true)))
	if (admins.length === 0) {
		log.warn("invite digest: requests wait, but no verified admin to tell", { fresh: ids.length })
		return { fresh: ids.length, recipients: 0 }
	}
	const counted = await db.execute<{ waiting: number }>(
		sql`select count(*)::int as waiting from invite_requests`,
	)
	const waiting = counted.rows[0]?.waiting ?? ids.length
	const url = new URL("/admin/requests", appUrl()).href
	for (const admin of admins) {
		const t = emailT(admin.locale, "admin")
		const subject = t("requests.digest.subject", { count: ids.length })
		const body = `${t("requests.digest.new", { count: ids.length })} ${t("requests.digest.waiting", { count: waiting })}`
		const rendered = renderEmail(
			{
				heading: subject,
				body,
				cta: { label: t("requests.digest.cta"), url },
				footer: t("requests.digest.footer"),
			},
			appUrl(),
		)
		await send({ to: admin.email, subject, ...rendered })
	}
	await db.execute(
		sql`update invite_requests set notified_at = now() where id = any(${sql.param(ids)}::uuid[])`,
	)
	return { fresh: ids.length, recipients: admins.length }
}
