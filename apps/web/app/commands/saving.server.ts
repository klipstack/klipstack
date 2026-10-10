import { HTML_MAX_BYTES, Id, Ids, URL_MAX, utf8Length } from "@klipstack/api-contract"
import { z } from "zod"
import { AppError, notFound, parseInput, rateLimited } from "~/lib/app-error"
import { rateLimit, SAVE_LIMIT } from "~/lib/rate-limit.server"
import { getDocument, saveDocument } from "~/services/documents.server"
import { feedItemUrl, markFeedItemViewed } from "~/services/feeds.server"

/**
 * Saving pages to the library, wherever the save comes from: the web (a link, the Add page, the
 * feed), the extension, the API and MCP. They share one limit.
 */

const SaveRequest = z.object({
	url: z.string().trim().min(1).max(URL_MAX),
	/** The rendered page, captured by the extension or an agent: extracted instead of fetched. */
	html: z
		.string()
		.refine((html) => utf8Length(html) <= HTML_MAX_BYTES, {
			message: `The page may not exceed ${HTML_MAX_BYTES} bytes.`,
		})
		.nullish(),
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
	const { url, html, source } = parseInput(SaveRequest, input)
	const limited = rateLimit(`save:${userId}`, SAVE_LIMIT.limit, SAVE_LIMIT.windowMs)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds, "saves")
	try {
		const { document, created } = await saveDocument({ userId, url, html, source })
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

const NO_POST = "No post with that id in the feed."

/** Saves a feed post's link, and marks the post read. The article's id. */
export async function saveFeedItem(userId: string, itemId: string) {
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
	const list = parseInput(
		Ids.transform((all) => [...new Set(all)]),
		ids,
	)
	const saved: Array<{ itemId: string; articleId: string }> = []
	const notFoundIds: string[] = []
	const notSaved: Array<{ itemId: string; code: string; message: string }> = []
	for (const [index, itemId] of list.entries()) {
		try {
			saved.push({ itemId, ...(await saveFeedItem(userId, itemId)) })
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
