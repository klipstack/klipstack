/**
 * Runs inside the page (via scripting.executeScript). Returns the rendered DOM so the server can
 * extract from exactly what the user saw, including content behind logins and paywalls.
 * Keep this function self-contained: it is serialized into the page.
 */
export function capturePage(): { url: string; title: string; html: string } {
	// Our own toast from a previous save must not end up in the capture.
	document.getElementById("klipstack-toast-host")?.remove()
	const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : "<!DOCTYPE html>"
	// Ensure relative URLs resolve on the server even if the page had no <base>.
	const hasBase = Boolean(document.querySelector("base[href]"))
	// Scripts and hidden form fields can hold the reader's session, email or tokens, and extraction
	// reads none of them: they stay behind. The article's JSON-LD (author, dates) goes along.
	const page = document.documentElement.cloneNode(true) as HTMLElement
	for (const el of Array.from(
		page.querySelectorAll('script:not([type="application/ld+json"]), input[type="hidden"]'),
	))
		el.remove()
	let html = page.outerHTML
	if (!hasBase)
		html = html.replace(
			/<head([^>]*)>/i,
			`<head$1><base href="${location.href.replace(/"/g, "&quot;")}">`,
		)
	return { url: location.href, title: document.title, html: `${doctype}\n${html}` }
}

export interface SaveResult {
	ok: boolean
	status: number
	id?: string
	readUrl?: string
	error?: string
	/** With `error: "limit_reached"`: which cap (`saves`, `storage`). */
	limit?: string
}

/**
 * POST a capture to the app, signed in with the browser's Klipstack session: the extension's host
 * permission lets the request carry the site's cookies. Without a session, the answer is 401.
 */
export async function saveToKlipstack(
	appUrl: string,
	payload: { url: string; html?: string },
	fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
	try {
		const res = await fetchImpl(`${appUrl}/api/documents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ url: payload.url, html: payload.html ?? null, source: "extension" }),
		})
		// The app answers as its API does: `{article, created}`, or `{error: {code, message}}`.
		const body = (await res.json().catch(() => ({}))) as {
			article?: { id: string }
			error?: { code?: string; details?: { limit?: string } }
		}
		if (!res.ok)
			return {
				ok: false,
				status: res.status,
				error: body.error?.code ?? `http_${res.status}`,
				...(body.error?.details?.limit ? { limit: body.error.details.limit } : {}),
			}
		const id = body.article?.id
		return { ok: true, status: res.status, id, readUrl: id ? `${appUrl}/read/${id}` : undefined }
	} catch (error) {
		return { ok: false, status: 0, error: error instanceof Error ? error.message : "network" }
	}
}

/**
 * Saves the page as captured; one too large to send (inline images, say: over the server's size
 * limits) goes as its address alone, and the server fetches it.
 */
export async function savePage(
	appUrl: string,
	payload: { url: string; html?: string },
	fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
	const result = await saveToKlipstack(appUrl, payload, fetchImpl)
	// Over the body limit (413), or a page the app refuses as too large (`invalid_request`).
	const tooLarge = result.status === 413 || result.error === "invalid_request"
	if (result.ok || !payload.html || !tooLarge) return result
	return saveToKlipstack(appUrl, { url: payload.url }, fetchImpl)
}

/**
 * Sites the server reads through an API and whose page HTML it ignores (X). Saving these sends
 * the URL only. Mirrors the X hosts in @klipstack/extract.
 */
export function isServerCapturedUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
		return ["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"].includes(host)
	} catch {
		return false
	}
}

/** Pages we can never capture (browser UI, stores, local files). */
export function isCapturableUrl(url: string | undefined): url is string {
	return Boolean(url && /^https?:\/\//i.test(url))
}
