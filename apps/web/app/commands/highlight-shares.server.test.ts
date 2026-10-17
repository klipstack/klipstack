import { createHash } from "node:crypto"
import {
	addUsage,
	and,
	db,
	documents,
	documentVersions,
	eq,
	highlights,
	highlightShares,
	monthOf,
	usageCounts,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { getPublicShare, getShareState } from "~/services/highlight-shares.server"
import { deleteHighlight, restoreHighlight } from "./annotations.server"
import { shareHighlight, stopSharingHighlight } from "./highlight-shares.server"

const userId = `test-shares-${Date.now()}`
const otherId = `${userId}-other`
const TEXT = "Alpha bravo charlie delta echo. Foxtrot golf hotel india."

async function article(uid: string, title: string) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: uid,
			sourceUrl: `https://example.com/${title}`,
			urlHash: `${uid}-${title}-${Math.random()}`,
			title,
			siteName: "Example",
			status: "ready",
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${TEXT}</p>`,
			text: TEXT,
			textHash: createHash("sha256").update(`${TEXT}${Math.random()}`).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return { id: doc!.id, versionId: version!.id }
}

async function highlight(uid: string, note: string | null = null) {
	const doc = await article(uid, `piece-${Math.random().toString(36).slice(2, 8)}`)
	const [h] = await db
		.insert(highlights)
		.values({
			documentId: doc.id,
			userId: uid,
			versionId: doc.versionId,
			startOffset: 0,
			endOffset: 11,
			exact: "Alpha bravo",
			color: 2,
			note,
		})
		.returning({ id: highlights.id })
	return { id: h!.id, documentId: doc.id }
}

const setNote = (id: string, note: string) =>
	db.update(highlights).set({ note }).where(eq(highlights.id, id))

const live = async (publicId: string) => {
	const share = await getPublicShare(publicId)
	return share?.status === "live" ? share.snapshot : null
}

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Sharer", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
})

describe("shareHighlight", () => {
	it("publishes a snapshot: the quote, the note, the article, and the note's links' originals", async () => {
		const linked = await article(userId, "linked")
		const h = await highlight(userId, `Pairs with [Linked](/read/${linked.id}).`)
		const shared = await shareHighlight(userId, h.id, { includeNote: true, locale: "es" })
		expect(shared).toMatchObject({
			url: `/h/${shared.publicId}`,
			includeNote: true,
			changed: false,
		})
		expect(await live(shared.publicId)).toEqual({
			v: 1,
			exact: "Alpha bravo",
			note: `Pairs with [Linked](/read/${linked.id}).`,
			includeNote: true,
			color: 2,
			article: {
				title: expect.stringMatching(/^piece-/),
				url: expect.stringMatching(/^https:\/\/example\.com\/piece-/),
				siteName: "Example",
			},
			linkUrls: { [linked.id]: "https://example.com/linked" },
			locale: "es",
		})
		expect(await getShareState(userId, h.id)).toMatchObject({ publicId: shared.publicId })
	})

	it("leaves the note out when asked", async () => {
		const h = await highlight(userId, "Private thought.")
		const { publicId } = await shareHighlight(userId, h.id, { includeNote: false, locale: "en" })
		expect(await live(publicId)).toMatchObject({ note: null, includeNote: false })
	})

	it("keeps what was shared until updated, at the same address and without counting again", async () => {
		const h = await highlight(userId, "First.")
		const first = await shareHighlight(userId, h.id, { includeNote: true, locale: "en" })
		await setNote(h.id, "Second.")
		expect(await getShareState(userId, h.id)).toMatchObject({ changed: true })
		expect(await live(first.publicId)).toMatchObject({ note: "First." })

		const before = await sharesThisMonth()
		const updated = await shareHighlight(userId, h.id, { includeNote: true, locale: "en" })
		expect(updated).toMatchObject({ publicId: first.publicId, changed: false })
		expect(await live(first.publicId)).toMatchObject({ note: "Second." })
		expect(await sharesThisMonth()).toBe(before)
	})

	it("stops: the address goes dark, and sharing again makes a new one", async () => {
		const h = await highlight(userId)
		const first = await shareHighlight(userId, h.id, { includeNote: true, locale: "en" })
		await stopSharingHighlight(userId, h.id)
		expect(await getPublicShare(first.publicId)).toEqual({ status: "stopped" })
		expect(await getShareState(userId, h.id)).toBeNull()
		const again = await shareHighlight(userId, h.id, { includeNote: true, locale: "en" })
		expect(again.publicId).not.toBe(first.publicId)
		expect(await getPublicShare(first.publicId)).toBeNull()
		expect(await live(again.publicId)).not.toBeNull()
	})

	it("goes dark while its highlight is deleted, and comes back with an undo", async () => {
		const h = await highlight(userId)
		const { publicId } = await shareHighlight(userId, h.id, { includeNote: true, locale: "en" })
		await deleteHighlight(userId, h.id)
		expect(await getPublicShare(publicId)).toEqual({ status: "stopped" })
		await restoreHighlight(userId, h.id)
		expect(await live(publicId)).not.toBeNull()
	})

	it("treats another reader's highlight, or a deleted one, as not found", async () => {
		const foreign = await highlight(otherId)
		await expect(
			shareHighlight(userId, foreign.id, { includeNote: true, locale: "en" }),
		).rejects.toMatchObject({ code: "not_found" })
		await expect(stopSharingHighlight(userId, foreign.id)).rejects.toMatchObject({
			code: "not_found",
		})
		const h = await highlight(userId)
		await deleteHighlight(userId, h.id)
		await expect(
			shareHighlight(userId, h.id, { includeNote: true, locale: "en" }),
		).rejects.toMatchObject({ code: "not_found" })
	})

	it("refuses one a moderator removed", async () => {
		const h = await highlight(userId)
		await shareHighlight(userId, h.id, { includeNote: true, locale: "en" })
		await db
			.update(highlightShares)
			.set({ removedAt: new Date(), removedGround: "spam", removedNote: "Spam.", published: null })
			.where(eq(highlightShares.highlightId, h.id))
		await expect(
			shareHighlight(userId, h.id, { includeNote: true, locale: "en" }),
		).rejects.toMatchObject({ code: "share_removed" })
		expect(await getShareState(userId, h.id)).toMatchObject({ removed: true })
	})

	it("counts new addresses against the monthly cap", async () => {
		const capped = `${userId}-capped`
		await db
			.insert(userTable)
			.values({ id: capped, name: "Capped", email: `${capped}@example.com` })
		try {
			await addUsage(db, capped, "shares", env.LIMIT_SHARES_PER_MONTH - 1, monthOf().month)
			const a = await highlight(capped)
			const b = await highlight(capped)
			await shareHighlight(capped, a.id, { includeNote: true, locale: "en" })
			// Updating the one shared takes nothing.
			await shareHighlight(capped, a.id, { includeNote: false, locale: "en" })
			await expect(
				shareHighlight(capped, b.id, { includeNote: true, locale: "en" }),
			).rejects.toMatchObject({ code: "limit_reached", details: { limit: "shares" } })
			expect(await getShareState(capped, b.id)).toBeNull()
		} finally {
			await db.delete(userTable).where(eq(userTable.id, capped))
		}
	})
})

async function sharesThisMonth() {
	const [row] = await db
		.select({ count: usageCounts.count })
		.from(usageCounts)
		.where(and(eq(usageCounts.userId, userId), eq(usageCounts.metric, "shares")))
	return row?.count ?? 0
}
