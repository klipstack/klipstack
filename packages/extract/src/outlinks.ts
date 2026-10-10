import { isHttpUrl, normalizeUrl, urlHash } from "./url"

/** Most addresses kept per article: a link roundup fits, a scraped sitemap does not. */
export const OUTLINKS_MAX = 500

/**
 * The addresses an article's HTML links to: the `href` as written and the hash of its address, as
 * saving would hash it (several spellings of one URL give one hash). `html` is the extracted
 * article, whose hrefs are absolute except for links within the page; `baseUrl` covers the ones
 * that are not. Stops once `OUTLINKS_MAX` different addresses are found.
 */
export function articleOutlinks(html: string, baseUrl: string): { href: string; hash: string }[] {
	const links: { href: string; hash: string }[] = []
	const hashes = new Set<string>()
	const hrefs = new Set<string>()
	for (const m of html.matchAll(/<a\s[^>]*?href="([^"]+)"/gi)) {
		if (hashes.size >= OUTLINKS_MAX) break
		const href = (m[1] ?? "").replace(/&amp;/g, "&")
		if (href.startsWith("#") || hrefs.has(href)) continue
		try {
			const abs = new URL(href, baseUrl).href
			if (!isHttpUrl(abs)) continue
			hrefs.add(href)
			const hash = urlHash(normalizeUrl(abs))
			hashes.add(hash)
			links.push({ href, hash })
		} catch {
			// unparsable
		}
	}
	return links
}

/** The hashes of the addresses an article's HTML links to, each once (see `articleOutlinks`). */
export function outlinkHashes(html: string, baseUrl: string): string[] {
	return [...new Set(articleOutlinks(html, baseUrl).map((link) => link.hash))]
}
