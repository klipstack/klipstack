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

/** The mobile app always asks for full access. */
export const MOBILE_SCOPES = CLI_SCOPES

/**
 * The mobile app's registered redirect URI: a reverse-domain private-use scheme (RFC 8252, 7.1),
 * the only custom-scheme form better-auth's redirect check accepts.
 */
export const MOBILE_REDIRECT_URI = "com.klipstack.app:/oauth/callback"

/** The path of the CLI's one-shot login server. */
export const CLI_CALLBACK_PATH = "/callback"

/**
 * The CLI's registered redirect URI. It listens on a random port, which the server ignores when
 * matching loopback redirects (RFC 8252): send `http://127.0.0.1:<port>/callback`.
 */
export const CLI_REDIRECT_URI = `http://127.0.0.1${CLI_CALLBACK_PATH}`
