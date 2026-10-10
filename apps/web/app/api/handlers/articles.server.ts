import type {
	articleHtml,
	articleMarkdown,
	getArticle,
	listArticles,
	lookupArticles,
	previewLink,
	searchArticles,
	suggestArticles,
} from "@klipstack/api-contract"
import { parse } from "~/lib/note-links"
import { rateLimit } from "~/lib/rate-limit.server"
import { appOrigin, articleSummary, readerUrl } from "~/services/article-summary.server"
import { findSavedByUrls, getDocumentForReader, listDocuments } from "~/services/documents.server"
import { buildDocumentExport, documentMarkdown } from "~/services/export.server"
import { listDocumentHighlights } from "~/services/highlights.server"
import { type NumberedImages, numberImages } from "~/services/images"
import { storedSizes } from "~/services/images.server"
import { getLinkPreview, PREVIEW_LIMIT, previewableUrl } from "~/services/link-preview.server"
import {
	type ContentLink,
	linkTargetDetails,
	listBacklinks,
	listContentLinks,
} from "~/services/links.server"
import { documentsThatFit, rediscoverDocuments } from "~/services/reading-suggestions.server"
import { searchDocuments } from "~/services/search.server"
import { articleCursor } from "../cursors.server"
import { ApiError, notFound, rateLimited } from "../errors.server"
import type { Handler } from "../handler.server"
import { articleRef, highlightShape } from "./shapes.server"

export const NO_ARTICLE = "No article with that id in the library."

export const list: Handler<typeof listArticles> = async ({ userId, query }) => {
	const page = await listDocuments({
		userId,
		view: query.view,
		filter: query.filter ?? null,
		sort: query.sort,
		limit: query.limit,
		cursor: articleCursor(query.cursor),
	})
	return { items: page.items.map(articleSummary), nextCursor: page.nextCursor }
}

export const suggest: Handler<typeof suggestArticles> = async ({ userId, query }) => {
	const items =
		query.kind === "rediscover"
			? await rediscoverDocuments({ userId, limit: query.limit })
			: await documentsThatFit({ userId, minutes: query.minutes ?? 0, limit: query.limit })
	return { items: items.map(articleSummary) }
}

export const search: Handler<typeof searchArticles> = async ({ userId, query }) => {
	// No time zone comes with a token: the date operators count days in UTC.
	const { items, nextOffset, ignored } = await searchDocuments({
		userId,
		q: query.q,
		limit: query.limit,
		offset: query.offset,
	})
	return { items: items.map(articleSummary), nextOffset, ignored }
}

export const lookup: Handler<typeof lookupArticles> = async ({ userId, body }) => {
	const urls = [...new Set(body.urls)]
	const saved = await findSavedByUrls(userId, urls)
	return { items: urls.map((url) => ({ url, id: saved.get(url) ?? null })) }
}

const contentLink = (l: ContentLink) => ({
	id: l.documentId,
	title: l.title,
	url: l.sourceUrl,
	readerUrl: readerUrl(l.documentId),
})

const NO_IMAGES: NumberedImages = { html: "", images: [], notStored: 0 }

/** The reader's link card (`/api/link-preview`), sharing its limit and cache. */
export const preview: Handler<typeof previewLink> = async ({ userId, query }) => {
	const url = previewableUrl(query.url)
	if (!url) throw ApiError.of("invalid_url", "Only http and https URLs without credentials.")
	const limited = rateLimit(`link-preview:${userId}`, PREVIEW_LIMIT.limit, PREVIEW_LIMIT.windowMs)
	if (!limited.ok) throw rateLimited(limited.retryAfterSeconds)
	return { preview: await getLinkPreview(url.href) }
}

export const get: Handler<typeof getArticle> = async ({ userId, params }) => {
	const found = await getDocumentForReader(userId, params.id)
	if (!found) throw notFound(NO_ARTICLE)
	const { document: doc, version } = found
	const numbered = version ? numberImages(version.html, appOrigin, { label: false }) : NO_IMAGES
	const [highlights, sizes, backlinks, contentLinks] = await Promise.all([
		listDocumentHighlights(userId, doc.id),
		storedSizes(userId, numbered),
		listBacklinks(userId, doc.id),
		listContentLinks(userId, doc.id),
	])
	const article = articleRef(doc)

	// Links in the article's note and its highlights' notes, in reading order.
	const links: Array<{
		id: string
		title: string
		highlight: { id: string; quote: string } | null
	}> = []
	for (const source of [{ id: null, exact: null, note: doc.note }, ...highlights]) {
		if (!source.note) continue
		const highlight = source.id ? { id: source.id, quote: source.exact ?? "" } : null
		for (const segment of parse(source.note).flat())
			if (segment.kind === "link") links.push({ id: segment.id, title: segment.title, highlight })
	}
	const targets = await linkTargetDetails(
		userId,
		links.map((l) => l.id),
	)

	return {
		...articleSummary(doc),
		note: doc.note,
		noteUpdatedAt: doc.noteUpdatedAt?.toISOString() ?? null,
		editionNote: doc.editionNote,
		position: doc.readingPosition,
		readingCycle: doc.readingCycle,
		language: doc.language,
		highlights: highlights.map((h) => highlightShape(h, article)),
		noteLinks: {
			to: links.map((l) => ({
				id: l.id,
				title: l.title,
				status: targets[l.id]?.status ?? "missing",
				url: targets[l.id]?.url ?? null,
				readerUrl: readerUrl(l.id),
				highlight: l.highlight,
			})),
			from: backlinks.map((b) => ({
				id: b.documentId,
				title: b.title,
				url: b.sourceUrl,
				readerUrl: readerUrl(b.documentId),
				highlight: b.highlightId ? { id: b.highlightId, quote: b.exact } : null,
			})),
		},
		contentLinks: {
			to: contentLinks.to.map(contentLink),
			from: contentLinks.from.map(contentLink),
		},
		via: found.via.map((via) => ({
			...via,
			publishedAt: via.publishedAt?.toISOString() ?? null,
		})),
		images: numbered.images.map((image) => {
			const size = sizes.get(image.assetId)
			return {
				number: image.number,
				id: image.assetId,
				alt: image.alt,
				caption: image.caption,
				width: size?.width ?? null,
				height: size?.height ?? null,
				bytes: size?.bytes ?? null,
				url: `${appOrigin}/assets/${image.assetId}`,
				downloadUrl: `${appOrigin}/api/v1/assets/${image.assetId}`,
			}
		}),
		notStoredImages: numbered.notStored,
		imagesPending: version ? !version.imagesDone : false,
	}
}

export const markdown: Handler<typeof articleMarkdown> = async ({ userId, params, query }) => {
	let extracted = false
	const doc = await buildDocumentExport(userId, params.id, (version) => {
		extracted = true
		// Stored images link to their copies (absolute, so the file works anywhere); `original`
		// leaves the site's URLs, which the Markdown converter prefers.
		return query.images === "stored"
			? numberImages(version.html, appOrigin, { label: false }).html
			: version.html
	})
	if (!doc) throw notFound(NO_ARTICLE)
	if (!extracted) throw ApiError.of("not_ready", "The article text is not available yet.")
	// Note links point at the reader, absolute for the same reason.
	return documentMarkdown(doc, readerUrl)
}

/** The stored HTML, as the web reader shows it: highlight offsets index its text. */
export const html: Handler<typeof articleHtml> = async ({ userId, params }) => {
	const found = await getDocumentForReader(userId, params.id)
	if (!found) throw notFound(NO_ARTICLE)
	if (!found.version) throw ApiError.of("not_ready", "The article text is not available yet.")
	return { versionId: found.version.id, html: found.version.html }
}
