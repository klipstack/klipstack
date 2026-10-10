import { createSender, type Email } from "@klipstack/email"

/** Where the worker's emails link to. */
export const appUrl = () => process.env.APP_URL ?? "http://localhost:5180"

let sender: ReturnType<typeof createSender> | undefined

/** Sends through Resend, or prints to the log without a key (development). */
export function defaultSend(email: Email) {
	sender ??= createSender({
		apiKey: process.env.RESEND_API_KEY || undefined,
		from: process.env.EMAIL_FROM ?? "Klipstack <hello@localhost>",
	})
	return sender.send(email)
}
