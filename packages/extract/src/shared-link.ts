import { countWords, plainText } from "@klipstack/anchor"
import { JSDOM } from "jsdom"
import type { ExtractedArticle } from "./pipeline"
import { isHttpUrl, normalizeUrl } from "./url"

/** Words a post may say besides its links and still only share one. */
export const SHARED_LINK_MAX_WORDS = 60

/**
 * The page a short post only passes along: a post (not a long-form article) of at most
 * `SHARED_LINK_MAX_WORDS` words besides its links, with exactly one address that leaves the post's
 * site. Links in quoted posts and pictures don't count; mentions and tags stay on the post's site.
 * The rule reads the extracted post, not the platform: any extractor that makes posts gets it.
 * Null when the post says more than that, or links nowhere else, or to several places.
 */
export function sharedLink(article: ExtractedArticle, postUrl: string): string | null {
	if (article.type !== "post") return null
	const body = new JSDOM(`<!doctype html><body>${article.html}</body>`).window.document.body
	for (const el of Array.from(body.querySelectorAll("blockquote, figure"))) el.remove()

	const sites = new Set([siteOf(postUrl), siteOf(article.canonicalUrl)].filter(Boolean))
	const targets = new Map<string, string>()
	for (const a of Array.from(body.querySelectorAll("a[href]"))) {
		const href = a.getAttribute("href") ?? ""
		a.remove()
		try {
			const abs = new URL(href, postUrl).href
			if (!isHttpUrl(abs) || sites.has(siteOf(abs))) continue
			const key = normalizeUrl(abs)
			if (!targets.has(key)) targets.set(key, abs)
		} catch {
			// unparsable
		}
	}
	if (targets.size !== 1) return null
	if (countWords(plainText(body)) > SHARED_LINK_MAX_WORDS) return null
	return [...targets.values()][0] ?? null
}

/** The host without `www.`, or "" when the address doesn't parse. */
function siteOf(url: string | null): string {
	if (!url) return ""
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
	} catch {
		return ""
	}
}

/**
 * A shared post's HTML as kept beside the article it shared: its text and links, without its
 * pictures, which would load from the platform each time.
 */
export function sharedPostHtml(html: string): string {
	const body = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
	for (const el of Array.from(body.querySelectorAll("figure"))) el.remove()
	return body.innerHTML
}
