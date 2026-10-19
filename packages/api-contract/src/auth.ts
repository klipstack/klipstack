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
 * Our apps on Apple's platforms. App Review (guideline 4.8) wants Sign in with Apple wherever an app
 * offers another company's sign-in: in their sign-in, the web offers providers only with Apple
 * among them.
 */
export const APPLE_PLATFORM_CLIENTS: readonly string[] = [MOBILE_CLIENT_ID]

/** The mobile app always asks for full access. */
export const MOBILE_SCOPES = CLI_SCOPES

/**
 * The mobile app's registered redirect URI: a reverse-domain private-use scheme (RFC 8252, 7.1),
 * the only custom-scheme form better-auth's redirect check accepts. It was the app's first bundle ID;
 * `app.json` lists it in `scheme`, since the bundle ID is now `com.klipstack.mobile`.
 */
export const MOBILE_REDIRECT_URI = "com.klipstack.app:/oauth/callback"

/**
 * The mobile app's sign-in callback as a universal link, `<APP_URL>/app/oauth/callback`: the https
 * redirect that will replace the custom scheme once the app has an Apple team. The server lists it
 * in `/.well-known/apple-app-site-association` when the team is configured; it is not registered on
 * `klipstack-mobile` until the app uses it. No web page answers at this path.
 */
export const MOBILE_CALLBACK_PATH = "/app/oauth/callback"

/** The path of the CLI's one-shot login server. */
export const CLI_CALLBACK_PATH = "/callback"

/**
 * The CLI's registered redirect URI. It listens on a random port, which the server ignores when
 * matching loopback redirects (RFC 8252): send `http://127.0.0.1:<port>/callback`.
 */
export const CLI_REDIRECT_URI = `http://127.0.0.1${CLI_CALLBACK_PATH}`
