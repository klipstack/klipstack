/** Shared by server (auth config) and client (UI copy). Keep free of server imports. */
import {
	LIBRARY_READ_SCOPE,
	LIBRARY_WRITE_SCOPE,
	MOBILE_CLIENT_ID,
	OIDC_SCOPES,
} from "@klipstack/api-contract/auth"
import type { i18n as I18n } from "i18next"
import { isNsKey, type NsKey } from "./i18n-keys"

export const MAGIC_LINK_MINUTES = 15
export const RESET_PASSWORD_MINUTES = 60
export const VERIFY_EMAIL_MINUTES = 60
export const MIN_PASSWORD_LENGTH = 8

/**
 * Where the OAuth provider sends a signed-in reader whose email is not verified: an app's request
 * waits there until it is (routes/oauth.verify-email.tsx).
 */
export const VERIFY_TO_CONTINUE_PAGE = "/oauth/verify-email"

/** The library scopes (MCP and the HTTP API), named in the contract. */
export { LIBRARY_READ_SCOPE, LIBRARY_WRITE_SCOPE }

/** Scopes the consent screen lets the user turn down while allowing the rest. */
export const OPTIONAL_SCOPES: readonly string[] = [LIBRARY_WRITE_SCOPE]

/** The mobile app saves shared links, so it gets write access or nothing. */
export function optionalScopesFor(clientId: string | null): readonly string[] {
	return clientId === MOBILE_CLIENT_ID ? [] : OPTIONAL_SCOPES
}

/** Scopes about who the user is. With `openid`, the consent screen shows them as one line. */
export const IDENTITY_SCOPES: readonly string[] = ["openid", "profile", "email"]

/** The i18n key of that one line, or null when the scopes don't make one. */
export function identityKey(scopes: readonly string[]): NsKey | null {
	if (!scopes.includes("openid")) return null
	const name = scopes.includes("profile")
	const email = scopes.includes("email")
	if (!name && !email) return null
	return `auth:oauth.identity.${name && email ? "nameAndEmail" : name ? "name" : "email"}`
}

/** Scopes the OAuth server grants. The consent screen describes each one. */
export const OAUTH_SCOPES = [...OIDC_SCOPES, LIBRARY_READ_SCOPE, LIBRARY_WRITE_SCOPE] as const

/** i18n key for a scope's description, or null for a scope with none (i18next reads ":" as a namespace separator). */
export function scopeKey(i18n: I18n, scope: string): NsKey | null {
	const key = `auth:oauth.scopes.${scope.replace(/[^a-z0-9_]/gi, "_")}`
	return isNsKey(i18n, key) ? key : null
}
