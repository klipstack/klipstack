import { randomBytes } from "node:crypto"

/** Every response: no framing, no `<base>` rewrites, no plugins. */
export const BASE_POLICY = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"

/**
 * A rendered page also runs only scripts from this origin and the inline ones React Router writes
 * with the page's nonce. The reader puts stored article HTML into this page: if anything ever got
 * past the sanitizer, an injected script still would not run.
 */
export function documentPolicy(nonce: string): string {
	return `${BASE_POLICY}; script-src 'self' 'nonce-${nonce}'`
}

export function createNonce(): string {
	return randomBytes(16).toString("base64")
}
