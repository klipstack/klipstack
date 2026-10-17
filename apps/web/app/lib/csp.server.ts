import { randomBytes } from "node:crypto"
import { env } from "./env.server"
import { SUPPYHQ_ORIGIN } from "./support-widget"

/** Every response: no framing, no `<base>` rewrites, no plugins. */
export const BASE_POLICY = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"

/**
 * A rendered page also runs only scripts from this origin and the inline ones React Router writes
 * with the page's nonce. The reader puts stored article HTML into this page: if anything ever got
 * past the sanitizer, an injected script still would not run. A signed-in page on a server with a
 * SuppyHQ account also runs SuppyHQ's script, the support button.
 */
export function documentPolicy(nonce: string, { signedIn }: { signedIn: boolean }): string {
	const sources = ["'self'", `'nonce-${nonce}'`]
	if (signedIn && env.SUPPYHQ_TENANT) sources.push(SUPPYHQ_ORIGIN)
	return `${BASE_POLICY}; script-src ${sources.join(" ")}`
}

export function createNonce(): string {
	return randomBytes(16).toString("base64")
}
