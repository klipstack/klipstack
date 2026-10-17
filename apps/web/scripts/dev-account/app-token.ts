import { createHash, randomBytes } from "node:crypto"
import {
	API_RESOURCE_PATH,
	MOBILE_CLIENT_ID,
	MOBILE_REDIRECT_URI,
	MOBILE_SCOPES,
} from "@klipstack/api-contract/auth"
import { auth } from "../../app/lib/auth.server"
import { env } from "../../app/lib/env.server"
import { oauthApiContext, oauthRedirectUrl, signedOAuthQuery } from "../../app/lib/oauth.server"

export type AppToken = { accessToken: string; refreshToken: string; expiresIn: number }

/**
 * Signs the iPhone app (`klipstack-mobile`) in to an account the way the app does, in process: the
 * password sign-in, the authorization request with PKCE, the consent and the code exchange, all
 * through the server's own auth handler. The tokens are real ones, refresh token and all, so the
 * app can use what only its own tokens may (the AI, deleting the account).
 */
export async function appToken(email: string, password: string): Promise<AppToken> {
	const base = env.APP_URL
	const call = async (path: string, init: RequestInit = {}) =>
		auth.handler(
			new Request(`${base}/api/auth${path}`, {
				...init,
				headers: { origin: base, ...init.headers },
				redirect: "manual",
			}),
		)

	const signIn = await call("/sign-in/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
	})
	if (!signIn.ok) throw new Error(`Signing in failed (${signIn.status}): ${await signIn.text()}`)
	const cookie = signIn.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ")

	const verifier = randomBytes(32).toString("base64url")
	const resource = `${base}${API_RESOURCE_PATH}`
	const authorize = await call(
		`/oauth2/authorize?${new URLSearchParams({
			response_type: "code",
			client_id: MOBILE_CLIENT_ID,
			redirect_uri: MOBILE_REDIRECT_URI,
			scope: MOBILE_SCOPES.join(" "),
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
			state: randomBytes(8).toString("hex"),
			resource,
			prompt: "consent",
		})}`,
		{ headers: { cookie } },
	)
	const consentPage = authorize.headers.get("location")
	const oauthQuery = consentPage && signedOAuthQuery(new URL(consentPage, base))
	if (!oauthQuery)
		throw new Error(
			`No consent step (${authorize.status}): ${consentPage ?? (await authorize.text())}`,
		)

	// What the consent page's Allow button does (routes/oauth.consent.tsx).
	const consented = await auth.api.oauth2Consent({
		body: { accept: true, oauth_query: oauthQuery },
		...oauthApiContext(
			new Request(`${base}/oauth/consent`, { method: "POST", headers: { cookie, origin: base } }),
		),
	})
	const back = oauthRedirectUrl(consented)
	const code = back && new URL(back).searchParams.get("code")
	if (!code) throw new Error(`Consent gave no code: ${back ?? JSON.stringify(consented)}`)

	const token = await call("/oauth2/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: MOBILE_REDIRECT_URI,
			client_id: MOBILE_CLIENT_ID,
			code_verifier: verifier,
			resource,
		}),
	})
	const body = (await token.json()) as Record<string, unknown>
	const { access_token, refresh_token, expires_in } = body
	if (
		typeof access_token !== "string" ||
		typeof refresh_token !== "string" ||
		typeof expires_in !== "number"
	)
		throw new Error(`The token request failed (${token.status}): ${JSON.stringify(body)}`)
	return { accessToken: access_token, refreshToken: refresh_token, expiresIn: expires_in }
}
