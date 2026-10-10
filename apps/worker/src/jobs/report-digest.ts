import { and, db, eq, sql, user } from "@klipstack/db"
import { type Email, emailT, renderEmail } from "@klipstack/email"
import { log } from "../log"
import { appUrl, defaultSend } from "../mail"

/**
 * Every hour: when reports on public editions arrived since the last digest, emails every verified
 * admin how many, with a link to /admin/reports. Counts only: nothing a visitor typed reaches an
 * inbox. Hourly, not daily like the wait list's: a report may be about illegal content.
 *
 * Reports are marked counted after the emails go out, so a failed send retries the whole digest.
 * With no admin to tell, nothing is marked, and the next digest counts them.
 */
export async function handleReportDigest({
	send = defaultSend,
}: { send?: (email: Email) => Promise<void> } = {}): Promise<{
	fresh: number
	recipients: number
}> {
	const fresh = await db.execute<{ id: string }>(
		sql`select id from edition_reports where notified_at is null`,
	)
	const ids = fresh.rows.map((row) => row.id)
	if (ids.length === 0) return { fresh: 0, recipients: 0 }
	const admins = await db
		.select({ email: user.email, locale: user.locale })
		.from(user)
		.where(and(eq(user.role, "admin"), eq(user.emailVerified, true)))
	if (admins.length === 0) {
		log.warn("report digest: reports wait, but no verified admin to tell", { fresh: ids.length })
		return { fresh: ids.length, recipients: 0 }
	}
	const url = new URL("/admin/reports", appUrl()).href
	for (const admin of admins) {
		const t = emailT(admin.locale, "admin")
		const subject = t("reports.digest.subject", { count: ids.length })
		const rendered = renderEmail(
			{
				heading: subject,
				body: t("reports.digest.body", { count: ids.length }),
				cta: { label: t("reports.digest.cta"), url },
				footer: t("reports.digest.footer"),
			},
			appUrl(),
		)
		await send({ to: admin.email, subject, ...rendered })
	}
	await db.execute(
		sql`update edition_reports set notified_at = now() where id = any(${sql.param(ids)}::uuid[])`,
	)
	return { fresh: ids.length, recipients: admins.length }
}
