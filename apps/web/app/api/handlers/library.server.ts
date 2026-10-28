import { Readable } from "node:stream"
import { TOPIC_RULES } from "@klipstack/ai"
import type {
	exportLibrary,
	getAsset,
	getFeed,
	listFeeds,
	listHighlights,
	listSavedSearches as listSavedSearchesEndpoint,
	listTags as listTagsEndpoint,
	listTopics as listTopicsEndpoint,
	Topic,
} from "@klipstack/api-contract"
import { and, assets, db, eq } from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { mayUseFeeds } from "~/commands/feeds.server"
import { downloadResponse } from "~/lib/download-response.server"
import { articleSummary } from "~/services/article-summary.server"
import { getDocument } from "~/services/documents.server"
import { downloadExport } from "~/services/export.server"
import { listFeedPage, listFollowedFeeds } from "~/services/feeds.server"
import { listUserHighlights } from "~/services/highlights.server"
import { listSavedSearches } from "~/services/saved-searches.server"
import { listTags } from "~/services/tags.server"
import {
	firstTopicsNotice,
	latestInTopics,
	libraryCount,
	listTopics,
	topicsInvitation,
	topicsOffered,
	topicsState,
} from "~/services/topics.server"
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
				author: h.author,
				url: h.sourceUrl,
			}),
		),
		nextCursor: page.nextCursor ? encodeHighlightCursor(page.nextCursor) : null,
	}
}

export const feed: Handler<typeof getFeed> = async ({ userId, query }) => {
	await mayUseFeeds(userId)
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
	await mayUseFeeds(userId)
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
	if (!(await topicsOffered(userId))) return { stage: "unavailable" as const, items: [] }
	const state = await topicsState(userId, { shelves: false })
	const active = state.stage === "active"
	const latest = active && query.latest ? await latestInTopics(userId, query.latest) : null
	let items: Topic[] = active
		? state.topics.map(({ id, name, description, articles, recent, toRead, lastRead }) => ({
				id,
				name,
				description,
				articles,
				savedThisWeek: recent,
				toRead,
				lastReadAt: lastRead?.toISOString() ?? null,
				...(latest ? { latest: (latest.get(id) ?? []).map(articleSummary) } : {}),
			}))
		: []
	const answer = {
		stage: state.stage,
		items,
		// What Home and the Topics screen say while topics are off; a list's topic choice needs none of it.
		...(state.stage === "off" && !query.view ? await offered(userId) : {}),
		...(state.stage === "waiting" || state.stage === "proposing"
			? { progress: { count: state.count, needed: state.needed } }
			: {}),
		...(state.stage === "proposed"
			? {
					proposed: state.topics.map(({ id, name, description }) => ({ id, name, description })),
					card: (await firstTopicsNotice(userId)).card,
				}
			: {}),
		...(active
			? {
					sorting: state.sorting,
					sortingPaused: state.sortsPaused && {
						// A server that sorts none at all starts again in no month.
						resumesAt: state.sortsPaused.max === 0 ? null : state.sortsPaused.resetsAt,
						// Not all of the month's sorts are spent: no `max`, for an app to say they are.
						...(state.sortsPaused.library ? {} : { max: state.sortsPaused.max }),
						library: state.sortsPaused.library,
					},
				}
			: {}),
	}
	// With `view`, `sorting` is always that list's, topics or none yet; only while topics are on.
	if (!query.view || !active) return answer
	// One list's share, in the web's order: most in the list first.
	const { topics, none, sorting } = await listTopics(userId, query.view, null)
	const byId = new Map(items.map((t) => [t.id, t]))
	items = topics.flatMap((t) => {
		const topic = byId.get(t.id)
		return topic ? [{ ...topic, inView: t.count }] : []
	})
	return { ...answer, items, none, sorting }
}

/** Topics off: the library's size against what the first topics need, and Home's invitation. */
async function offered(userId: string) {
	const [count, invitation] = await Promise.all([libraryCount(userId), topicsInvitation(userId)])
	return { progress: { count, needed: TOPIC_RULES.bootstrapSize }, invitation: !!invitation }
}

export const savedSearches: Handler<typeof listSavedSearchesEndpoint> = async ({ userId }) => ({
	items: await listSavedSearches(userId),
})
