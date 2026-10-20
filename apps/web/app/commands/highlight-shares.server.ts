import { Id } from "@klipstack/api-contract"
import { extractLinkIds } from "@klipstack/api-contract/note-links"
import {
	and,
	db,
	documents,
	eq,
	highlights,
	highlightShares,
	isNull,
	newPublicId,
	sql,
} from "@klipstack/db"
import { supportedLanguages } from "@klipstack/i18n"
import { z } from "zod"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { checkMayAdd, countMonthly } from "~/lib/limits.server"
import {
	getShareState,
	type ShareSnapshot,
	type ShareState,
} from "~/services/highlight-shares.server"
import { linkTargetDetails } from "~/services/links.server"

/**
 * Sharing a highlight at a public address (`/h/<publicId>`). What the page shows is a snapshot,
 * taken when it is shared and again on each update; stopping takes the page down.
 */

const NO_HIGHLIGHT = "No highlight with that id."

const ShareInput = z.object({
	includeNote: z.boolean(),
	locale: z.enum(supportedLanguages),
})

/**
 * Shares the highlight, or updates what its page shows when it is shared already (same address).
 * A new address counts against the monthly cap (`limit_reached`); an update does not. One an admin
 * took down stays down (`share_removed`).
 */
export async function shareHighlight(
	userId: string,
	id: string,
	input: unknown,
): Promise<ShareState> {
	const highlightId = parseInput(Id, id)
	const { includeNote, locale } = parseInput(ShareInput, input)
	return db.transaction(async (tx) => {
		// The highlight's row held: two shares at once take turns, and make one address.
		const [h] = await tx
			.select({
				exact: highlights.exact,
				note: highlights.note,
				color: highlights.color,
				title: documents.title,
				url: documents.sourceUrl,
				siteName: documents.siteName,
				author: documents.author,
			})
			.from(highlights)
			.innerJoin(documents, eq(documents.id, highlights.documentId))
			.where(
				and(
					eq(highlights.id, highlightId),
					eq(highlights.userId, userId),
					eq(documents.userId, userId),
					isNull(highlights.deletedAt),
					isNull(documents.deletedAt),
				),
			)
			.for("update", { of: highlights })
		if (!h) throw notFound(NO_HIGHLIGHT)

		const note = includeNote && h.note?.trim() ? h.note.trim() : null
		const targets = note ? await linkTargetDetails(userId, extractLinkIds(note), tx) : {}
		const snapshot: ShareSnapshot = {
			v: 1,
			exact: h.exact,
			note,
			includeNote,
			color: h.color,
			article: { title: h.title, url: h.url, siteName: h.siteName, author: h.author },
			linkUrls: Object.fromEntries(Object.entries(targets).map(([lid, t]) => [lid, t.url])),
			locale,
		}

		const [existing] = await tx
			.select({
				publicId: highlightShares.publicId,
				published: highlightShares.published,
				removedAt: highlightShares.removedAt,
			})
			.from(highlightShares)
			.where(eq(highlightShares.highlightId, highlightId))
		if (existing?.removedAt)
			throw new AppError("share_removed", "This highlight was taken down and cannot be shared.")
		if (existing && existing.published !== null) {
			// Updating the page publishes the note as it is now: adding, like a new link.
			await checkMayAdd(userId)
			await tx
				.update(highlightShares)
				.set({ published: snapshot, updatedAt: sql`now()` })
				.where(eq(highlightShares.highlightId, highlightId))
		} else {
			await countMonthly(tx, userId, "shares")
			// A new address, even for one shared before: the old one stays dead.
			await tx
				.insert(highlightShares)
				.values({ userId, highlightId, published: snapshot })
				.onConflictDoUpdate({
					target: highlightShares.highlightId,
					set: {
						publicId: newPublicId(),
						published: snapshot,
						sharedAt: sql`now()`,
						updatedAt: sql`now()`,
					},
				})
		}
		const state = await getShareState(userId, highlightId, tx)
		if (!state || state.removed) throw new Error(`Share of ${highlightId}: not live after sharing`)
		return state
	})
}

/** Takes the highlight's page down: its address answers that it is no longer shared. */
export async function stopSharingHighlight(userId: string, id: string): Promise<void> {
	const highlightId = parseInput(Id, id)
	const stopped = await db
		.update(highlightShares)
		.set({ published: null, updatedAt: sql`now()` })
		.where(
			and(
				eq(highlightShares.highlightId, highlightId),
				eq(highlightShares.userId, userId),
				isNull(highlightShares.removedAt),
				sql`${highlightShares.published} is not null`,
			),
		)
		.returning({ id: highlightShares.id })
	if (stopped.length === 0) throw notFound("That highlight is not shared.")
}
