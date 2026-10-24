/**
 * Runs inside the page (via scripting.executeScript). Returns the rendered DOM so the server can
 * extract from exactly what the user saw, including content behind logins and paywalls. For an
 * article, it also fetches the page again, as the reader's browser, for the page as the site
 * served it: some paywalls send the whole article and cut it in the browser. The server keeps the
 * longer article. Other pages are not fetched again: a second GET could use up a one-time link,
 * or answer a form's result page with something else.
 * Keep this function self-contained: it is serialized into the page.
 */
export async function capturePage(): Promise<{
	url: string
	title: string
	html: string
	servedHtml: string | null
}> {
	const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : "<!DOCTYPE html>"
	// Scripts and hidden form fields can hold the reader's session, email or tokens, and extraction
	// reads none of them: they stay behind. The article's JSON-LD (author, dates) goes along.
	// Ensure relative URLs resolve on the server even if the page had no <base>.
	const serialize = (page: HTMLElement) => {
		for (const el of Array.from(
			page.querySelectorAll('script:not([type="application/ld+json"]), input[type="hidden"]'),
		))
			el.remove()
		const html = page.querySelector("base[href]")
			? page.outerHTML
			: page.outerHTML.replace(
					/<head([^>]*)>/i,
					`<head$1><base href="${location.href.replace(/"/g, "&quot;")}">`,
				)
		return `${doctype}\n${html}`
	}
	const page = document.documentElement.cloneNode(true) as HTMLElement
	// Our own toast must not end up in the capture.
	page.querySelector("#klipstack-toast-host")?.remove()
	const html = serialize(page)

	// An article by its Open Graph type or its JSON-LD (an Article type, or paid content).
	const isArticle =
		document.querySelector('meta[property="og:type"]')?.getAttribute("content") === "article" ||
		Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((s) =>
			/"@type"\s*:\s*\[?\s*"(\w*Article|BlogPosting)"|"isAccessibleForFree"\s*:\s*"?false/i.test(
				s.textContent ?? "",
			),
		)
	const fetchServed = async () => {
		try {
			const res = await fetch(location.href, {
				credentials: "include",
				headers: { accept: "text/html" },
				signal: AbortSignal.timeout(5000),
			})
			const type = res.headers.get("content-type") ?? ""
			// A redirect leads to another page (a sign-in, an edition, the home page): not this one.
			const sameUrl = res.url.split("#")[0] === location.href.split("#")[0]
			if (!res.ok || !sameUrl || !/text\/html|application\/xhtml\+xml/i.test(type)) return null
			const bytes = new Uint8Array(await res.arrayBuffer())
			// Past the server's limit for a page (10 MB), it would only cost a second upload.
			if (bytes.length > 10_000_000) return null
			// Decoded as the server's fetcher does (`decodeBody`): the HTTP charset, then the page's
			// <meta charset>, then UTF-8, then windows-1252. `res.text()` would read UTF-8 only.
			const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096))
			const charset =
				/charset=["']?([\w-]+)/i.exec(type)?.[1] ??
				/<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
			const decode = (label: string, fatal = false) =>
				new TextDecoder(label, { fatal }).decode(bytes)
			let text: string
			try {
				text = charset ? decode(charset) : decode("utf-8", true)
			} catch {
				text = decode(charset ? "utf-8" : "windows-1252")
			}
			return serialize(new DOMParser().parseFromString(text, "text/html").documentElement)
		} catch {
			// Offline, blocked or slow: the rendered page is enough.
			return null
		}
	}
	const servedHtml = isArticle ? await fetchServed() : null
	return { url: location.href, title: document.title, html, servedHtml }
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
 * With `token` (the extension's own sign-in, `connect.ts`), it goes to the API instead, which
 * answers the same way.
 */
export async function saveToKlipstack(
	appUrl: string,
	payload: { url: string; html?: string; servedHtml?: string | null },
	fetchImpl: typeof fetch = fetch,
	token?: string,
): Promise<SaveResult> {
	try {
		const page = {
			...(payload.html ? { html: payload.html } : {}),
			...(payload.servedHtml ? { servedHtml: payload.servedHtml } : {}),
		}
		const res = await fetchImpl(
			token ? `${appUrl}/api/v1/articles` : `${appUrl}/api/documents`,
			token
				? {
						method: "POST",
						headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
						credentials: "omit",
						body: JSON.stringify({ url: payload.url, ...page, source: "extension" }),
					}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						credentials: "include",
						body: JSON.stringify({
							url: payload.url,
							html: payload.html ?? null,
							...(payload.servedHtml ? { servedHtml: payload.servedHtml } : {}),
							source: "extension",
						}),
					},
		)
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
 * Saves the page as captured. One too large to send (inline images, say: over the server's size
 * limits) goes without the page as served, then as its address alone, and the server fetches it.
 */
export async function savePage(
	appUrl: string,
	payload: { url: string; html?: string; servedHtml?: string | null },
	fetchImpl: typeof fetch = fetch,
	token?: string,
): Promise<SaveResult> {
	// Over the body limit (413), or a page the app refuses as too large (`invalid_request`).
	const tooLarge = (result: SaveResult) =>
		result.status === 413 || result.error === "invalid_request"
	// Both pages over the capture's body cap (12 MB) would only be refused: the rendered one alone.
	const both = (payload.html?.length ?? 0) + (payload.servedHtml?.length ?? 0)
	if (both > 11_000_000) payload = { url: payload.url, html: payload.html }
	let result = await saveToKlipstack(appUrl, payload, fetchImpl, token)
	if (!result.ok && payload.servedHtml && tooLarge(result))
		result = await saveToKlipstack(
			appUrl,
			{ url: payload.url, html: payload.html },
			fetchImpl,
			token,
		)
	if (result.ok || !payload.html || !tooLarge(result)) return result
	return saveToKlipstack(appUrl, { url: payload.url }, fetchImpl, token)
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
