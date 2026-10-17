import { addUsage, db, documents, eq, highlights, highlightShares, monthOf } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import sharp from "sharp"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { apiUsers, request } from "~/test/api-harness"
import { insertArticle } from "../../e2e/seed"

/**
 * Sharing a highlight through /api/v1, through the SDK as the iPhone app calls it: the public link,
 * the picture and the note's links' originals. The rules are the commands' (their own tests); these
 * check the adapters.
 */

const users = apiUsers("api-shares")
afterAll(async () => {
	await users.cleanup()
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

async function highlight(owner: string, exact: string, note: string | null = null) {
	const docId = await insertArticle(owner, `Piece ${exact}`, `<p>${exact}</p>`)
	const [doc] = await db.select().from(documents).where(eq(documents.id, docId))
	const [h] = await db
		.insert(highlights)
		.values({
			userId: owner,
			documentId: docId,
			versionId: doc!.currentVersionId!,
			startOffset: 0,
			endOffset: exact.length,
			exact,
			note,
		})
		.returning({ id: highlights.id })
	return { id: h!.id, docId, url: doc!.sourceUrl }
}

describe("sharing a highlight in the API", () => {
	let me: Awaited<ReturnType<typeof users.create>>
	let other: Awaited<ReturnType<typeof users.create>>

	beforeAll(async () => {
		me = await users.create("Sharer")
		other = await users.create("Other")
	})

	it("shares at a public link, reports it, updates it at the same address, and stops", async () => {
		const h = await highlight(me.id, "first shared passage", "my note")
		expect(await me.client.highlights.getShare(h.id)).toEqual({ share: null })

		const { share } = await me.client.highlights.share(h.id, { includeNote: false })
		expect(share).toMatchObject({ removed: false, includeNote: false, changed: false })
		// Absolute, for apps: the web's own answer is a path.
		expect(share.url).toBe(new URL(`/h/${share.publicId}`, env.APP_URL).href)
		const [row] = await db
			.select()
			.from(highlightShares)
			.where(eq(highlightShares.highlightId, h.id))
		expect(row!.published).toMatchObject({ note: null, locale: "en" })

		await db.update(highlights).set({ note: "my note, edited" }).where(eq(highlights.id, h.id))
		const updated = await me.client.highlights.share(h.id, { includeNote: true, locale: "es" })
		expect(updated.share).toMatchObject({ publicId: share.publicId, includeNote: true })
		const [after] = await db
			.select()
			.from(highlightShares)
			.where(eq(highlightShares.highlightId, h.id))
		expect(after!.published).toMatchObject({ note: "my note, edited", locale: "es" })

		// The page shows the note as it was: changed since.
		await db.update(highlights).set({ note: "later still" }).where(eq(highlights.id, h.id))
		expect((await me.client.highlights.getShare(h.id)).share).toMatchObject({ changed: true })

		// Lists mark it.
		const listed = await me.client.highlights.list({ filter: "shared" })
		expect(listed.items.map((i) => [i.id, i.shared])).toEqual([[h.id, true]])

		await me.client.highlights.stopSharing(h.id)
		expect(await me.client.highlights.getShare(h.id)).toEqual({ share: null })
		expect((await errorOf(me.client.highlights.stopSharing(h.id))).code).toBe("not_found")
		const all = await me.client.highlights.list({ article: h.docId })
		expect(all.items.map((i) => i.shared)).toEqual([false])
	})

	it("says when an admin took it down, and refuses to share it again", async () => {
		const h = await highlight(me.id, "reported passage")
		await me.client.highlights.share(h.id, { includeNote: false })
		await db
			.update(highlightShares)
			.set({ removedAt: new Date(), published: null })
			.where(eq(highlightShares.highlightId, h.id))
		expect(await me.client.highlights.getShare(h.id)).toEqual({ share: { removed: true } })
		const refused = await errorOf(me.client.highlights.share(h.id, { includeNote: false }))
		expect([refused.status, refused.code]).toEqual([409, "share_removed"])
	})

	it("refuses a new link past the monthly cap", async () => {
		const capped = await users.create("Capped")
		const h = await highlight(capped.id, "one too many")
		await addUsage(db, capped.id, "shares", env.LIMIT_SHARES_PER_MONTH, monthOf().month)
		const refused = await errorOf(capped.client.highlights.share(h.id, { includeNote: false }))
		expect([refused.status, refused.code, refused.details]).toEqual([
			403,
			"limit_reached",
			expect.objectContaining({ limit: "shares" }),
		])
	})

	it("is the owner's: another reader's highlight, or a deleted one, is not found", async () => {
		const theirs = await highlight(other.id, "their passage")
		for (const run of [
			() => me.client.highlights.getShare(theirs.id),
			() => me.client.highlights.share(theirs.id, { includeNote: false }),
			() => me.client.highlights.stopSharing(theirs.id),
			() => me.client.highlights.image(theirs.id),
		])
			expect((await errorOf(run())).code).toBe("not_found")
		// A highlight deleted: not found either.
		const gone = await highlight(me.id, "deleted passage")
		await db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, gone.id))
		expect((await errorOf(me.client.highlights.getShare(gone.id))).code).toBe("not_found")
	})

	it("draws the highlight wide or tall, and refuses a quote it cannot draw", async () => {
		const h = await highlight(me.id, "a passage worth a picture", "with a note")
		const wide = await me.client.highlights.image(h.id)
		expect(wide.headers.get("content-type")).toBe("image/png")
		const widePng = Buffer.from(await wide.arrayBuffer())
		expect(await sharp(widePng).metadata()).toMatchObject({ width: 1200, height: 630 })
		const tall = await me.client.highlights.image(h.id, { shape: "tall", note: false })
		expect(await sharp(Buffer.from(await tall.arrayBuffer())).metadata()).toMatchObject({
			width: 1080,
			height: 1920,
		})

		const bad = await highlight(me.id, "日本語の引用です。とても長い文章。")
		const refused = await errorOf(me.client.highlights.image(bad.id))
		expect([refused.status, refused.code]).toEqual([422, "cannot_draw"])
		const square = await request(`/api/v1/highlights/${h.id}/image.png?shape=square`, {
			token: me.key,
		})
		expect(square.status).toBe(400)
	})

	it("gives the original address of each of the reader's articles a note links to", async () => {
		const mine = await highlight(me.id, "linked from a note")
		const theirs = await highlight(other.id, "not mine to link")
		const { urls } = await me.client.noteLinks.lookup([mine.docId, theirs.docId])
		expect(urls).toEqual({ [mine.docId]: mine.url })
		expect(await me.client.noteLinks.lookup([])).toEqual({ urls: {} })
	})
})
