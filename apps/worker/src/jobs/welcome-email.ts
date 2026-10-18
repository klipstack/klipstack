import { and, db, eq, inArray, sql, user } from "@klipstack/db"
import { type Email, emailT, renderEmail, type WelcomeFrom } from "@klipstack/email"
import { log } from "../log"
import { appUrl, defaultSend } from "../mail"

/** At most this many a run: the next minute's run takes the rest, at the email service's pace. */
const BATCH = 20

/**
 * Every minute: the welcome email, signed by `WELCOME_FROM_*`, to each account created while the
 * welcome was on (`welcomeEmailDue`) whose address is verified by now. Replies go to the signer.
 *
 * An account is taken off the list before its email goes out: a run that overlaps another, or a
 * failed send, never writes to anyone twice. A failed send is logged, not retried.
 */
export async function handleWelcomeEmail({
	send = defaultSend,
	from,
	only,
}: {
	send?: (email: Email) => Promise<void>
	/** The signer, read when the worker starts (`welcomeFrom`); null: no welcome. */
	from: WelcomeFrom | null
	/** Only these accounts, when given: tests pass their own, never anyone else's. */
	only?: string[]
}): Promise<{ sent: number; failed: number }> {
	if (!from) return { sent: 0, failed: 0 }
	const due = db
		.select({ id: user.id })
		.from(user)
		.where(
			and(
				eq(user.emailVerified, true),
				sql`(${user.prefs}->>'welcomeEmailDue')::boolean is true`,
				only ? inArray(user.id, only) : undefined,
			),
		)
		.orderBy(user.createdAt)
		.limit(BATCH)
		.for("update", { skipLocked: true })
	const recipients = await db
		.update(user)
		.set({ prefs: sql`${user.prefs} || '{"welcomeEmailDue": false}'::jsonb` })
		.where(inArray(user.id, due))
		.returning({ id: user.id, email: user.email, name: user.name, locale: user.locale })
	let sent = 0
	for (const recipient of recipients) {
		try {
			await send({ ...welcomeEmail(recipient, from), to: recipient.email, replyTo: from.email })
			sent++
		} catch (error) {
			log.error("welcome email: sending failed", { userId: recipient.id, error })
		}
	}
	return { sent, failed: recipients.length - sent }
}

function welcomeEmail(recipient: { name: string; locale: string }, from: WelcomeFrom) {
	const t = emailT(recipient.locale, "auth")
	const firstName = recipient.name.trim().split(/\s+/)[0] ?? ""
	const subject = t("welcomeEmail.subject")
	const rendered = renderEmail(
		{
			heading: firstName
				? t("welcomeEmail.heading", { firstName })
				: t("welcomeEmail.headingNoName"),
			body: t("welcomeEmail.body", { name: from.name }),
			// Save link, with the other ways to save under it.
			cta: { label: t("welcomeEmail.cta"), url: new URL("/library?save", appUrl()).href },
		},
		appUrl(),
	)
	return { subject, ...rendered }
}
