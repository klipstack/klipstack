import { env } from "~/lib/env.server"
import { READ_PROGRESS } from "~/lib/inbox-filters"
import type { LibraryCard } from "./documents.server"

/** How adapters (MCP, the HTTP API) describe an article, and where it opens in the app. */

export const appOrigin = new URL(env.APP_URL).origin

export const readerUrl = (id: string) => `${appOrigin}/read/${id}`

export function articleSummary(card: LibraryCard) {
	return {
		id: card.id,
		title: card.title,
		author: card.author,
		site: card.siteName,
		description: card.description,
		url: card.sourceUrl,
		readerUrl: readerUrl(card.id),
		savedAt: card.createdAt.toISOString(),
		publishedAt: card.publishedAt?.toISOString() ?? null,
		location: card.archivedAt ? ("archive" as const) : ("inbox" as const),
		archivedAt: card.archivedAt?.toISOString() ?? null,
		starred: Boolean(card.starredAt),
		shortlisted: Boolean(card.shortlistedAt),
		opened: Boolean(card.firstOpenedAt),
		progress: Math.round(card.readingProgress * 100) / 100,
		finished: Boolean(card.readAt) || card.readingProgress >= READ_PROGRESS,
		finishedAt: card.readAt?.toISOString() ?? null,
		readingMinutes: card.readingMinutes,
		status: card.status,
		failure: card.status === "failed" ? failure(card.failureReason) : null,
		trashedAt: card.deletedAt?.toISOString() ?? null,
		tags: card.tags,
		leadImage: leadImage(card),
	}
}

/** The card's picture, as the library shows it: the stored copy first, else the site's own. */
function leadImage(card: LibraryCard) {
	if (card.leadImageAssetId)
		return {
			url: `${appOrigin}/assets/${card.leadImageAssetId}`,
			downloadUrl: `${appOrigin}/api/v1/assets/${card.leadImageAssetId}`,
		}
	return card.leadImageUrl ? { url: card.leadImageUrl, downloadUrl: null } : null
}

/** The worker's reason (`no_content`, `http_error:404`, …) as a code and an HTTP status. */
function failure(reason: string | null) {
	const [code, status] = (reason ?? "unknown").split(":")
	const httpStatus = Number(status)
	return {
		code: code || "unknown",
		httpStatus: Number.isInteger(httpStatus) && status ? httpStatus : null,
	}
}
