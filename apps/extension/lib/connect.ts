import {
	API_RESOURCE_PATH,
	EXTENSION_CALLBACK_PATH,
	EXTENSION_CLIENT_ID,
	EXTENSION_SCOPES,
	extensionRedirectUri,
} from "@klipstack/api-contract/auth"

/**
 * The extension's own sign-in, for browsers that keep the server's cookies from it (Safari): an
 * OAuth authorization code with PKCE for the public client `klipstack-extension`, as the CLI and
 * the iPhone app sign in. The code comes back to a page of the server (`/extension/connected`),
 * whose address the background reads from the tab. Its tokens save through the API.
 */

/** What the extension keeps of a sign-in. `expiresAt` is in milliseconds. */
export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number }

/** A sign-in started and not finished: the tab it was started from gets the save once it is. */
export type Pending = { verifier: string; state: string; tabId: number }

/** Where the tokens are kept (`browser.storage.local` in the extension). */
export interface TokenStore {
	get(): Promise<Tokens | null>
	set(tokens: Tokens | null): Promise<void>
}

const base = (appUrl: string) => appUrl.replace(/\/+$/, "")

const randomString = (bytes: number) =>
	base64url(crypto.getRandomValues(new Uint8Array(bytes)).buffer as ArrayBuffer)

function base64url(buffer: ArrayBuffer): string {
	let binary = ""
	for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** A new sign-in: its PKCE verifier, the challenge sent for it, and the state that ties them. */
export async function startSignIn(): Promise<{
	verifier: string
	challenge: string
	state: string
}> {
	const verifier = randomString(32)
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
	return { verifier, challenge: base64url(digest), state: randomString(16) }
}

/** The server's authorization page for that sign-in: it signs the reader in, then asks consent. */
export function authorizeUrl(
	appUrl: string,
	{ challenge, state }: { challenge: string; state: string },
): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: EXTENSION_CLIENT_ID,
		redirect_uri: extensionRedirectUri(appUrl),
		scope: EXTENSION_SCOPES.join(" "),
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: `${base(appUrl)}${API_RESOURCE_PATH}`,
	})
	return `${base(appUrl)}/api/auth/oauth2/authorize?${params}`
}

/**
 * What a tab's address says when it is the sign-in's end: its state, and the code or the error.
 * Null for any other address.
 */
export function callbackOf(
	appUrl: string,
	url: string,
): { state: string; code: string | null; error: string | null } | null {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}
	const server = new URL(base(appUrl))
	if (parsed.origin !== server.origin || parsed.pathname !== EXTENSION_CALLBACK_PATH) return null
	const state = parsed.searchParams.get("state")
	if (!state) return null
	return {
		state,
		code: parsed.searchParams.get("code"),
		error: parsed.searchParams.get("error"),
	}
}

type TokenAnswer = { access_token?: string; refresh_token?: string; expires_in?: number }

/** POSTs to the token endpoint. The tokens, or null when the server refuses the grant. */
async function tokenRequest(
	appUrl: string,
	form: Record<string, string>,
	fetchImpl: typeof fetch,
	now: number,
	keepRefresh?: string,
): Promise<Tokens | null> {
	const res = await fetchImpl(`${base(appUrl)}/api/auth/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		credentials: "omit",
		body: new URLSearchParams({
			client_id: EXTENSION_CLIENT_ID,
			resource: `${base(appUrl)}${API_RESOURCE_PATH}`,
			...form,
		}),
	})
	// A refused grant (expired, revoked, disconnected) is a 4xx; anything else is worth retrying.
	if (res.status >= 400 && res.status < 500) return null
	if (!res.ok) throw new Error(`The token endpoint answered ${res.status}.`)
	const body = (await res.json()) as TokenAnswer
	const refreshToken = body.refresh_token ?? keepRefresh
	if (!body.access_token || !refreshToken) return null
	return {
		accessToken: body.access_token,
		refreshToken,
		expiresAt: now + (body.expires_in ?? 3600) * 1000,
	}
}

/** The code from the callback, exchanged with the verifier only this extension holds. */
export function exchangeCode(
	appUrl: string,
	{ code, verifier }: { code: string; verifier: string },
	fetchImpl: typeof fetch = fetch,
	now = Date.now(),
): Promise<Tokens | null> {
	return tokenRequest(
		appUrl,
		{
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			redirect_uri: extensionRedirectUri(appUrl),
		},
		fetchImpl,
		now,
	)
}

/** A refresh within this long of the access token's expiry, so a save never starts with a stale one. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * An access token to save with: the kept one, or a new one from the refresh token when it is about
 * to expire (`force`: the API refused the kept one). Null when there is no sign-in, or the server
 * refused the refresh token: the tokens are forgotten, and the reader connects again.
 */
export function accessToken(
	appUrl: string,
	store: TokenStore,
	options: { force?: boolean; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<string | null> {
	// One refresh at a time: the server rotates the refresh token, so a second one at once would
	// be refused, and forget the sign-in the first just renewed.
	if (refreshing) return refreshing
	const result = currentToken(appUrl, store, options)
	refreshing = result.finally(() => {
		refreshing = null
	})
	return refreshing
}

let refreshing: Promise<string | null> | null = null

async function currentToken(
	appUrl: string,
	store: TokenStore,
	{
		force = false,
		fetchImpl = fetch,
		now = Date.now(),
	}: { force?: boolean; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<string | null> {
	const kept = await store.get()
	if (!kept) return null
	if (!force && kept.expiresAt - EXPIRY_MARGIN_MS > now) return kept.accessToken
	const fresh = await tokenRequest(
		appUrl,
		{ grant_type: "refresh_token", refresh_token: kept.refreshToken },
		fetchImpl,
		now,
		kept.refreshToken,
	)
	await store.set(fresh)
	return fresh?.accessToken ?? null
}
