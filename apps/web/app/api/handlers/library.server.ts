import { Readable } from "node:stream"
import type {
	exportLibrary,
	getAsset,
	getFeed,
	listFeeds,
	listHighlights,
	listSavedSearches as listSavedSearchesEndpoint,
	listTags as listTagsEndpoint,
	listTopics as listTopicsEndpoint,
} from "@klipstack/api-contract"
import { and, assets, db, eq } from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { downloadResponse } from "~/lib/download-response.server"
import { getDocument } from "~/services/documents.server"
import { downloadExport } from "~/services/export.server"
import { listFeedPage, listFollowedFeeds } from "~/services/feeds.server"
import { listUserHighlights } from "~/services/highlights.server"
import { listSavedSearches } from "~/services/saved-searches.server"
import { listTags } from "~/services/tags.server"
import { listTopics, topicList } from "~/services/topics.server"
import {
	encodeFeedCursor,
	encodeHighlightCursor,
	feedCursor,
	highlightCursor,
	invalidCursor,
} from "../cursors.server"
import { notFound } from "../errors.server"
import type { Handler } from "../handler.server"
import { NO_ARTICLE } from "./articles.server"
import { highlightShape } from "./shapes.server"

/** The file as stored, always through the app: the storage bucket stays private. */
export const asset: Handler<typeof getAsset> = async ({ request, userId, params }) => {
	const row = await db.query.assets.findFirst({
		where: and(eq(assets.id, params.id), eq(assets.userId, userId)),
	})
	if (!row) throw notFound("No image with that id.")
	const etag = `"${row.sha256}"`
	if (request.headers.get("if-none-match") === etag)
		return new Response(null, { status: 304, headers: { etag } })
	const object = await getStorage().get(row.storageKey)
	if (!object) throw notFound("The stored copy of that image is gone.")
	return new Response(Readable.toWeb(object.body) as ReadableStream, {
		headers: {
			"content-type": object.contentType ?? row.contentType,
			"content-length": String(object.size ?? row.bytes),
			etag,
			"cache-control": "private, max-age=31536000, immutable",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
		},
	})
}

export const highlights: Handler<typeof listHighlights> = async ({ userId, query }) => {
	if (query.article && !(await getDocument(userId, query.article))) throw notFound(NO_ARTICLE)
	const page = await listUserHighlights({
		userId,
		documentId: query.article,
		q: query.q,
		filter: query.filter ?? null,
		limit: query.limit,
		cursor: highlightCursor(query.cursor),
	})
	return {
		items: page.items.map((h) =>
			highlightShape(h, {
				id: h.documentId,
				title: h.documentTitle,
				site: h.siteName,
				url: h.sourceUrl,
			}),
		),
		nextCursor: page.nextCursor ? encodeHighlightCursor(page.nextCursor) : null,
	}
}

export const feed: Handler<typeof getFeed> = async ({ userId, query }) => {
	const listedAt = new Date().toISOString()
	// A cursor names its feed; `feed` may repeat it, not contradict it.
	const after = feedCursor(query.cursor)
	if (after && query.feed && query.feed !== after.feed) throw invalidCursor()
	const { sections, quiet } = await listFeedPage(userId, {
		subscriptionId: after?.feed ?? query.feed,
		newOnly: query.newOnly,
		perFeed: query.perFeed,
		after,
	})
	const summary = (s: (typeof quiet)[number]) => ({
		id: s.id,
		title: s.title,
		siteUrl: s.siteUrl,
		notUpdating: s.trouble,
	})
	const feeds = sections.map((section) => {
		const last = section.items.at(-1)
		return {
			...summary(section),
			newCount: section.newCount,
			items: section.items.map((i) => ({
				id: i.id,
				title: i.title,
				url: i.url,
				author: i.author,
				excerpt: i.excerpt,
				publishedAt: i.publishedAt?.toISOString() ?? null,
				new: i.isNew,
				savedArticleId: i.documentId,
			})),
			moreItems: section.moreItems,
			nextCursor:
				section.moreItems > 0 && last
					? encodeFeedCursor({ feed: section.id, sortKey: last.sortKey, id: last.id })
					: null,
		}
	})
	return { listedAt, feeds, quietFeeds: quiet.map(summary) }
}

export const feeds: Handler<typeof listFeeds> = async ({ userId }) => {
	const items = await listFollowedFeeds(userId)
	return {
		items: items.map((f) => ({
			id: f.id,
			title: f.title,
			siteUrl: f.siteUrl,
			newCount: f.newCount,
			notUpdating: f.trouble,
		})),
	}
}

/**
 * Built in memory, like Settings → Export; `downloadExport` limits it per user because of that,
 * for every entry point.
 */
export const exportAll: Handler<typeof exportLibrary> = async ({ userId, query }) => {
	return downloadResponse(await downloadExport(userId, query.format))
}

export const tags: Handler<typeof listTagsEndpoint> = async ({ userId }) => ({
	items: await listTags(userId),
})

export const topics: Handler<typeof listTopicsEndpoint> = async ({ userId, query }) => {
	const items = await topicList(userId)
	if (!query.view || items.length === 0) return { items }
	// One list's share, in the web's order: most in the list first.
	const { topics, none, sorting } = await listTopics(userId, query.view, null)
	const byId = new Map(items.map((t) => [t.id, t]))
	return {
		items: topics.flatMap((t) => {
			const topic = byId.get(t.id)
			return topic ? [{ ...topic, inView: t.count }] : []
		}),
		none,
		sorting,
	}
}

export const savedSearches: Handler<typeof listSavedSearchesEndpoint> = async ({ userId }) => ({
	items: await listSavedSearches(userId),
})
