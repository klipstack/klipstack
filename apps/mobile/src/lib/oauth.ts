import {
	API_RESOURCE_PATH,
	APP_SIGN_IN_CODE_PATH,
	APP_SIGN_IN_PATH,
	APP_SIGN_IN_TWO_FACTOR_PATH,
	APP_SIGN_UP_CODE_PATH,
	APP_SIGN_UP_PATH,
	type AppSignInCredentials,
	type AppSignInErrorCode,
	type AppSignInOptions,
	type AppSignUpCredentials,
	appProviderSignInPath,
	MOBILE_CLIENT_ID,
	MOBILE_SCOPES,
	mobileRedirectUri,
} from "@klipstack/api-contract/auth"
import * as AppleAuthentication from "expo-apple-authentication"
import { AuthRequest } from "expo-auth-session"
import * as Crypto from "expo-crypto"
import { USER_AGENT } from "./config"
import { language, t } from "./i18n"
import type { Session } from "./session-store"

/** The refresh token no longer works (revoked, expired, or the app was disconnected). */
export class SignedOutError extends Error {
	constructor() {
		super("Signed out.")
		this.name = "SignedOutError"
	}
}

/** The server refused the sign-in: its message is for the person (wrong password, no account). */
export class SignInError extends Error {
	constructor(
		message: string,
		readonly code?: string,
	) {
		super(message)
		this.name = "SignInError"
	}
}

/** A sign-in waiting for its second step, as `TwoFactorRequired` carries it. */
export type PendingSignIn = { apiUrl: string; token: string; verifier: string; challenge: string }

/**
 * The account has two-factor authentication: the first step checked out, and the sign-in waits for
 * the authenticator's code (or a backup code) for 10 minutes and 5 tries (`completeTwoFactor`).
 */
export class TwoFactorRequired extends Error {
	constructor(readonly pending: PendingSignIn) {
		super("Two-factor authentication: the code is needed.")
		this.name = "TwoFactorRequired"
	}
}

/** The second step: the code turns the pending sign-in into a session. */
export async function completeTwoFactor(pending: PendingSignIn, code: string): Promise<Session> {
	const res = await post(`${pending.apiUrl}${APP_SIGN_IN_TWO_FACTOR_PATH}`, {
		codeChallenge: pending.challenge,
		twoFactorToken: pending.token,
		code: code.trim(),
	})
	return sessionFrom(res, pending.apiUrl, pending.verifier)
}

const endpoints = (apiUrl: string) => ({
	tokenEndpoint: `${apiUrl}/api/auth/oauth2/token`,
	revocationEndpoint: `${apiUrl}/api/auth/oauth2/revoke`,
})

const resourceOf = (apiUrl: string) => `${apiUrl}${API_RESOURCE_PATH}`

/** The ways in the server offers; none when it can't be reached (the screen says so on use). */
export async function signInOptions(apiUrl: string): Promise<AppSignInOptions> {
	const res = await fetch(`${apiUrl}${APP_SIGN_IN_PATH}`, {
		headers: jsonHeaders,
		credentials: "omit",
	})
	if (!res.ok) throw new Error(`The server answered ${res.status}.`)
	return (await res.json()) as AppSignInOptions
}

type Credentials =
	| { method: "password"; email: string; password: string }
	| { method: "code"; email: string; code: string }

/** Signs in with a password or an emailed code. */
export function signInWith(apiUrl: string, credentials: Credentials): Promise<Session> {
	return signInOnServer(apiUrl, credentials)
}

/** A sign-up: the invite, unless the server's sign-up is open. */
export type SignUp = { inviteCode?: string }

/** Creates the account, verified by the code `sendSignUpCode` emailed. */
export function signUpWith(
	apiUrl: string,
	{
		inviteCode,
		...credentials
	}: SignUp & { name: string; email: string; password: string; code: string },
): Promise<Session> {
	return signInOnServer(apiUrl, { method: "email", ...credentials }, { inviteCode })
}

/** Emails a sign-up code, once the invite checks out (an address with an account gets told). */
export async function sendSignUpCode(apiUrl: string, email: string, signUp: SignUp) {
	const res = await post(`${apiUrl}${APP_SIGN_UP_CODE_PATH}`, { email, ...signUp })
	if (!res.ok) throw await refusal(res)
}

/** Emails a sign-in code; the server answers the same whether the account exists. */
export async function sendSignInCode(apiUrl: string, email: string): Promise<void> {
	const res = await post(`${apiUrl}${APP_SIGN_IN_CODE_PATH}`, { email })
	if (!res.ok) throw await refusal(res)
}

/**
 * Sign in with Apple, in iOS's own sheet. Null when the person closes it. Apple signs the SHA-256
 * of a nonce of ours into its ID token; the server checks it against the nonce itself.
 */
export async function signInWithApple(apiUrl: string, signUp?: SignUp): Promise<Session | null> {
	const nonce = Crypto.randomUUID()
	let credential: AppleAuthentication.AppleAuthenticationCredential
	try {
		credential = await AppleAuthentication.signInAsync({
			requestedScopes: [
				AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
				AppleAuthentication.AppleAuthenticationScope.EMAIL,
			],
			nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce),
		})
	} catch (e) {
		if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return null
		throw e
	}
	if (!credential.identityToken || !credential.authorizationCode)
		throw new SignInError(t("account.oauth.appleNoToken"))
	return signInOnServer(
		apiUrl,
		{
			method: "apple",
			idToken: credential.identityToken,
			nonce,
			authorizationCode: credential.authorizationCode,
			givenName: credential.fullName?.givenName ?? undefined,
			familyName: credential.fullName?.familyName ?? undefined,
		},
		signUp,
	)
}

const PROVIDER_NAMES = { google: "Google", github: "GitHub" } as const

/**
 * Google or GitHub, in a private sign-in sheet that goes straight to the provider and comes back
 * to the app with the code. Null when the person closes the sheet.
 */
export async function signInWithProvider(
	apiUrl: string,
	provider: "google" | "github",
	signUp?: SignUp,
): Promise<Session | null> {
	const redirectUri = mobileRedirectUri(apiUrl)
	const request = new AuthRequest({
		clientId: MOBILE_CLIENT_ID,
		redirectUri,
		scopes: [...MOBILE_SCOPES],
		usePKCE: true,
		extraParams: {
			resource: resourceOf(apiUrl),
			// A sign-up: the server checks the invite before the provider, and creates the account.
			...(signUp ? { sign_up: "1", invite: signUp.inviteCode ?? "" } : {}),
		},
	})
	const result = await request.promptAsync(
		{ authorizationEndpoint: `${apiUrl}${appProviderSignInPath(provider)}` },
		{
			// iOS hands an https redirect to the app only with this, from iOS 17.4, the app's minimum.
			preferUniversalLinks: true,
			// Nothing of the sign-in stays in Safari: the next one starts afresh, with any account.
			preferEphemeralSession: true,
		},
	)
	if (result.type === "cancel" || result.type === "dismiss") return null
	if (result.type === "error" || result.type !== "success") {
		const code = result.type === "error" ? (result.params.error ?? result.error?.code) : undefined
		throw new SignInError(providerMessage(code, PROVIDER_NAMES[provider]), code)
	}
	const code = result.params.code
	if (!code || !request.codeVerifier) throw new SignInError(t("account.oauth.noCode"))
	return exchange(apiUrl, code, request.codeVerifier)
}

function providerMessage(code: string | undefined, name: string): string {
	switch (code as AppSignInErrorCode | undefined) {
		case "no_account":
			return t("account.oauth.noAccount", { name })
		case "invalid_invite":
			return t("account.oauth.invalidInvite")
		case "not_linked":
			return t("account.oauth.notLinked", { name })
		case "no_email":
			return t("account.oauth.noEmail", { name })
		default:
			return t("account.oauth.failed", { name })
	}
}

/**
 * The server signs in (or, with `signUp`, creates the account) and answers a code for this app's
 * PKCE challenge, which is exchanged here.
 */
async function signInOnServer(
	apiUrl: string,
	credentials: AppSignInCredentials | AppSignUpCredentials,
	signUp?: SignUp,
): Promise<Session> {
	const { verifier, challenge } = await pkce()
	const path = signUp ? APP_SIGN_UP_PATH : APP_SIGN_IN_PATH
	const res = await post(`${apiUrl}${path}`, {
		...credentials,
		...signUp,
		codeChallenge: challenge,
	})
	if (res.status === 403) {
		const body = (await res
			.clone()
			.json()
			.catch(() => ({}))) as {
			error?: { code?: string; details?: { twoFactorToken?: unknown } }
		}
		const token = body.error?.details?.twoFactorToken
		if (body.error?.code === "two_factor_required" && typeof token === "string")
			throw new TwoFactorRequired({ apiUrl, token, verifier, challenge })
	}
	return sessionFrom(res, apiUrl, verifier)
}

/** The server's `{ code }`, exchanged with the verifier of its challenge; or why not. */
async function sessionFrom(res: Response, apiUrl: string, verifier: string): Promise<Session> {
	if (!res.ok) throw await refusal(res)
	const { code } = (await res.json()) as { code?: unknown }
	if (typeof code !== "string") throw new Error(t("account.oauth.noCode"))
	return exchange(apiUrl, code, verifier)
}

/** A PKCE pair (S256): 32 random bytes, and their SHA-256, both base64url. */
async function pkce() {
	let binary = ""
	for (const byte of Crypto.getRandomBytes(32)) binary += String.fromCharCode(byte)
	const verifier = base64url(btoa(binary))
	const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
		encoding: Crypto.CryptoEncoding.BASE64,
	})
	return { verifier, challenge: base64url(digest) }
}

const base64url = (base64: string) =>
	base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")

function exchange(apiUrl: string, code: string, verifier: string): Promise<Session> {
	return tokenRequest(apiUrl, {
		grant_type: "authorization_code",
		code,
		redirect_uri: mobileRedirectUri(apiUrl),
		client_id: MOBILE_CLIENT_ID,
		code_verifier: verifier,
		resource: resourceOf(apiUrl),
	})
}

// The app's language, for a new account's (and its emails'): the account speaks as the app does.
const jsonHeaders = {
	accept: "application/json",
	"accept-language": language,
	"user-agent": USER_AGENT,
}

// No cookies: the app keeps no browser session.
const post = (url: string, body: unknown) =>
	fetch(url, {
		method: "POST",
		headers: { ...jsonHeaders, "content-type": "application/json" },
		body: JSON.stringify(body),
		credentials: "omit",
	})

async function refusal(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => ({}))) as {
		error?: { code?: string; message?: string }
	}
	if (body.error?.message) return new SignInError(body.error.message, body.error.code)
	return new Error(t("account.oauth.serverAnswered", { status: res.status }))
}

/** A new access token (and, with rotation, a new refresh token). */
export async function refresh(session: Session): Promise<Session> {
	return tokenRequest(session.apiUrl, {
		grant_type: "refresh_token",
		refresh_token: session.refreshToken,
		client_id: MOBILE_CLIENT_ID,
		resource: resourceOf(session.apiUrl),
	})
}

/** Revokes the refresh token; failures are ignored, since the session is dropped anyway. */
export async function revoke(session: Session): Promise<void> {
	await fetch(endpoints(session.apiUrl).revocationEndpoint, {
		method: "POST",
		headers: formHeaders,
		body: new URLSearchParams({
			token: session.refreshToken,
			token_type_hint: "refresh_token",
			client_id: MOBILE_CLIENT_ID,
		}).toString(),
		credentials: "omit",
	}).catch(() => undefined)
}

const formHeaders = {
	"content-type": "application/x-www-form-urlencoded",
	accept: "application/json",
	"user-agent": USER_AGENT,
}

async function tokenRequest(apiUrl: string, form: Record<string, string>): Promise<Session> {
	// No cookies: better-auth checks the Origin of cookie-carrying POSTs, and apps send none.
	const res = await fetch(endpoints(apiUrl).tokenEndpoint, {
		method: "POST",
		headers: formHeaders,
		body: new URLSearchParams(form).toString(),
		credentials: "omit",
	})
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
	if (!res.ok) {
		if (body.error === "invalid_grant") throw new SignedOutError()
		throw new Error(
			String(body.error_description ?? body.error ?? `Token request failed (${res.status}).`),
		)
	}
	const { access_token, refresh_token, expires_in } = body
	if (typeof access_token !== "string" || typeof expires_in !== "number")
		throw new Error("Token request failed: unexpected response.")
	return {
		apiUrl,
		accessToken: access_token,
		// A refresh without rotation keeps the old refresh token.
		refreshToken: typeof refresh_token === "string" ? refresh_token : form.refresh_token!,
		expiresAt: Math.floor(Date.now() / 1000) + expires_in,
	}
}
