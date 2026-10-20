/** Names shared by the server, the SDK and the CLI. Imports nothing. */

/** The API's OAuth resource, relative to the app URL: access tokens carry `<APP_URL>/api` as audience. */
export const API_RESOURCE_PATH = "/api"

/** The first-party command-line client, registered at server startup. */
export const CLI_CLIENT_ID = "klipstack-cli"

/** Read the library: articles, highlights, notes and the feed. */
export const LIBRARY_READ_SCOPE = "library:read"

/** Change the library: save, archive, star, rename, notes, highlights, trash, the feed. */
export const LIBRARY_WRITE_SCOPE = "library:write"

/** Identity scopes, and the one that makes the server issue refresh tokens. */
export const OIDC_SCOPES = ["openid", "profile", "email", "offline_access"] as const

/** What the CLI asks for; a read-only login leaves out library:write. */
export const CLI_SCOPES = [...OIDC_SCOPES, LIBRARY_READ_SCOPE, LIBRARY_WRITE_SCOPE] as const

/** The first-party mobile app, registered at server startup like the CLI. */
export const MOBILE_CLIENT_ID = "klipstack-mobile"

/**
 * The first-party apps with in-app AI: only tokens issued to one of them may spend the account's
 * AI through the API (the endpoints with `clients: IN_APP_AI_CLIENTS`). Whoever connects with an
 * API key, the CLI, MCP or an app of their own brings their own AI. Another app of ours with the
 * reader's AI (iPad, Android) is one more id here.
 */
export const IN_APP_AI_CLIENTS: readonly string[] = [MOBILE_CLIENT_ID]

/**
 * The first-party apps that may delete the account through the API (`POST /account/delete`), after
 * a recent sign-in. Never an API key, the CLI or another app: deleting an account is the account
 * owner's act in one of our own apps, as on the web.
 */
export const ACCOUNT_DELETION_CLIENTS: readonly string[] = [MOBILE_CLIENT_ID]

/**
 * Our apps on Apple's platforms. The web's sign-in offers them no provider: a trip to one would
 * leave the app's request behind. The app offers them itself, with Sign in with Apple, as App
 * Review wants wherever another company's sign-in is offered (guideline 4.8).
 */
export const APPLE_PLATFORM_CLIENTS: readonly string[] = [MOBILE_CLIENT_ID]

/** The mobile app always asks for full access. */
export const MOBILE_SCOPES = CLI_SCOPES

/**
 * The mobile app's redirect URI on the http dev server: a reverse-domain private-use scheme
 * (RFC 8252, 7.1), the only custom-scheme form better-auth's redirect check accepts. Any iOS app can
 * claim a scheme and catch the sign-in, so an https server never accepts it; there the app uses the
 * universal link. It was the app's first bundle ID; `app.json` lists it in `scheme`, since the
 * bundle ID is now `com.klipstack.mobile`.
 */
export const MOBILE_REDIRECT_URI = "com.klipstack.app:/oauth/callback"

/**
 * The mobile app's sign-in callback as a universal link, `<APP_URL>/app/oauth/callback`. The server
 * lists it in `/.well-known/apple-app-site-association` when the Apple team is configured, so only
 * the app signed by that team can open it. No web page answers at this path.
 */
export const MOBILE_CALLBACK_PATH = "/app/oauth/callback"

/**
 * The redirect URI the mobile app signs in with on the server at `apiUrl`: the universal link on an
 * https server, the custom scheme on the http dev server.
 */
export function mobileRedirectUri(apiUrl: string): string {
	if (!apiUrl.startsWith("https://")) return MOBILE_REDIRECT_URI
	return `${apiUrl.replace(/\/+$/, "")}${MOBILE_CALLBACK_PATH}`
}

/**
 * The redirect URIs the server at `appUrl` accepts from the mobile app. An https server accepts the
 * universal link only. The http dev server also accepts the custom scheme, which the app sends it.
 */
export function mobileRedirectUris(appUrl: string): string[] {
	const universalLink = `${appUrl.replace(/\/+$/, "")}${MOBILE_CALLBACK_PATH}`
	return appUrl.startsWith("https://") ? [universalLink] : [universalLink, MOBILE_REDIRECT_URI]
}

/**
 * The mobile app's own sign-in, outside the API (`/api/v1`): every way in ends in an authorization
 * code for `klipstack-mobile`, which the app exchanges at the token endpoint with its PKCE verifier,
 * as after the browser sign-in.
 *
 * - `GET` answers `AppSignInOptions`: the ways in this server offers.
 * - `POST` (JSON `AppSignInRequest`) signs in and answers `{ code }`, or `{ error: { code, message } }`.
 */
export const APP_SIGN_IN_PATH = "/app/sign-in"

/** `POST` (JSON `{ email }`): emails a sign-in code to an existing account. Answers 204 either way. */
export const APP_SIGN_IN_CODE_PATH = "/app/sign-in/code"

/**
 * `GET /app/sign-in/<provider>` with the parameters of an authorization request: the provider's
 * sign-in, in the app's sign-in sheet. It ends at the app's redirect URI with the code, or with an
 * `error` (`AppSignInErrorCode`).
 */
export const appProviderSignInPath = (provider: "google" | "github") =>
	`${APP_SIGN_IN_PATH}/${provider}`

/** The providers the app may offer, in the order it shows them. */
export type AppSignInProvider = "apple" | "google" | "github"

export type AppSignInOptions = {
	providers: AppSignInProvider[]
	/** Whether the server can email a sign-in code. */
	emailCode: boolean
}

export type AppSignInRequest = { codeChallenge: string } & (
	| { method: "password"; email: string; password: string }
	| { method: "code"; email: string; code: string }
	| {
			method: "apple"
			/** Apple's ID token, issued to the app with the SHA-256 of `nonce` as its nonce. */
			idToken: string
			nonce: string
			/** Apple's authorization code: the server exchanges it, which proves the token fresh. */
			authorizationCode: string
			/** Apple sends the name only at the first sign-in. */
			givenName?: string
			familyName?: string
	  }
)

/**
 * Why a provider sign-in in the sheet came back without a code (`error` on the redirect):
 * `no_account` (nobody has this identity, and the app creates no account), `not_linked` (an account
 * has its email but is not connected to that provider), `no_email`, `failed`.
 */
export type AppSignInErrorCode = "no_account" | "not_linked" | "no_email" | "failed"

/** The digits of an emailed sign-in code. */
export const APP_SIGN_IN_CODE_LENGTH = 6

/** The path of the CLI's one-shot login server. */
export const CLI_CALLBACK_PATH = "/callback"

/**
 * The CLI's registered redirect URI. It listens on a random port, which the server ignores when
 * matching loopback redirects (RFC 8252): send `http://127.0.0.1:<port>/callback`.
 */
export const CLI_REDIRECT_URI = `http://127.0.0.1${CLI_CALLBACK_PATH}`
