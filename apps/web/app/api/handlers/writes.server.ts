import {
	type appendNote,
	type createHighlight,
	type createSavedSearch as createSavedSearchEndpoint,
	type createTag as createTagEndpoint,
	type deleteHighlight,
	type deleteSavedSearch as deleteSavedSearchEndpoint,
	type deleteTag as deleteTagEndpoint,
	type dismissFeedItems,
	type followFeed,
	HIGHLIGHT_COLORS,
	type markFeedViewed,
	type openArticle,
	type readPost as readPostEndpoint,
	type renameArticle,
	type renameSavedSearch as renameSavedSearchEndpoint,
	type renameTag as renameTagEndpoint,
	type resizeHighlight,
	type restoreArticles,
	type saveArticle,
	type saveFeedItems,
	type setEditionNote,
	type setNote,
	type setPosition,
	type trashArticles,
	type undoArticles,
	type unfollowFeed,
	type updateArticles,
	type updateHighlight,
} from "@klipstack/api-contract"
import {
	appendArticleNote,
	createHighlight as createHighlightCommand,
	deleteHighlight as deleteHighlightCommand,
	resizeHighlight as resizeHighlightCommand,
	setArticleNote,
	updateHighlight as updateHighlightCommand,
} from "~/commands/annotations.server"
import {
	updateArticles as changeArticles,
	NO_ARTICLE,
	openArticle as openArticleCommand,
	readPostInstead,
	restoreArticles as restoreArticleIds,
	saveReadingPosition,
	trashArticles as trashArticleIds,
	undoChanges,
	updateArticle,
} from "~/commands/articles.server"
import { setArticleEditionNote } from "~/commands/editions.server"
import {
	dismissFeedItems as dismissFeedItemsCommand,
	followFeed as followFeedCommand,
	markFeedViewed as markFeedViewedCommand,
	unfollowFeed as unfollowFeedCommand,
} from "~/commands/feeds.server"
import {
	createSavedSearch as createSavedSearchCommand,
	deleteSavedSearch as deleteSavedSearchCommand,
	renameSavedSearch as renameSavedSearchCommand,
} from "~/commands/saved-searches.server"
import {
	saveArticle as saveArticleCommand,
	saveFeedItems as saveFeedItemsCommand,
} from "~/commands/saving.server"
import {
	createTag as createTagCommand,
	deleteTag as deleteTagCommand,
	renameTag as renameTagCommand,
} from "~/commands/tags.server"
import { AppError } from "~/lib/app-error"
import { readUndo, signUndo } from "~/lib/undo-token.server"
import { articleSummary } from "~/services/article-summary.server"
import type { UndoRecord } from "~/services/article-undo.server"
import { getDocument, type NoteState } from "~/services/documents.server"
import { listFollowedFeeds } from "~/services/feeds.server"
import { getHighlightWithArticle } from "~/services/highlights.server"
import { notFound } from "../errors.server"
import { type Handler, reply } from "../handler.server"
import { articleRef, highlightShape } from "./shapes.server"

const NO_HIGHLIGHT = "No highlight with that id."

/** The articles as the API shows them, in the order given; ones no longer there are left out. */
async function summaries(userId: string, ids: string[]) {
	const out = []
	for (const id of ids) {
		const doc = await getDocument(userId, id)
		if (doc) out.push(articleSummary(doc))
	}
	return out
}

// ---- articles ----

/** The router refuses a save past the limit before reading the body (routes/api.v1.ts). */
export const save: Handler<typeof saveArticle> = async ({ userId, body }) => {
	const { article, created } = await saveArticleCommand(userId, {
		url: body.url,
		html: body.html ?? null,
		source: body.source,
	})
	return reply(created ? 202 : 200, { article: articleSummary(article), created })
}

/** The same command as MCP's update_articles and the web's changes. */
export const update: Handler<typeof updateArticles> = async ({ userId, body }) => {
	const { found, notFound: missing, changed, undo } = await changeArticles(userId, body)
	return {
		items: await summaries(userId, found),
		notFound: missing,
		undo: changed.length > 0 ? [signUndo(userId, undo)] : [],
	}
}

/** The web's toasts undo the same way (`revert` in routes/documents.bulk.ts). */
export const undo: Handler<typeof undoArticles> = async ({ userId, body }) => {
	const record = readUndo<UndoRecord>(userId, body.token)
	if (!record) throw new AppError("invalid_request", "This undo has expired.")
	return { items: await summaries(userId, await undoChanges(userId, record)) }
}

export const rename: Handler<typeof renameArticle> = async ({ userId, params, body }) => {
	await updateArticle(userId, params.id, { title: body.title })
	const [article] = await summaries(userId, [params.id])
	if (!article) throw notFound(NO_ARTICLE)
	return { article }
}

export const trash: Handler<typeof trashArticles> = ({ userId, body }) =>
	trashArticleIds(userId, body.ids)

export const restore: Handler<typeof restoreArticles> = ({ userId, body }) =>
	restoreArticleIds(userId, body.ids)

// ---- reading ----

/** The web reader's "open": no longer new, and maybe a new reading cycle. */
export const open: Handler<typeof openArticle> = async ({ userId, params }) => {
	const opened = await openArticleCommand(userId, params.id)
	return {
		progress: opened.readingProgress,
		position: opened.readingPosition,
		cycle: opened.readingCycle,
	}
}

/** The web reader's "Read the post instead". */
export const readPost: Handler<typeof readPostEndpoint> = ({ userId, params }) =>
	readPostInstead(userId, params.id)

/** The web reader's scroll save. */
export const position: Handler<typeof setPosition> = async ({ userId, params, body }) => {
	await saveReadingPosition(userId, params.id, body)
}

// ---- notes ----

const noteBody = (state: NoteState) => ({
	note: state.note,
	noteUpdatedAt: state.noteUpdatedAt?.toISOString() ?? null,
})

export const replaceNote: Handler<typeof setNote> = async ({ userId, params, body }) =>
	noteBody(await setArticleNote(userId, params.id, body))

/** Adds a paragraph, as MCP's append mode does. */
export const append: Handler<typeof appendNote> = async ({ userId, params, body }) =>
	noteBody(await appendArticleNote(userId, params.id, body.text))

export const replaceEditionNote: Handler<typeof setEditionNote> = ({ userId, params, body }) =>
	setArticleEditionNote(userId, params.id, body)

// ---- highlights ----

const colorIndex = (color: (typeof HIGHLIGHT_COLORS)[number] | undefined) =>
	color === undefined ? undefined : HIGHLIGHT_COLORS.indexOf(color)

export const addHighlight: Handler<typeof createHighlight> = async ({ userId, params, body }) => {
	const highlight = await createHighlightCommand(userId, params.id, {
		exact: body.quote,
		start: body.start,
		end: body.end,
		prefix: body.prefix,
		suffix: body.suffix,
		occurrence: body.occurrence,
		note: body.note,
		color: colorIndex(body.color),
	})
	const doc = await getDocument(userId, params.id)
	if (!doc) throw notFound(NO_ARTICLE)
	return { highlight: highlightShape(highlight, articleRef(doc)) }
}

export const editHighlight: Handler<typeof updateHighlight> = async ({ userId, params, body }) => {
	const changed = await updateHighlightCommand(userId, params.id, {
		note: body.note,
		color: colorIndex(body.color),
	})
	const current = await getHighlightWithArticle(userId, params.id)
	if (!current) throw notFound(NO_HIGHLIGHT)
	return {
		highlight: highlightShape(changed, {
			id: current.documentId,
			title: current.documentTitle,
			site: current.siteName,
			url: current.sourceUrl,
		}),
	}
}

/** The web reader's handles, for apps: the same command, found by the highlight. */
export const moveHighlight: Handler<typeof resizeHighlight> = async ({ userId, params, body }) => {
	const current = await getHighlightWithArticle(userId, params.id)
	if (!current) throw notFound(NO_HIGHLIGHT)
	const place = (p: { start: number; end: number; quote: string }) => ({
		start: p.start,
		end: p.end,
		exact: p.quote,
	})
	const moved = await resizeHighlightCommand(userId, current.documentId, {
		id: params.id,
		versionId: body.versionId,
		previous: place(body.previous),
		// The server takes the text around it from the version.
		selector: { ...place(body), prefix: "", suffix: "" },
	})
	return {
		highlight: highlightShape(moved, {
			id: current.documentId,
			title: current.documentTitle,
			site: current.siteName,
			url: current.sourceUrl,
		}),
	}
}

export const removeOne: Handler<typeof deleteHighlight> = async ({ userId, params }) => {
	await deleteHighlightCommand(userId, params.id)
}

// ---- tags ----

export const addTag: Handler<typeof createTagEndpoint> = async ({ userId, body }) => {
	const { tag, created } = await createTagCommand(userId, body.name)
	return reply(created ? 201 : 200, { tag, created })
}

export const retitleTag: Handler<typeof renameTagEndpoint> = ({ userId, params, body }) =>
	renameTagCommand(userId, params.id, body.name)

export const removeTag: Handler<typeof deleteTagEndpoint> = async ({ userId, params, query }) => {
	await deleteTagCommand(userId, params.id, { force: query.force })
}

// ---- saved searches ----

export const addSavedSearch: Handler<typeof createSavedSearchEndpoint> = async ({ userId, body }) =>
	reply(201, { savedSearch: await createSavedSearchCommand(userId, body) })

export const retitleSavedSearch: Handler<typeof renameSavedSearchEndpoint> = async ({
	userId,
	params,
	body,
}) => ({ savedSearch: await renameSavedSearchCommand(userId, params.id, body.name) })

export const removeSavedSearch: Handler<typeof deleteSavedSearchEndpoint> = async ({
	userId,
	params,
}) => {
	await deleteSavedSearchCommand(userId, params.id)
}

// ---- feeds ----

export const saveItems: Handler<typeof saveFeedItems> = ({ userId, body }) =>
	saveFeedItemsCommand(userId, body.ids)

export const dismissItems: Handler<typeof dismissFeedItems> = ({ userId, body }) =>
	dismissFeedItemsCommand(userId, body.ids)

export const viewed: Handler<typeof markFeedViewed> = async ({ userId, body }) => {
	const { viewedAt } = await markFeedViewedCommand(userId, body.asOf)
	return { viewedAt: viewedAt.toISOString() }
}

/** The router refuses a follow past the limit before reading the body (routes/api.v1.ts). */
export const follow: Handler<typeof followFeed> = async ({ userId, body }) => {
	const followed = await followFeedCommand(userId, body.url)
	const feed = (await listFollowedFeeds(userId)).find((f) => f.id === followed.subscriptionId)
	if (!feed) throw new Error("followed feed not listed")
	return reply(followed.existing ? 200 : 201, {
		feed: {
			id: feed.id,
			title: feed.title,
			siteUrl: feed.siteUrl,
			newCount: feed.newCount,
			notUpdating: feed.trouble,
		},
		alreadyFollowing: followed.existing,
	})
}

export const unfollow: Handler<typeof unfollowFeed> = async ({ userId, params }) => {
	await unfollowFeedCommand(userId, params.id)
}
