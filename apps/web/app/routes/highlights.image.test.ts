import { createHash } from "node:crypto"
import { db, documents, documentVersions, eq, highlights, user as userTable } from "@klipstack/db"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { getUser } from "~/lib/session.server"
import { IMAGE_LIMIT } from "~/services/highlight-image.server"
import { loader } from "./highlights.image"

vi.mock("~/lib/session.server", () => ({ getUser: vi.fn() }))

const userId = `test-highlight-image-${Date.now()}`
const otherId = `${userId}-other`
const TEXT = "You can block off several hours for a single task if you need to."

async function highlight(uid: string, note: string | null, exact = TEXT) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: uid,
			sourceUrl: `https://example.com/${Math.random()}`,
			urlHash: `${uid}-${Math.random()}`,
			title: "Maker's Schedule",
			status: "ready",
		})
		.returning({ id: documents.id })
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: `<p>${exact}</p>`,
			text: exact,
			textHash: createHash("sha256").update(`${exact}${Math.random()}`).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	const [h] = await db
		.insert(highlights)
		.values({
			userId: uid,
			documentId: doc!.id,
			versionId: v!.id,
			startOffset: 0,
			endOffset: exact.length,
			exact,
			note,
			color: 2,
		})
		.returning({ id: highlights.id })
	return { id: h!.id, documentId: doc!.id }
}

async function get(id: string, query = "") {
	return (await loader({
		params: { id },
		request: new Request(`http://localhost/highlights/${id}/image.png${query}`),
		context: {},
	} as never)) as Response
}

/** The status the loader answers or throws with. */
async function status(run: Promise<unknown>) {
	const out: unknown = await run.catch((error: unknown) => error)
	if (out instanceof Response) return out.status
	return (out as { init?: { status?: number } }).init?.status
}

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Ada Reader", email: `${userId}@x.test` },
		{ id: otherId, name: "Other", email: `${otherId}@x.test` },
	])
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
})

beforeEach(() => {
	vi.mocked(getUser).mockReturnValue({ id: `${userId}` } as never)
})

describe("a highlight's image", () => {
	it("draws the reader's own highlight wide or tall, with the note or without", async () => {
		const h = await highlight(userId, "Protect the mornings.")
		const wide = await get(h.id, "?shape=wide&note=1")
		expect(wide.headers.get("Content-Type")).toBe("image/png")
		const widePng = Buffer.from(await wide.arrayBuffer())
		expect(await sharp(widePng).metadata()).toMatchObject({ width: 1200, height: 630 })

		const tall = Buffer.from(await (await get(h.id, "?shape=tall&note=1")).arrayBuffer())
		expect(await sharp(tall).metadata()).toMatchObject({ width: 1080, height: 1920 })

		const bare = Buffer.from(await (await get(h.id, "?shape=tall&note=0")).arrayBuffer())
		expect(bare.equals(tall)).toBe(false)
	})

	it("is the highlight as it is now, not as it was first drawn", async () => {
		const h = await highlight(userId, "First.")
		const before = Buffer.from(await (await get(h.id, "?shape=wide&note=1")).arrayBuffer())
		await db.update(highlights).set({ note: "Second, and longer." }).where(eq(highlights.id, h.id))
		const after = Buffer.from(await (await get(h.id, "?shape=wide&note=1")).arrayBuffer())
		expect(after.equals(before)).toBe(false)
	})

	it("is nobody else's: another reader's, a deleted or a trashed highlight is not found", async () => {
		const foreign = await highlight(otherId, null)
		expect(await status(get(foreign.id))).toBe(404)
		const deleted = await highlight(userId, null)
		await db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, deleted.id))
		expect(await status(get(deleted.id))).toBe(404)
		const trashed = await highlight(userId, null)
		await db
			.update(documents)
			.set({ deletedAt: new Date() })
			.where(eq(documents.id, trashed.documentId))
		expect(await status(get(trashed.id))).toBe(404)
		expect(await status(get("not-an-id"))).toBe(404)
		vi.mocked(getUser).mockReturnValue(null)
		expect(await status(get(foreign.id))).toBe(401)
	})

	it("refuses a quote the fonts cannot draw, and a shape it does not know", async () => {
		const h = await highlight(userId, null, "日本語の引用です。とても長い文章。")
		expect(await status(get(h.id))).toBe(422)
		const ok = await highlight(userId, null)
		expect(await status(get(ok.id, "?shape=square"))).toBe(400)
	})

	it("draws only so many an hour for one reader", async () => {
		vi.mocked(getUser).mockReturnValue({ id: `${userId}-busy` } as never)
		const h = await highlight(userId, null)
		for (let i = 0; i < IMAGE_LIMIT.limit; i++) await status(get(h.id))
		expect(await status(get(h.id))).toBe(429)
	})
})
