import { extractMetadata, fetchPage, hostIsBlocked } from "@klipstack/extract"
import { JSDOM, VirtualConsole } from "jsdom"
import type { LinkPreview } from "~/lib/link-preview"

const CACHE_MAX = 200
const CACHE_MS = 15 * 60_000
const FAILURE_CACHE_MS = 60_000
const MAX_PENDING = 8
const cache = new Map<string, { expires: number; result: Promise<LinkPreview | null> }>()
let pending = 0

function text(value: string | null, max: number): string | null {
	return value?.replace(/\s+/g, " ").trim().slice(0, max) || null
}

async function fetchPreview(url: string): Promise<LinkPreview | null> {
	const page = await fetchPage(url, {
		headOnly: true,
		maxBytes: 256 * 1024,
		timeoutMs: 5_000,
		maxRedirects: 3,
		contentTypes: /^(text\/html|application\/xhtml\+xml)(?:;|$)/i,
	})
	// No scripts or subresources run. Close the DOM as soon as the metadata is read.
	const dom = new JSDOM(page.html, { url: page.finalUrl, virtualConsole: new VirtualConsole() })
	try {
		const meta = extractMetadata(dom.window.document, page.finalUrl)
		const image = meta.leadImageUrl ? new URL(meta.leadImageUrl) : null
		return {
			title: text(meta.title, 300),
			description: text(meta.description, 600),
			author: text(meta.author ?? meta.ldAuthor ?? meta.twitterHandle, 200),
			siteName: text(meta.siteName, 100),
			imageUrl:
				image &&
				image.href.length <= 4096 &&
				!image.username &&
				!image.password &&
				!hostIsBlocked(image.hostname)
					? image.href
					: null,
		}
	} finally {
		dom.window.close()
	}
}

/** Previews per user and minute, shared by the reader's card and the API. */
export const PREVIEW_LIMIT = { limit: 30, windowMs: 60_000 }

/** The URL to preview, without its fragment; null unless http(s) without a user name or password. */
export function previewableUrl(raw: string): URL | null {
	if (raw.length > 4096) return null
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		return null
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null
	url.hash = ""
	return url
}

/** Bounded, short-lived cache, including in-flight requests and unavailable previews. */
export function getLinkPreview(url: string): Promise<LinkPreview | null> {
	const cached = cache.get(url)
	if (cached && cached.expires > Date.now()) return cached.result
	if (pending >= MAX_PENDING) return Promise.resolve(null)
	cache.delete(url)
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
	pending++
	const entry = {
		expires: Date.now() + CACHE_MS,
		result: fetchPreview(url)
			.catch(() => null)
			.then((preview) => {
				entry.expires = Date.now() + (preview ? CACHE_MS : FAILURE_CACHE_MS)
				return preview
			})
			.finally(() => pending--),
	}
	cache.set(url, entry)
	return entry.result
}
