import { articleAuthor } from "@klipstack/api-contract/highlight-share"

/** A site's own name, unless it is a long tagline: the host says the same in less space. */
export function siteLabel(siteName: string | null, host: string): string {
	if (!siteName) return host
	return siteName.length > host.length + 6 ? host : siteName
}

/**
 * Who wrote an article, to credit beside its site in a shared highlight: null when unknown, or when
 * it only repeats the site's name (as stored or as shown) or the title.
 */
export function creditAuthor(article: {
	title: string | null
	url: string
	siteName: string | null
	author?: string | null
}): string | null {
	const shown = siteLabel(article.siteName, safeHost(article.url))
	return articleAuthor(article) && articleAuthor({ ...article, siteName: shown })
}

/**
 * Where an article comes from, in a line that has room for the site only (Home). On X the site
 * says nothing about who wrote it, so the author comes along: "X.com · Jane Doe".
 */
export function sourceLabel(doc: {
	siteName: string | null
	author: string | null
	sourceUrl: string
}): string {
	const host = safeHost(doc.sourceUrl)
	const site = siteLabel(doc.siteName, host)
	return host === "x.com" && doc.author ? `${site} · ${doc.author}` : site
}

export function safeHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "")
	} catch {
		return url
	}
}
