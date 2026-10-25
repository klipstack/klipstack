import { APIError } from "better-auth/api"
import { renderSVG } from "uqr"
import { auth } from "./auth.server"
import { hasFeature } from "./features.server"
import { oauthApiContext } from "./oauth.server"

/**
 * Whether Settings offers two-factor authentication: with the `two-factor` flag, to admins (who
 * need it to open /admin), and to an account that has it on (so it can be turned off).
 */
export async function twoFactorOffered(user: {
	id: string
	role?: string | null
	twoFactorEnabled?: boolean | null
}) {
	return (
		Boolean(user.twoFactorEnabled) ||
		user.role === "admin" ||
		(await hasFeature(user.id, "two-factor"))
	)
}

/**
 * What an authenticator app needs to add the account: the `otpauth://` URI as a QR code (an SVG
 * data URL: no markup of ours is injected), and its secret in base32, to type in instead.
 */
export function authenticatorSetup(totpURI: string) {
	const svg = renderSVG(totpURI, { border: 2 })
	return {
		qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
		secret: new URL(totpURI).searchParams.get("secret") ?? "",
	}
}

/**
 * The second step of a sign-in, for accounts with two-factor authentication. A first step (a
 * password, …) that better-auth's two-factor plugin stops answers no session but a pending
 * sign-in: the plugin's signed `two_factor` cookie, valid for `TWO_FACTOR_MINUTES` and 5 codes.
 * The code turns it into a session. The plugin's endpoints are closed over HTTP: only this module
 * calls them, under the auth limits (`/two-factor/*` in auth-limits.server.ts).
 */

const PENDING_COOKIE = /^(?:__Secure-)?klip\.two_factor=./

/** The pending sign-in among these cookies (`name=value` pairs), or null. */
function pendingAmong(cookies: string[]): string | null {
	return (
		cookies.map((cookie) => cookie.trim()).find((cookie) => PENDING_COOKIE.test(cookie)) ?? null
	)
}

/** The pending sign-in a first step's response set, as a `Cookie` pair; null when none waits. */
export function pendingSignInSet(responseHeaders: Headers): string | null {
	return pendingAmong(responseHeaders.getSetCookie().map((cookie) => cookie.split(";")[0] ?? ""))
}

/** The pending sign-in the browser sent back, as a `Cookie` pair; null when it has none. */
export function pendingSignInSent(requestHeaders: Headers): string | null {
	return pendingAmong((requestHeaders.get("cookie") ?? "").split(";"))
}

/** Whether a first step's answer is the plugin's "a code is needed" rather than a session. */
export function needsSecondStep(response: unknown): boolean {
	return !!response && typeof response === "object" && "twoFactorRedirect" in response
}

export type CodeRefusal = "wrong-code" | "expired" | "limited"

/**
 * Six digits are the authenticator app's code; anything else is taken as a backup code
 * (`abcde-12345`, the dash optional). Spaces are dropped either way.
 */
export function readCode(input: string): { kind: "totp" | "backup"; code: string } {
	const code = input.replace(/\s+/g, "")
	if (/^\d{6}$/.test(code)) return { kind: "totp", code }
	if (/^[A-Za-z0-9]{10}$/.test(code))
		return { kind: "backup", code: `${code.slice(0, 5)}-${code.slice(5)}` }
	return { kind: "backup", code }
}

/**
 * Checks the code against the pending sign-in in `pending` (and nothing else of the browser's: a
 * session cookie would make the plugin check that session's account instead). Answers the new
 * session's cookies, plus where an app's authorization request goes next when `oauthQuery` carries
 * one (the provider resumes it, as after a password login). A wrong code counts against the
 * sign-in's 5 tries and the account's lockout; once spent, or past its minutes, the sign-in is over.
 */
export async function completeSignIn(
	request: Request,
	pending: string,
	input: string,
	oauthQuery?: string | null,
): Promise<
	{ headers: Headers; response: unknown; locale: string | null } | { error: CodeRefusal }
> {
	const headers = new Headers(request.headers)
	headers.set("cookie", pending)
	const context = oauthQuery ? oauthApiContext(new Request(request.url, { headers })) : { headers }
	const { kind, code } = readCode(input)
	const body = { code, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) }
	try {
		const result =
			kind === "totp"
				? await auth.api.verifyTOTP({ body, ...context, returnHeaders: true })
				: await auth.api.verifyBackupCode({ body, ...context, returnHeaders: true })
		const response: unknown = result.response
		const user =
			response && typeof response === "object" && "user" in response
				? (response.user as { locale?: unknown })
				: null
		return {
			headers: result.headers,
			response,
			locale: typeof user?.locale === "string" ? user.locale : null,
		}
	} catch (error) {
		const refusal = codeRefusal(error)
		if (refusal) return { error: refusal }
		throw error
	}
}

function codeRefusal(error: unknown): CodeRefusal | null {
	if (!(error instanceof APIError)) return null
	if (error.statusCode === 429) return "limited"
	const code = (error.body as { code?: unknown } | undefined)?.code
	if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE") return "wrong-code"
	if (
		code === "INVALID_TWO_FACTOR_COOKIE" ||
		code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" ||
		code === "TOTP_NOT_ENABLED" ||
		code === "BACKUP_CODES_NOT_ENABLED"
	)
		return "expired"
	return null
}
