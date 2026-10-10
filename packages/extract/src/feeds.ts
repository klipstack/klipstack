import { parseFeed as parseXmlFeed } from "@rowanmanning/feed-parser"
import { JSDOM } from "jsdom"
import { ExtractError } from "./errors"
import { type FetchedPage, type FetchPageOptions, fetchPage } from "./fetch"
import { normalizeUrl } from "./url"

/** One entry of a feed, as the app stores it. */
export interface FeedEntry {
	/** The entry's id; its link when the feed gives none. */
	guid: string
	/** Normalized link to the post. */
	url: string
	title: string | null
	author: string | null
	/** Plain text, whitespace collapsed, truncated to `EXCERPT_MAX`. */
	excerpt: string | null
	publishedAt: Date | null
}

export interface ParsedFeed {
	title: string | null
	siteUrl: string | null
	entries: FeedEntry[]
}

export const EXCERPT_MAX = 280

/** Feeds announce themselves as one of these; some servers send plain XML, JSON or even HTML. */
export const FEED_CONTENT_TYPES =
	/rss\+xml|atom\+xml|rdf\+xml|feed\+json|application\/json|application\/xml|text\/xml|text\/html|application\/xhtml\+xml|text\/plain/i

const FEED_ACCEPT =
	"application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5"

/** Honest about who is asking; feed hosts expect readers to say so. */
export const FEED_USER_AGENT = "Klipstack/1.0 (feed reader)"

/** Paths tried when a site links no feed from its home page. */
export const COMMON_FEED_PATHS = [
	"/feed",
	"/rss",
	"/rss.xml",
	"/atom.xml",
	"/feed.xml",
	"/index.xml",
]

/** Fetch a feed (or a page that may link one) with the feed reader's headers. */
export function fetchFeed(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
	return fetchPage(url, {
		userAgent: FEED_USER_AGENT,
		contentTypes: FEED_CONTENT_TYPES,
		...options,
		headers: { accept: FEED_ACCEPT, ...options.headers },
	})
}

/**
 * Parse RSS, Atom, RDF or JSON Feed. Relative links resolve against `feedUrl`. Entries without a
 * usable link are dropped. Throws `not_feed` when the text is not a feed.
 */
export function parseFeedDocument(text: string, feedUrl: string): ParsedFeed {
	const trimmed = text.trimStart()
	if (trimmed.startsWith("{")) return parseJsonFeed(trimmed, feedUrl)
	if (!trimmed.startsWith("<")) throw new ExtractError("not_feed", "Not a feed")
	let feed: ReturnType<typeof parseXmlFeed>
	try {
		feed = parseXmlFeed(trimmed)
	} catch (cause) {
		throw new ExtractError("not_feed", "Not a feed", { cause })
	}
	const siteUrl = absolute(feed.url, feedUrl)
	const entries: FeedEntry[] = []
	for (const item of feed.items) {
		const url = entryUrl(item.url, siteUrl ?? feedUrl)
		if (!url) continue
		const title = plainText(item.title)
		entries.push({
			guid: item.id?.trim() || url,
			url,
			title,
			author: item.authors[0]?.name?.trim() || null,
			excerpt: excerpt(item.description ?? item.content, title),
			publishedAt: validDate(item.published ?? item.updated),
		})
	}
	return { title: plainText(feed.title), siteUrl, entries }
}

interface JsonFeedItem {
	id?: unknown
	url?: unknown
	external_url?: unknown
	title?: unknown
	summary?: unknown
	content_html?: unknown
	content_text?: unknown
	date_published?: unknown
	date_modified?: unknown
	author?: { name?: unknown }
	authors?: { name?: unknown }[]
}

function parseJsonFeed(text: string, feedUrl: string): ParsedFeed {
	let json: { version?: unknown; title?: unknown; home_page_url?: unknown; items?: unknown }
	try {
		json = JSON.parse(text)
	} catch (cause) {
		throw new ExtractError("not_feed", "Not a feed", { cause })
	}
	if (typeof json.version !== "string" || !json.version.includes("jsonfeed.org"))
		throw new ExtractError("not_feed", "Not a JSON Feed")
	const siteUrl = absolute(str(json.home_page_url), feedUrl)
	const items = Array.isArray(json.items) ? (json.items as JsonFeedItem[]) : []
	const entries: FeedEntry[] = []
	for (const item of items) {
		const url = entryUrl(str(item.url) ?? str(item.external_url), feedUrl)
		if (!url) continue
		const id = item.id === undefined || item.id === null ? null : String(item.id).trim()
		const title = plainText(str(item.title))
		entries.push({
			guid: id || url,
			url,
			title,
			author: str(item.authors?.[0]?.name)?.trim() || str(item.author?.name)?.trim() || null,
			excerpt:
				excerpt(str(item.summary) ?? str(item.content_html), title) ??
				truncate(withoutTitle(collapse(str(item.content_text) ?? ""), title)),
			publishedAt: validDate(str(item.date_published) ?? str(item.date_modified)),
		})
	}
	return { title: plainText(str(json.title)), siteUrl, entries }
}

export interface FeedLink {
	url: string
	title: string | null
}

/** Feeds a page advertises with `<link rel="alternate">`, comment feeds last. */
export function discoverFeedLinks(html: string, pageUrl: string): FeedLink[] {
	const { document } = new JSDOM(html).window
	const seen = new Set<string>()
	const links: FeedLink[] = []
	for (const el of document.querySelectorAll("link[rel~='alternate'][href]")) {
		const type = el.getAttribute("type")?.toLowerCase() ?? ""
		if (!/rss\+xml|atom\+xml|rdf\+xml|feed\+json/.test(type)) continue
		const url = absolute(el.getAttribute("href"), pageUrl)
		if (!url || seen.has(url)) continue
		seen.add(url)
		links.push({ url, title: el.getAttribute("title")?.trim() || null })
	}
	const isComments = (l: FeedLink) => /comment/i.test(`${l.title ?? ""} ${l.url}`)
	return [...links.filter((l) => !isComments(l)), ...links.filter(isComments)]
}

/** Most `<a>` links tried as feeds when a page advertises none with `<link>`. */
const MAX_ANCHOR_CANDIDATES = 5

/**
 * Links in the page body that look like feeds (`.rss`, `.atom`, `/feed`…), for pages such as "Subscribe
 * via RSS" that link a feed without a `<link rel="alternate">`. Unverified: callers must parse them.
 */
export function discoverFeedAnchors(html: string, pageUrl: string): string[] {
	const { document } = new JSDOM(html).window
	const seen = new Set<string>()
	for (const el of document.querySelectorAll("a[href]")) {
		const url = absolute(el.getAttribute("href"), pageUrl)
		if (!url || seen.has(url)) continue
		const { pathname } = new URL(url)
		if (
			/\.(rss|atom|rdf|xml)$|\/(feed|rss|atom)(\.json|\/)?$|feed\.json$/i.test(pathname) &&
			!/comment/i.test(url)
		)
			seen.add(url)
		if (seen.size >= MAX_ANCHOR_CANDIDATES) break
	}
	return [...seen]
}

export type FeedResolution =
	| { kind: "feed"; url: string; page: FetchedPage; feed: ParsedFeed }
	| { kind: "choices"; links: FeedLink[] }

type Fetcher = (url: string, options?: FetchPageOptions) => Promise<FetchedPage>

/**
 * Turn what the user pasted into a feed: the feed itself, a page linking exactly one feed (comment
 * feeds aside), a page with a plain link to one, or a site with a feed at a common path. A page with several feeds returns them to
 * choose from. Throws `not_feed` when nothing is found.
 */
export async function resolveFeed(
	input: string,
	fetcher: Fetcher = fetchFeed,
): Promise<FeedResolution> {
	const url = normalizeUrl(input)
	const page = await fetcher(url)
	const direct = tryParse(page)
	if (direct) return { kind: "feed", url: page.finalUrl, page, feed: direct }

	const links = discoverFeedLinks(page.html, page.finalUrl)
	const main = links.filter((l) => !/comment/i.test(`${l.title ?? ""} ${l.url}`))
	// The same posts in several formats ("Blog (RSS)", "Blog (Atom)", or all untitled) are one
	// feed: take the first, instead of asking.
	const distinct = new Set(main.map((l) => formatless(l.title)))
	if (main.length > 1 && distinct.size > 1) return { kind: "choices", links: main }
	const candidates = main.slice(0, 1).map((l) => l.url)
	if (links.length === 0) {
		const origin = new URL(page.finalUrl).origin
		candidates.push(
			...discoverFeedAnchors(page.html, page.finalUrl),
			...COMMON_FEED_PATHS.map((path) => `${origin}${path}`),
		)
	}
	for (const candidate of candidates) {
		try {
			const res = await fetcher(candidate, { timeoutMs: 8_000 })
			const feed = tryParse(res)
			if (feed) return { kind: "feed", url: res.finalUrl, page: res, feed }
		} catch {
			// try the next one
		}
	}
	throw new ExtractError("not_feed", `No feed found at ${url}`)
}

/** A feed link's title without format words, to tell formats of one feed from different feeds. */
function formatless(title: string | null): string {
	return (title ?? "")
		.toLowerCase()
		.replace(/\b(rss|atom|json|xml|feed)\b|[\d.]+/g, "")
		.replace(/[^\p{L}]+/gu, "")
}

function tryParse(page: FetchedPage): ParsedFeed | null {
	try {
		return parseFeedDocument(page.html, page.finalUrl)
	} catch (error) {
		if (error instanceof ExtractError && error.code === "not_feed") return null
		throw error
	}
}

function str(value: unknown): string | null {
	return typeof value === "string" ? value : null
}

function absolute(href: string | null | undefined, base: string): string | null {
	if (!href?.trim()) return null
	try {
		const u = new URL(href.trim(), base)
		return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null
	} catch {
		return null
	}
}

function entryUrl(href: string | null | undefined, base: string): string | null {
	const url = absolute(href, base)
	if (!url) return null
	try {
		return normalizeUrl(url)
	} catch {
		return null
	}
}

/**
 * A publish date that makes sense: from 1990 (before any feed) to a year ahead. A feed can say
 * anything, and a year like 20240 would print as "+020240-…", which the API's own schema and
 * Postgres readers refuse.
 */
const EARLIEST = Date.UTC(1990, 0, 1)
const AHEAD_MS = 366 * 86_400_000

function validDate(value: Date | string | null | undefined): Date | null {
	if (!value) return null
	const date = value instanceof Date ? value : new Date(value)
	const time = date.getTime()
	if (Number.isNaN(time) || time < EARLIEST || time > Date.now() + AHEAD_MS) return null
	return date
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim()
}

function truncate(text: string): string | null {
	if (!text) return null
	if (text.length <= EXCERPT_MAX) return text
	const cut = text.slice(0, EXCERPT_MAX)
	const space = cut.lastIndexOf(" ")
	return `${(space > EXCERPT_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Text of an HTML fragment (titles in Atom can be HTML), whitespace collapsed. */
function plainText(html: string | null | undefined): string | null {
	if (!html) return null
	const text = collapse(html.includes("<") || html.includes("&") ? htmlText(html) : html)
	return text || null
}

/** Plain-text excerpt of a summary or content, without the title many feeds repeat at its start. */
function excerpt(html: string | null | undefined, title: string | null): string | null {
	const text = plainText(html)
	return text ? truncate(withoutTitle(text, title)) : null
}

function withoutTitle(text: string, title: string | null): string {
	if (!title || !text.startsWith(title)) return text
	return text.slice(title.length).replace(/^[\s:.\-–—|]+/, "")
}

function htmlText(html: string): string {
	// Block ends become spaces, so "<p>One</p><p>Two</p>" does not read "OneTwo".
	const spaced = html
		.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, " $&")
	return JSDOM.fragment(`<div>${spaced}</div>`).textContent ?? ""
}
