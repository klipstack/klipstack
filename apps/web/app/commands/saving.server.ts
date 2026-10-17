import {
	HTML_MAX_BYTES,
	Id,
	Ids,
	SAVE_LINKS_MAX,
	URL_MAX,
	utf8Length,
} from "@klipstack/api-contract"
import { z } from "zod"
import { AppError, notFound, parseInput, rateLimited } from "~/lib/app-error"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { findStarterText } from "~/lib/starter-texts.server"
import { getDocument, saveDocument } from "~/services/documents.server"
import { feedItemUrl, markFeedItemViewed } from "~/services/feeds.server"
import { savedStarterTexts } from "~/services/starter-texts.server"
import { mayUseFeeds } from "./feeds.server"

/**
 * Saving pages to the library, wherever the save comes from: the web (a link, the Add page, the
 * feed), the extension, the API and MCP. They share one limit.
 */

const Page = z.string().refine((html) => utf8Length(html) <= HTML_MAX_BYTES, {
	message: `The page may not exceed ${HTML_MAX_BYTES} bytes.`,
})

const SaveRequest = z.object({
	url: z.string().trim().min(1).max(URL_MAX),
	/** The rendered page, captured by the extension or an agent: extracted instead of fetched. */
	html: Page.nullish(),
	/**
	 * With `html`, the same page as the site served it, which the extension fetches too: some
	 * paywalls send the whole article and cut it in the browser. Extraction keeps the longer. Over
	 * the web, both pages share the capture's body cap (`CAPTURE_BODY`).
	 */
	servedHtml: Page.nullish(),
	/** Where the save came from, kept with the capture. */
	source: z.enum(["web", "extension", "api", "feed"]),
})

export type SaveRequest = z.input<typeof SaveRequest>

/**
 * Saves a page: a new article (`created`), or the one already in the library, extracted again
 * when it failed or a capture came with it. `article` has its tags. Each save counts against the
 * save limit; a refused URL does not.
 */
export async function saveArticle(userId: string, input: SaveRequest) {
	const { url, html, servedHtml, source } = parseInput(SaveRequest, input)
	const limited = rateLimit(`save:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds, "saves")
	try {
		const { document, created } = await saveDocument({ userId, url, html, servedHtml, source })
		// An article saved before may have just been queued again, and has tags: read it again.
		const article = (created ? null : await getDocument(userId, document.id)) ?? {
			...document,
			tags: [] as string[],
		}
		return { article, created }
	} catch (error) {
		if (error instanceof AppError) limited.refund()
		throw error
	}
}

/** One link's outcome in `saveLinks`: its article, or why it was not saved. */
export type LinkResult =
	| { url: string; ok: true; articleId: string; created: boolean }
	| { url: string; ok: false; code: string; message: string; details?: Record<string, unknown> }

/** Distinct links, at most `SAVE_LINKS_MAX`: a link sent twice counts once. */
const Links = z
	.array(z.string().trim().min(1))
	.min(1)
	.transform((all) => [...new Set(all)])
	.pipe(z.array(z.string()).max(SAVE_LINKS_MAX, `Save at most ${SAVE_LINKS_MAX} links at once.`))

/**
 * Saves several links from the web, one by one, each as `saveArticle` saves it. Every link gets its
 * outcome, in order: a refused one (not a link, unsupported, past the save limit or a cap) does not
 * stop the rest from being tried.
 */
export async function saveLinks(userId: string, urls: string[]): Promise<LinkResult[]> {
	const list = parseInput(Links, urls)
	const results: LinkResult[] = []
	for (const url of list) {
		try {
			const { article, created } = await saveArticle(userId, { url, source: "web" })
			results.push({ url, ok: true, articleId: article.id, created })
		} catch (error) {
			if (!(error instanceof AppError)) throw error
			const { code, message, details } = error
			results.push({ url, ok: false, code, message, ...(details ? { details } : {}) })
		}
	}
	return results
}

const NO_POST = "No post with that id in the feed."

/** Saves a feed post's link, and marks the post read. The article's id. */
export async function saveFeedItem(userId: string, itemId: string) {
	await mayUseFeeds(userId)
	return savePost(userId, itemId)
}

async function savePost(userId: string, itemId: string) {
	const url = await feedItemUrl(userId, parseInput(Id, itemId))
	if (!url) throw notFound(NO_POST)
	const { article } = await saveArticle(userId, { url, source: "feed" })
	await markFeedItemViewed(userId, itemId)
	return { articleId: article.id }
}

/**
 * Saves feed posts, one by one. `notFound`: not a post in the user's feed. `notSaved`: refused,
 * with the refusal's code and message; past the save limit or at a cap, the rest are not saved.
 */
export async function saveFeedItems(userId: string, ids: string[]) {
	await mayUseFeeds(userId)
	const list = parseInput(
		Ids.transform((all) => [...new Set(all)]),
		ids,
	)
	const saved: Array<{ itemId: string; articleId: string }> = []
	const notFoundIds: string[] = []
	const notSaved: Array<{ itemId: string; code: string; message: string }> = []
	for (const [index, itemId] of list.entries()) {
		try {
			saved.push({ itemId, ...(await savePost(userId, itemId)) })
		} catch (error) {
			if (!(error instanceof AppError)) throw error
			if (error.code === "not_found") {
				notFoundIds.push(itemId)
				continue
			}
			const stop = error.code === "rate_limited" || error.code === "limit_reached"
			const refused = stop ? list.slice(index) : [itemId]
			for (const id of refused)
				notSaved.push({ itemId: id, code: error.code, message: error.message })
			if (stop) break
		}
	}
	return { saved, notFound: notFoundIds, notSaved }
}

/**
 * Adds a starter text (`lib/starter-texts.server.ts`) to the library, from the page that ships
 * with the app or, for a linked one, from its site. One already there is left as it is,
 * highlights, notes and all, even when the text has changed since: the reader opens their copy. A
 * linked one is saved as any link, so a copy whose fetch failed is fetched again. The article's id.
 */
export async function saveStarterText(userId: string, slug: string) {
	const text = findStarterText(parseInput(StarterSlug, slug))
	if (!text) throw notFound("No starter text with that name.")
	if (text.kind !== "link") {
		const saved = (await savedStarterTexts(userId, [text])).get(text.slug)
		if (saved) return { articleId: saved, created: false }
	}
	const { article, created } = await saveArticle(userId, {
		url: text.url,
		html: text.html,
		source: "web",
	})
	return { articleId: article.id, created }
}

const StarterSlug = z.string().trim().min(1).max(100)
