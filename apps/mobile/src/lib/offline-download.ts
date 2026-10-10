import type { ArticleSummary, KlipstackClient } from "@klipstack/sdk"
import {
	forgetLists,
	loadArticle,
	lostConnection,
	pruneArticles,
	saveArticle,
	saveList,
} from "./offline"
import { forgetReadArticles, readerFolder, storeAsset } from "./reader-files"
import { localImages } from "./reader-html"

/**
 * Downloads ahead, for offline reading: each ready article a kept list shows (offline.ts), with
 * its stored images. One pass at a time; articles asked for meanwhile join the next. An article
 * kept in the last hour isn't asked for again, as the web's worker does (`ARTICLE_FRESH_MS`); an
 * image never changes under its id. A pass stops at the first sign that the connection is gone.
 */

const FRESH_MS = 60 * 60 * 1000

/** The articles each kept list showed last: what pruning keeps, in this order. */
const shown = new Map<Shelf, string[]>()
const queue = new Map<string, ArticleSummary>()
let running: Promise<void> | null = null
// Signing out stops a pass: nothing it downloads after may be written.
let generation = 0

/** Where the articles to keep show. */
type Shelf = "home" | "inbox" | "starred"

export function downloadAhead(client: KlipstackClient, list: Shelf, items: ArticleSummary[]) {
	shown.set(
		list,
		items.map((a) => a.id),
	)
	for (const item of items) if (item.status === "ready") queue.set(item.id, item)
	running ??= drain(client, generation).finally(() => {
		running = null
	})
	return running
}

/** Inbox's and Starred's first pages are asked for from Home at most this often. */
const LISTS_EVERY_MS = 10 * 60 * 1000
let listsAt = 0

/**
 * Inbox's and Starred's first pages, kept from Home as if they had been opened, so an app used only
 * from Home has them offline too. The web keeps them only once they're opened.
 */
export function keepLibraryLists(client: KlipstackClient, now = Date.now()): void {
	if (now - listsAt < LISTS_EVERY_MS) return
	listsAt = now
	const started = generation
	for (const view of ["inbox", "starred"] as const) {
		client.articles
			.list({ view, sort: "newest", limit: 30 })
			.then((page) => {
				if (started !== generation) return
				saveList(view, page.items)
				void downloadAhead(client, view, page.items)
			})
			.catch(() => {
				listsAt = 0
			})
	}
}

/** Everything kept for offline reading, at sign-out. */
export function forgetOffline(): void {
	generation++
	listsAt = 0
	queue.clear()
	shown.clear()
	forgetReadArticles()
	forgetLists()
}

/** For tests: the pass on its way, if any. */
export function downloading(): Promise<void> | null {
	return running
}

async function drain(client: KlipstackClient, started: number): Promise<void> {
	try {
		for (let next = take(); next; next = take()) {
			if (started !== generation) return
			await download(client, next, started)
		}
	} catch {
		// The connection is gone: what's left waits for the lists to load again.
		queue.clear()
	}
	if (started !== generation) return
	const keep = [...new Set([...shown.values()].flat())]
	pruneArticles(keep)
}

function take(): ArticleSummary | undefined {
	const [first] = queue.values()
	if (first) queue.delete(first.id)
	return first
}

async function download(client: KlipstackClient, item: ArticleSummary, started: number) {
	const kept = loadArticle(item.id)
	let stored = kept?.stored
	if (!kept || Date.now() - kept.savedAt >= FRESH_MS) {
		try {
			const details = await client.articles.get(item.id)
			if (details.status !== "ready") return
			stored = await client.articles.html(item.id)
			if (started !== generation) return
			saveArticle(details, stored)
		} catch (error) {
			// Gone or refused (deleted meanwhile), or a server error: the next article.
			if (lostConnection(error)) throw error
			return
		}
	}
	if (!stored) return
	const folder = readerFolder(item.id)
	for (const asset of localImages(stored.html).ids) {
		if (started !== generation) return
		try {
			await storeAsset(folder, asset, client)
		} catch (error) {
			// An image that won't download stays a placeholder, as in the reader.
			if (lostConnection(error)) throw error
		}
	}
}
