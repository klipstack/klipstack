import type { LinkPreview } from "./link-preview"

interface PreviewRequest {
	/** Undefined while the request is pending; null when no preview is available. */
	value: LinkPreview | null | undefined
	result: Promise<LinkPreview | null>
	expires: number
}

/** Kept by one reader, so hover, click and reopening a link share a request. */
export function createLinkPreviewCache() {
	const entries = new Map<string, PreviewRequest>()
	let pending = 0
	const key = (href: string) => {
		try {
			const url = new URL(href)
			url.hash = ""
			return url.href
		} catch {
			// A malformed article link still gets the endpoint's normal unavailable fallback.
			return href
		}
	}
	const peek = (href: string) => {
		const entry = entries.get(key(href))
		return entry && entry.expires > Date.now() ? entry : undefined
	}
	const load = (href: string): PreviewRequest => {
		const existing = peek(href)
		if (existing) return existing
		const url = key(href)
		entries.delete(url)
		if (entries.size >= 50) entries.delete(entries.keys().next().value!)
		pending++
		const entry: PreviewRequest = {
			value: undefined,
			expires: Date.now() + 5 * 60_000,
			result: fetch(`/api/link-preview?${new URLSearchParams({ url: href })}`, {
				signal: AbortSignal.timeout(8_000),
			})
				.then(async (response) => {
					if (!response.ok) return null
					return ((await response.json()) as { preview: LinkPreview | null }).preview
				})
				.catch(() => null)
				.then((preview) => {
					entry.value = preview
					entry.expires = Date.now() + (preview ? 5 * 60_000 : 60_000)
					pending--
					return preview
				}),
		}
		entries.set(url, entry)
		return entry
	}
	return {
		peek,
		load,
		prefetch(href: string) {
			// Speculative work stays small; opening a card can always start its own request.
			if (pending < 2) load(href)
		},
	}
}

export type LinkPreviewCache = ReturnType<typeof createLinkPreviewCache>
