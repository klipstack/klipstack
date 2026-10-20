import {
	API_RESOURCE_PATH,
	APP_SIGN_IN_CODE_PATH,
	APP_SIGN_IN_PATH,
	type AppSignInCredentials,
	type AppSignInErrorCode,
	type AppSignInOptions,
	appProviderSignInPath,
	MOBILE_CLIENT_ID,
	MOBILE_SCOPES,
	mobileRedirectUri,
} from "@klipstack/api-contract/auth"
import * as AppleAuthentication from "expo-apple-authentication"
import { AuthRequest } from "expo-auth-session"
import * as Crypto from "expo-crypto"
import { USER_AGENT } from "./config"
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

/** Emails a sign-in code; the server answers the same whether the account exists. */
export async function sendSignInCode(apiUrl: string, email: string): Promise<void> {
	const res = await post(`${apiUrl}${APP_SIGN_IN_CODE_PATH}`, { email })
	if (!res.ok) throw await refusal(res)
}

/**
 * Sign in with Apple, in iOS's own sheet. Null when the person closes it. Apple signs the SHA-256
 * of a nonce of ours into its ID token; the server checks it against the nonce itself.
 */
export async function signInWithApple(apiUrl: string): Promise<Session | null> {
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
		throw new SignInError("Apple's sign-in gave no token. Try again.")
	return signInOnServer(apiUrl, {
		method: "apple",
		idToken: credential.identityToken,
		nonce,
		authorizationCode: credential.authorizationCode,
		givenName: credential.fullName?.givenName ?? undefined,
		familyName: credential.fullName?.familyName ?? undefined,
	})
}

const PROVIDER_NAMES = { google: "Google", github: "GitHub" } as const

/**
 * Google or GitHub, in a private sign-in sheet that goes straight to the provider and comes back
 * to the app with the code. Null when the person closes the sheet.
 */
export async function signInWithProvider(
	apiUrl: string,
	provider: "google" | "github",
): Promise<Session | null> {
	const redirectUri = mobileRedirectUri(apiUrl)
	const request = new AuthRequest({
		clientId: MOBILE_CLIENT_ID,
		redirectUri,
		scopes: [...MOBILE_SCOPES],
		usePKCE: true,
		extraParams: { resource: resourceOf(apiUrl) },
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
		throw new SignInError(providerMessage(code, PROVIDER_NAMES[provider], apiUrl), code)
	}
	const code = result.params.code
	if (!code || !request.codeVerifier)
		throw new SignInError("Sign-in failed: no authorization code.")
	return exchange(apiUrl, code, request.codeVerifier)
}

function providerMessage(code: string | undefined, name: string, apiUrl: string): string {
	switch (code as AppSignInErrorCode | undefined) {
		case "no_account":
			return `No Klipstack account uses this ${name} account. Create one at ${new URL(apiUrl).host}, then sign in here.`
		case "not_linked":
			return `An account has this email but isn't connected to ${name}. Sign in another way, then connect ${name} in Settings on the web.`
		case "no_email":
			return `${name} didn't share an email address, so it can't sign you in.`
		default:
			return `Signing in with ${name} didn't work. Try again.`
	}
}

/** The server signs in and answers a code for this app's PKCE challenge, which is exchanged here. */
async function signInOnServer(apiUrl: string, credentials: AppSignInCredentials): Promise<Session> {
	const { verifier, challenge } = await pkce()
	const res = await post(`${apiUrl}${APP_SIGN_IN_PATH}`, {
		...credentials,
		codeChallenge: challenge,
	})
	if (!res.ok) throw await refusal(res)
	const { code } = (await res.json()) as { code?: unknown }
	if (typeof code !== "string") throw new Error("Sign-in failed: no authorization code.")
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

const jsonHeaders = { accept: "application/json", "user-agent": USER_AGENT }

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
	return new Error(`The server answered ${res.status}. Try again.`)
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
