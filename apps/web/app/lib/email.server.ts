import { createSender, type Email, EmailError, renderEmail as render } from "@klipstack/email"
import { logError } from "@klipstack/log"
import { env } from "./env.server"

export { type Email, EmailError }

const sender = createSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM })

/**
 * Whether emails actually get delivered. Without a Resend key they only go to the console, which is
 * fine for development but must not be offered to users in production (magic links would never arrive).
 */
export const emailEnabled = sender.configured || process.env.NODE_ENV !== "production"

/** See `createSender` (`@klipstack/email`): Resend, or the console outside production. */
export function sendEmail(email: Email): Promise<void> {
	return sender.send(email)
}

/**
 * Sends without waiting, for mail that only existing accounts get (sign-in link, password reset)
 * or only new addresses get (sign-up link). Waiting for Resend would make those answers slower
 * than the others, which tells a stranger whether an address has an account; so would a send
 * failure answered as an error. Failures go to the log.
 */
export function sendEmailInBackground(email: Email): void {
	sendEmail(email).catch((error) => logError("[email] sending failed", error))
}

export function renderEmail(parts: Parameters<typeof render>[0]) {
	return render(parts, env.APP_URL)
}
