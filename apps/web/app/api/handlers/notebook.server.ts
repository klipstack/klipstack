import type {
	dismissDailyHighlight,
	getNotebook,
	listDailyHighlights,
	NotebookArticle,
	NotebookItem,
	restoreDailyHighlight,
	searchAnnotations,
} from "@klipstack/api-contract"
import { HIGHLIGHT_COLORS } from "@klipstack/api-contract"
import { dailyHighlights, resumeResurfacing, stopResurfacing } from "~/commands/resurfacing.server"
import { extractLinkIds } from "~/lib/note-links"
import { searchHighlights, searchNotes } from "~/services/annotation-search.server"
import { appOrigin, readerUrl } from "~/services/article-summary.server"
import { linkTargetStatus } from "~/services/links.server"
import {
	activeTopicName,
	countNotebook,
	dealNotebook,
	listNotebookArticles,
	listNotebookStream,
	listNotebookTags,
	listNotebookTopics,
	type NotebookArticleFields,
	type NotebookItem as NotebookRow,
} from "~/services/notebook.server"
import { getTag } from "~/services/tags.server"
import { topicAsked, topicsInUse } from "~/services/topics.server"
import { encodeNotebookCursor, notebookCursor } from "../cursors.server"
import { notFound } from "../errors.server"
import type { Handler } from "../handler.server"
import { NO_TOPIC } from "./articles.server"
import { highlightShape } from "./shapes.server"

/** The Notebook, Home's daily highlights, and searching highlights and notes. */

const NO_TAG = "No tag with that id: see GET /tags."

const STORED = /^\/assets\/([0-9a-f-]{36})$/

/** The article as a card shows it; its image as `ArticleSummary.leadImage` gives it. */
function notebookArticle(a: NotebookArticleFields): NotebookArticle {
	const stored = a.image ? STORED.exec(a.image) : null
	return {
		id: a.documentId,
		title: a.documentTitle,
		author: a.author,
		site: a.siteName,
		url: a.sourceUrl,
		readerUrl: readerUrl(a.documentId),
		leadImage: stored
			? { url: `${appOrigin}${a.image}`, downloadUrl: `${appOrigin}/api/v1/assets/${stored[1]}` }
			: a.image
				? { url: a.image, downloadUrl: null }
				: null,
	}
}

const ref = (a: NotebookArticleFields) => ({
	id: a.documentId,
	title: a.documentTitle,
	site: a.siteName,
	url: a.sourceUrl,
})

/** A card; a note is `editable` unless `shownAbove` holds its article. */
function item(row: NotebookRow, shownAbove?: Set<string>): NotebookItem {
	if (row.kind === "highlight")
		return {
			kind: "highlight",
			highlight: highlightShape(row, ref(row)),
			article: notebookArticle(row),
		}
	return {
		kind: "note",
		note: row.note,
		noteUpdatedAt: row.noteUpdatedAt?.toISOString() ?? null,
		writtenAt: row.writtenAt.toISOString(),
		editable: !shownAbove?.has(row.documentId),
		article: notebookArticle(row),
	}
}

const noteOf = (i: NotebookItem) => (i.kind === "note" ? i.note : (i.highlight.note ?? ""))

export const notebook: Handler<typeof getNotebook> = async ({ userId, query }) => {
	const [topicsOn, tags] = await Promise.all([topicsInUse(userId), listNotebookTags(userId)])
	// A tag of the user's whose last highlight or note just went stays chosen, with none.
	if (query.tag && !tags.some((t) => t.id === query.tag)) {
		const own = await getTag(userId, query.tag)
		if (!own) throw notFound(NO_TAG)
		tags.push({ id: own.id, name: own.name, count: 0 })
	}
	const topic = query.topic ? await topicAsked(userId, query.topic) : null
	if (query.topic && !topic) throw notFound(NO_TOPIC)
	const topicName = topic && topic !== "none" ? await activeTopicName(userId, topic) : null
	// By topic only while topics are in use, as on the web: otherwise By article.
	const view = query.view === "topics" && !topicsOn ? "articles" : query.view

	const matching = {
		userId,
		q: query.q,
		filter: query.filter ?? null,
		scope: { tagId: query.tag ?? null, topic },
	}
	const cursor = notebookCursor(query.cursor)
	const base = {
		tags,
		topicsInUse: topicsOn,
		topic: topic ? { id: topic === "none" ? null : topic, name: topicName } : null,
	}
	const [counts, board] = await Promise.all([
		countNotebook(userId, query.q, matching.scope),
		(async () => {
			if (view === "shuffle") {
				const seed = query.seed ?? ""
				const items = await dealNotebook({ ...matching, seed })
				return { view, seed, items: items.map((i) => item(i)) }
			}
			if (view === "topics") {
				const groups = await listNotebookTopics(matching)
				// A note under two topics is written on in the first.
				const shownAbove = new Set<string>()
				return {
					view,
					groups: groups.map((g) => {
						const items = g.items.map((i) => item(i, shownAbove))
						for (const i of g.items) if (i.kind === "note") shownAbove.add(i.documentId)
						return {
							topic: g.topicId ? { id: g.topicId, name: g.name ?? "" } : null,
							highlights: g.highlights,
							notes: g.notes,
							items,
						}
					}),
				}
			}
			if (view === "stream") {
				const page = await listNotebookStream({
					...matching,
					cursor,
					// Without one, as the web pages: 50 cards, 20 articles.
					limit: query.limit,
				})
				return {
					view,
					items: page.items.map((i) => item(i)),
					nextCursor: page.nextCursor ? encodeNotebookCursor(page.nextCursor) : null,
				}
			}
			const page = await listNotebookArticles({
				...matching,
				cursor,
				limit: query.limit,
			})
			return {
				view,
				articles: page.articles.map((a) => ({
					article: notebookArticle(a),
					note: a.note,
					noteUpdatedAt: a.noteUpdatedAt?.toISOString() ?? null,
					highlights: a.highlights.map((h) => highlightShape(h, ref(a))),
				})),
				nextCursor: page.nextCursor ? encodeNotebookCursor(page.nextCursor) : null,
			}
		})(),
	])
	const notes =
		board.view === "articles"
			? board.articles.flatMap((a) => [a.note ?? "", ...a.highlights.map((h) => h.note ?? "")])
			: board.view === "topics"
				? board.groups.flatMap((g) => g.items.map(noteOf))
				: board.items.map(noteOf)
	const linkTargets = await linkTargetStatus(userId, extractLinkIds(notes.join("\n")))
	return { ...base, counts, linkTargets, ...board }
}

export const daily: Handler<typeof listDailyHighlights> = async ({ userId, query }) => {
	const day = query.day
	const found = await dailyHighlights(userId, day)
	const linkTargets = await linkTargetStatus(
		userId,
		extractLinkIds(found.map((h) => h.note ?? "").join("\n")),
	)
	return {
		day,
		items: found.map((h) => ({
			id: h.id,
			quote: h.exact,
			note: h.note,
			color: HIGHLIGHT_COLORS[h.color] ?? "yellow",
			article: { id: h.documentId, title: h.documentTitle, site: h.siteName, url: h.sourceUrl },
		})),
		linkTargets,
	}
}

export const dismissDaily: Handler<typeof dismissDailyHighlight> = async ({ userId, params }) => {
	await stopResurfacing(userId, params.id)
}

export const restoreDaily: Handler<typeof restoreDailyHighlight> = async ({ userId, params }) => {
	await resumeResurfacing(userId, params.id)
}

export const searchKept: Handler<typeof searchAnnotations> = async ({ userId, query }) => {
	const none = { items: [], total: 0 }
	// No time zone comes with a token: the date operators count days in UTC, as GET /search does.
	const [highlights, notes] = await Promise.all([
		query.only === "notes" ? none : searchHighlights({ userId, q: query.q, limit: query.limit }),
		query.only === "highlights" ? none : searchNotes({ userId, q: query.q, limit: query.limit }),
	])
	const article = (a: { documentId: string; title: string; siteName: string | null }) => ({
		id: a.documentId,
		title: a.title,
		site: a.siteName,
	})
	return {
		highlights: {
			total: highlights.total,
			items: highlights.items.map((h) => ({
				id: h.id,
				color: HIGHLIGHT_COLORS[h.color] ?? "yellow",
				quote: h.quote,
				note: h.note,
				createdAt: h.createdAt.toISOString(),
				article: article(h),
			})),
		},
		notes: {
			total: notes.total,
			items: notes.items.map((n) => ({
				note: n.note,
				noteUpdatedAt: n.noteUpdatedAt?.toISOString() ?? null,
				article: article(n),
			})),
		},
	}
}
