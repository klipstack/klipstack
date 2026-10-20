import {
	API_RESOURCE_PATH,
	APP_SIGN_IN_CODE_LENGTH,
	type AppSignInOptions,
	MOBILE_CLIENT_ID,
	MOBILE_SCOPES,
	mobileRedirectUri,
} from "@klipstack/api-contract/auth"
import { logError } from "@klipstack/log"
import { APIError } from "better-auth/api"
import { z } from "zod"
import { AppError, parseInput } from "./app-error"
import { claimsOf, exchangeAppleAppCode, keepAppleAppToken } from "./apple-tokens.server"
import { VERIFY_TO_CONTINUE_PAGE } from "./auth-constants"
import { checkAuthLimit } from "./auth-limits.server"
import { auth } from "./auth.server"
import { EmailError, emailEnabled } from "./email.server"
import { appleApp, env } from "./env.server"
import { enabledProviders } from "./provider-sign-in.server"

/**
 * The iPhone app's own sign-in screen. Every way in signs in through better-auth, in process, then
 * runs the app's authorization request with that session: the app gets an authorization code for
 * `klipstack-mobile`, bound to its PKCE challenge, and exchanges it as after a browser sign-in. Its
 * tokens are the usual ones, so refresh, the recent sign-in for deletion (`sid`) and revocation
 * work unchanged. Nothing here creates an account: in invite mode better-auth refuses to.
 */

export function appSignInOptions(): AppSignInOptions {
	return {
		// Apple through its own sheet, which needs the app's bundle ID as Apple's client.
		providers: enabledProviders.filter((provider) => provider !== "apple" || appleApp !== null),
		emailCode: emailEnabled,
	}
}

const codeChallenge = z
	.string()
	.regex(/^[A-Za-z0-9_-]{43}$/, "codeChallenge must be an S256 challenge")
const email = z.email("Enter a valid email address.").max(254)
const name = z.string().trim().max(100).optional()

const SignIn = z.discriminatedUnion("method", [
	z.object({
		method: z.literal("password"),
		codeChallenge,
		email,
		password: z.string().min(1).max(256),
	}),
	z.object({
		method: z.literal("code"),
		codeChallenge,
		email,
		code: z.string().regex(new RegExp(`^\\d{${APP_SIGN_IN_CODE_LENGTH}}$`), "Enter the code."),
	}),
	z.object({
		method: z.literal("apple"),
		codeChallenge,
		idToken: z.string().min(1).max(8192),
		nonce: z.string().min(16).max(256),
		authorizationCode: z.string().min(1).max(1024),
		givenName: name,
		familyName: name,
	}),
])

/** Signs in one of the app's ways and answers the authorization code. */
export async function appSignIn(input: unknown, headers: Headers): Promise<{ code: string }> {
	const request = parseInput(SignIn, input)
	const cookie = await signIn(request, headers)
	try {
		return { code: await authorizationCode(cookie, request.codeChallenge) }
	} catch (error) {
		// No code, no use for the session: end it.
		await auth.api.signOut({ headers: new Headers({ cookie }) }).catch(() => undefined)
		throw error
	}
}

/** The session cookie of a new sign-in. */
async function signIn(request: z.output<typeof SignIn>, headers: Headers): Promise<string> {
	try {
		if (request.method === "password") {
			const result = await auth.api.signInEmail({
				body: { email: request.email, password: request.password },
				headers,
				returnHeaders: true,
			})
			return cookieOf(result.headers)
		}
		if (request.method === "code") {
			const result = await auth.api.signInEmailOTP({
				body: { email: request.email, otp: request.code },
				headers,
				returnHeaders: true,
			})
			return cookieOf(result.headers)
		}
		return await signInWithApple(request, headers)
	} catch (error) {
		throw refusal(error, request.method)
	}
}

async function signInWithApple(
	request: Extract<z.output<typeof SignIn>, { method: "apple" }>,
	headers: Headers,
): Promise<string> {
	await checkAuthLimit("/app/sign-in/apple", undefined, headers)
	if (!appleApp)
		throw new AppError("invalid_request", "Sign in with Apple is not available on this server.")
	let exchanged: Awaited<ReturnType<typeof exchangeAppleAppCode>>
	try {
		exchanged = await exchangeAppleAppCode(request.authorizationCode)
	} catch (error) {
		logError("[app-sign-in] Apple's token endpoint failed", error)
		throw new AppError("unavailable", "Apple can't be reached right now. Try again.")
	}
	// The code is Apple's proof that this sign-in just happened, for this person: an ID token alone
	// works for an hour, wherever it was copied to.
	if (!exchanged || exchanged.subject !== claimsOf(request.idToken)?.sub) throw appleRefused()
	const { givenName, familyName } = request
	const result = await auth.api.signInSocial({
		body: {
			provider: "apple",
			idToken: {
				token: request.idToken,
				nonce: request.nonce,
				...(givenName || familyName
					? { user: { name: { firstName: givenName, lastName: familyName } } }
					: {}),
			},
		},
		headers,
		returnHeaders: true,
	})
	const userId = "user" in result.response ? result.response.user.id : null
	if (userId) await keepAppleAppToken(userId, exchanged.subject, exchanged.refreshToken)
	return cookieOf(result.headers)
}

const appleRefused = () =>
	new AppError("unauthorized", "Apple's sign-in couldn't be checked. Try again.")

/** What the app shows for a refused sign-in; other errors stay errors. */
function refusal(error: unknown, method: z.output<typeof SignIn>["method"]): unknown {
	if (error instanceof AppError) return error
	if (!(error instanceof APIError)) return error
	if (error.statusCode === 429) {
		const retryAfter = Number(new Headers(error.headers).get("Retry-After")) || 900
		return new AppError("rate_limited", "Too many attempts. Try again later.", { retryAfter })
	}
	const code = String(error.body?.code ?? "")
	if (code === "INVITE_REQUIRED" || code === "USER_NOT_FOUND")
		return new AppError(
			"not_found",
			`No Klipstack account uses this Apple ID. Create one at ${new URL(env.APP_URL).host} with an invite, then sign in here.`,
		)
	if (method === "password" && error.statusCode === 401)
		return new AppError("unauthorized", "The email or password is wrong.")
	if (method === "code" && (error.statusCode === 400 || error.statusCode === 403))
		return new AppError("unauthorized", "The code is wrong or has expired. Ask for a new one.")
	if (method === "apple" && code === "OAUTH_LINK_ERROR")
		return new AppError(
			"forbidden",
			"An account has this Apple ID's email but isn't connected to Apple. Sign in another way, then connect Apple in Settings on the web.",
		)
	if (method === "apple" && error.statusCode === 401) return appleRefused()
	return error
}

function cookieOf(headers: Headers): string {
	const cookie = headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ")
	if (!cookie) throw new Error("the sign-in set no session")
	return cookie
}

/**
 * The app's authorization request, run with the new session. The app has no consent screen
 * (`skipConsent`): a verified account gets its code at once.
 */
async function authorizationCode(cookie: string, challenge: string): Promise<string> {
	const redirectUri = mobileRedirectUri(env.APP_URL)
	const query = new URLSearchParams({
		response_type: "code",
		client_id: MOBILE_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: MOBILE_SCOPES.join(" "),
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: `${env.APP_URL}${API_RESOURCE_PATH}`,
	})
	const response = await auth.handler(
		new Request(`${env.APP_URL}/api/auth/oauth2/authorize?${query}`, {
			headers: { cookie },
			redirect: "manual",
		}),
	)
	const location = response.headers.get("location")
	const back = location ? new URL(location, env.APP_URL) : null
	const code = back?.href.startsWith(`${redirectUri}?`) ? back.searchParams.get("code") : null
	if (code) return code
	// An unverified account (a password set before the mailbox was proven): the emailed code
	// proves it.
	if (back?.pathname === VERIFY_TO_CONTINUE_PAGE)
		throw new AppError(
			"verification_required",
			"Verify your email first: sign in with a code by email, which verifies it.",
		)
	throw new Error(`the authorization request gave no code (${response.status} ${back?.pathname})`)
}

/** Emails a sign-in code to an existing account; nothing for an unknown address, the same answer. */
export async function sendAppSignInCode(input: unknown, headers: Headers): Promise<void> {
	const { email: address } = parseInput(z.object({ email }), input)
	try {
		await auth.api.sendVerificationOTP({
			body: { email: address.trim().toLowerCase(), type: "sign-in" },
			headers,
		})
	} catch (error) {
		if (error instanceof APIError && error.statusCode === 429) throw refusal(error, "code")
		if (error instanceof EmailError && error.code === "EMAIL_NOT_CONFIGURED")
			throw new AppError("unavailable", "This server can't send email.")
		// The same answer whether the account exists: the error may name the address.
		logError("[app-sign-in] sending a code failed", error)
	}
}
