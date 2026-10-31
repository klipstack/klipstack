import { randomBytes } from "node:crypto"
import { createContext, type RouterContextProvider } from "react-router"

/** Every response: no framing, no `<base>` rewrites, no plugins. */
export const BASE_POLICY = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"

/**
 * A rendered page also runs only scripts from this origin and the inline ones React Router writes
 * with the page's nonce, and its forms post only to this origin. The reader puts stored article HTML
 * into this page: if anything ever got past the sanitizer, an injected script still would not run,
 * and an injected form could not send what it collects to another site.
 *
 * `formTargets` are the other origins this page's own forms end up at (`allowFormTargets`).
 */
export function documentPolicy(nonce: string, formTargets: readonly string[] = []): string {
	const formAction = ["'self'", ...new Set(formTargets)].join(" ")
	return `${BASE_POLICY}; script-src 'self' 'nonce-${nonce}'; form-action ${formAction}`
}

export function createNonce(): string {
	return randomBytes(16).toString("base64")
}

const BROWSER_SCHEMES = new Set(["javascript:", "data:", "blob:", "filesystem:", "about:", "file:"])

const formTargetsContext = createContext<readonly string[]>([])

/**
 * Lets this page's own forms be sent on to these addresses. form-action also holds the redirects
 * that follow a form's post (Chrome checks them), and a form posts as a page load until the page
 * hydrates: a sign-in that goes on to a provider, or to an app's redirect URI, would stop on this
 * origin. After hydration React Router posts with fetch and follows the redirect itself, which
 * form-action does not see. A loader or action calls this; entry.server.tsx adds them to the policy.
 */
export function allowFormTargets(
	context: Readonly<RouterContextProvider>,
	urls: Iterable<string | null | undefined>,
) {
	const sources = [...urls].map((url) => (url ? formActionSource(url) : null))
	const added = sources.filter((source): source is string => source !== null)
	if (added.length > 0)
		context.set(formTargetsContext, [...context.get(formTargetsContext), ...added])
}

export function formTargetsOf(context: Readonly<RouterContextProvider>): readonly string[] {
	return context.get(formTargetsContext)
}

/**
 * The form-action source for an address: its origin for http(s), its scheme for an app's own
 * (`com.example.app:`). Null when it is not an absolute URL.
 */
export function formActionSource(url: string): string | null {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return null
	}
	if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin
	// A CSP scheme-source, nothing that could end the directive or start another, and never one that
	// runs or embeds what follows it.
	if (BROWSER_SCHEMES.has(parsed.protocol)) return null
	return /^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol) ? parsed.protocol : null
}
