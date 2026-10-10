import { join } from "node:path"
import { parseFeedDocument, resolveFeed, type ParsedFeed } from "@klipstack/extract"
import { z } from "zod"
import {
	blobSchema,
	captureUrl,
	getBlob,
	hash,
	loadCapture,
	putBlob,
	readJson,
	writeJson,
} from "./cache"

const schema = z.object({
	format: z.literal(1),
	url: z.string().url(),
	capturedAt: z.string().datetime(),
	page: blobSchema,
	savedUrl: z.string().url().nullable(),
})
export type FeedCapture = z.infer<typeof schema>
export interface PreparedFeed {
	capture: FeedCapture
	feed: ParsedFeed
	captureHash: string
}
const path = (cache: string, url: string) => join(cache, "feeds", `${hash(url)}.json`)

export async function loadFeedCapture(cache: string, url: string): Promise<FeedCapture | null> {
	const raw = await readJson(path(cache, url))
	if (!raw) return null
	const capture = schema.parse(raw)
	if (capture.url !== url) throw new Error(`Feed capture URL mismatch: ${url}`)
	return capture
}

/** Capture the feed and one real article for a functional Saved/Read example. No DB access. */
export async function captureFeed(cache: string, url: string, deps = { resolveFeed, captureUrl }) {
	const result = await deps.resolveFeed(url)
	if (result.kind !== "feed")
		throw new Error(`Several feeds found; put a specific feed URL in the list: ${url}`)
	const entries = demoEntries(result.feed)
	let savedUrl: string | null = null
	for (const entry of entries.slice(0, 3).reverse()) {
		try {
			await deps.captureUrl(cache, entry.url)
			savedUrl = entry.url
			break
		} catch (error) {
			console.log(
				`Saved example skipped: ${entry.url}: ${error instanceof Error ? error.message : error}`,
			)
		}
	}
	const capture: FeedCapture = {
		format: 1,
		url,
		capturedAt: new Date().toISOString(),
		page: {
			sha256: await putBlob(cache, Buffer.from(result.page.html)),
			contentType: result.page.contentType,
			finalUrl: result.url,
		},
		savedUrl,
	}
	await writeJson(path(cache, url), capture)
	return capture
}

/** Bound fixtures while retaining publication dates and feed order for undated posts. */
export function demoEntries(feed: ParsedFeed) {
	return [...new Map(feed.entries.map((entry) => [entry.guid, entry])).values()]
		.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
		.slice(0, 8)
}

export async function prepareFeeds(cache: string, urls: string[]): Promise<PreparedFeed[]> {
	const prepared: PreparedFeed[] = []
	for (const url of urls) {
		const capture = await loadFeedCapture(cache, url)
		if (!capture) {
			console.log(`No feed capture, skipped: ${url}. Run pnpm demo:capture-feeds`)
			continue
		}
		const feed = parseFeedDocument(
			(await getBlob(cache, capture.page)).toString("utf8"),
			capture.page.finalUrl,
		)
		if (capture.savedUrl) {
			if (!demoEntries(feed).some((entry) => entry.url === capture.savedUrl))
				throw new Error(`Saved post is missing from feed: ${url}`)
			const article = await loadCapture(cache, capture.savedUrl)
			if (!article) throw new Error(`Saved post capture missing: ${capture.savedUrl}`)
			await getBlob(cache, article.page)
			for (const image of Object.values(article.images))
				if (!("error" in image)) await getBlob(cache, image)
		}
		prepared.push({ capture, feed, captureHash: hash(JSON.stringify(capture)) })
	}
	return prepared
}
