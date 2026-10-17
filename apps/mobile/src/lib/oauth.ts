import {
	API_RESOURCE_PATH,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { AuthRequest, Prompt } from "expo-auth-session"
import { USER_AGENT } from "./config"
import type { Session } from "./session-store"

/** The refresh token no longer works (revoked, expired, or the app was disconnected). */
export class SignedOutError extends Error {
	constructor() {
		super("Signed out.")
		this.name = "SignedOutError"
	}
}

const endpoints = (apiUrl: string) => ({
	authorizationEndpoint: `${apiUrl}/api/auth/oauth2/authorize`,
	tokenEndpoint: `${apiUrl}/api/auth/oauth2/token`,
	revocationEndpoint: `${apiUrl}/api/auth/oauth2/revoke`,
})

const resourceOf = (apiUrl: string) => `${apiUrl}${API_RESOURCE_PATH}`

/**
 * Opens the server's sign-in and consent pages in a browser sheet. Resolves with the session, or
 * null when the user closes the sheet. `again`: the server asks for the password (or another way
 * in) even when the browser is still signed in, for what needs a recent sign-in.
 */
export async function authorize(
	apiUrl: string,
	{ again = false }: { again?: boolean } = {},
): Promise<Session | null> {
	const request = new AuthRequest({
		clientId: MOBILE_CLIENT_ID,
		redirectUri: MOBILE_REDIRECT_URI,
		scopes: [...MOBILE_SCOPES],
		usePKCE: true,
		// The server reuses an earlier consent silently otherwise: always show what is granted.
		prompt: again ? [Prompt.Login, Prompt.Consent] : Prompt.Consent,
		extraParams: { resource: resourceOf(apiUrl) },
	})
	const result = await request.promptAsync(endpoints(apiUrl))
	if (result.type === "cancel" || result.type === "dismiss") return null
	if (result.type !== "success") {
		const message = result.type === "error" ? result.error?.message : undefined
		throw new Error(message ?? "Sign-in failed.")
	}
	const code = result.params.code
	if (!code || !request.codeVerifier) throw new Error("Sign-in failed: no authorization code.")
	return tokenRequest(apiUrl, {
		grant_type: "authorization_code",
		code,
		redirect_uri: MOBILE_REDIRECT_URI,
		client_id: MOBILE_CLIENT_ID,
		code_verifier: request.codeVerifier,
		resource: resourceOf(apiUrl),
	})
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
