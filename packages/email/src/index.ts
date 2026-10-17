import { fallbackLanguage, resources, supportedLanguages } from "@klipstack/i18n"
import i18next from "i18next"
import { Resend } from "resend"

/**
 * Email for the web app and the worker: one template, one sender, one set of translations. Each app
 * passes its own settings; the web's are validated in `env.server.ts`.
 */
export interface Email {
	to: string
	subject: string
	html: string
	text: string
	/** Where replies go, when not to the sender. */
	replyTo?: string
}

/** An email not sent. Logs show its code, never its message, which can name the recipient. */
export class EmailError extends Error {
	readonly code: "EMAIL_NOT_CONFIGURED" | "EMAIL_SEND_FAILED"
	constructor(code: EmailError["code"], message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = "EmailError"
		this.code = code
	}
}

/**
 * Sends via Resend when there is a key; otherwise prints to the console in development and tests.
 * In production without a key it refuses: an email can hold a sign-in link, which must never reach
 * a log.
 */
export function createSender({ apiKey, from }: { apiKey?: string; from: string }) {
	const resend = apiKey ? new Resend(apiKey) : null
	return {
		configured: resend !== null,
		async send(email: Email): Promise<void> {
			if (!resend) {
				if (process.env.NODE_ENV === "production")
					throw new EmailError("EMAIL_NOT_CONFIGURED", "Email delivery is not configured")
				const replyTo = email.replyTo ? `\n[email] reply-to=${email.replyTo}` : ""
				console.log(
					`\n[email] to=${email.to}${replyTo}\n[email] subject=${email.subject}\n${email.text}\n`,
				)
				return
			}
			const { error } = await resend.emails.send({ from, ...email })
			if (error) {
				// Resend's error name is its code (e.g. rate_limit_exceeded).
				const cause = Object.assign(new Error(error.message), {
					name: "ResendError",
					code: error.name,
				})
				throw new EmailError("EMAIL_SEND_FAILED", `Failed to send email: ${error.message}`, {
					cause,
				})
			}
		},
	}
}

function escapeHtml(s: string) {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
	)
}

export function renderEmail(
	{
		heading,
		body,
		cta,
		footer,
	}: {
		heading: string
		body: string
		cta?: { label: string; url: string }
		footer?: string
	},
	appUrl: string,
) {
	// The app icon beside the name as live text: the name still shows when a client blocks images.
	const logo = new URL("/icons/icon-email.png?v=2", appUrl).href
	const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#faf9f7;padding:32px">
<div style="max-width:520px;margin:0 auto 16px;font-size:18px;font-weight:600;color:#1a1d23">
<img src="${logo}" width="32" height="32" alt="" style="vertical-align:middle;border:0;margin-right:10px"><span style="vertical-align:middle">Klipstack</span>
</div>
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e8e5e0;border-radius:12px;padding:32px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
<p style="font-size:16px;line-height:1.5;color:#333;white-space:pre-line">${escapeHtml(body)}</p>
${cta ? `<p style="margin:24px 0"><a href="${cta.url}" style="display:inline-block;background:#243f6c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(cta.label)}</a></p>` : ""}
${footer ? `<p style="font-size:13px;color:#777">${escapeHtml(footer)}</p>` : ""}
</div></body></html>`
	const text = [
		heading,
		"",
		body,
		cta ? `\n${cta.label}: ${cta.url}` : "",
		footer ? `\n${footer}` : "",
	].join("\n")
	return { html, text }
}

/** An i18next instance of its own, for rendering outside a request. */
const emailI18n = i18next.createInstance()
await emailI18n.init({
	resources,
	fallbackLng: fallbackLanguage,
	supportedLngs: [...supportedLanguages],
	defaultNS: "common",
	interpolation: { escapeValue: false },
})

/** The recipient's language when we support it. */
export function supportedLocale(locale: unknown): string {
	return typeof locale === "string" && (supportedLanguages as readonly string[]).includes(locale)
		? locale
		: fallbackLanguage
}

/** Translations for an email, in the recipient's language (any stored value; unknown ones fall back). */
export function emailT<N extends "auth" | "admin" | "editions">(locale: unknown, ns: N) {
	return emailI18n.getFixedT(supportedLocale(locale), ns)
}

/** Who signs the welcome note in the app and the welcome email (`WELCOME_FROM_*`). */
export interface WelcomeFrom {
	name: string
	/** Shown in the note, and where replies to the email go. */
	email: string
	/** An https address or a path on the app; without one, the note shows the name's initial. */
	photo: string | null
}

/**
 * The welcome's signer, or null when `WELCOME_FROM_NAME` and `WELCOME_FROM_EMAIL` are not both set:
 * then no account gets a welcome. Throws on a malformed address or photo, so a server with a typo
 * does not start.
 */
export function welcomeFrom(source: Record<string, string | undefined>): WelcomeFrom | null {
	const name = source.WELCOME_FROM_NAME?.trim()
	const email = source.WELCOME_FROM_EMAIL?.trim()
	const photo = source.WELCOME_FROM_PHOTO?.trim() || null
	if (!name || !email) return null
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		throw new Error("WELCOME_FROM_EMAIL is not an email address")
	if (photo && !/^(https:\/\/|\/(?!\/))\S+$/.test(photo))
		throw new Error("WELCOME_FROM_PHOTO must be an https address or a path starting with /")
	return { name, email, photo }
}
