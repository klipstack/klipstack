import { articleAuthor } from "@klipstack/api-contract/highlight-share"

/** A site's own name, unless it is a long tagline: the host says the same in less space. */
export function siteLabel(siteName: string | null, host: string): string {
	if (!siteName) return host
	return siteName.length > host.length + 6 ? host : siteName
}

/**
 * Who wrote an article and where, for a shared highlight: "Jane Doe · The Guardian", or the site
 * alone when the author is unknown or only repeats the site or the title.
 */
export function creditLabel(article: {
	title: string | null
	url: string
	siteName: string | null
	author?: string | null
}): string {
	const site = siteLabel(article.siteName, safeHost(article.url))
	const author = articleAuthor({ ...article, siteName: site })
	return author ? `${author} · ${site}` : site
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
