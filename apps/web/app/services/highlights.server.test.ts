import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	eq,
	highlights,
	sql,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createHighlight, listDocumentHighlights, listUserHighlights } from "./highlights.server"

const userId = `test-hl-${Date.now()}`
let documentId: string

async function addVersion(text: string, version: number) {
	const [v] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version,
			html: `<p>${text}</p>`,
			text,
			textHash: createHash("sha256").update(text).digest("hex"),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db
		.update(documents)
		.set({ currentVersionId: v!.id, status: "ready" })
		.where(eq(documents.id, documentId))
	return v!.id
}

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "HL", email: `${userId}@example.com` })
	const [d] = await db
		.insert(documents)
		.values({ userId, sourceUrl: "https://example.com/a", urlHash: userId, status: "queued" })
		.returning({ id: documents.id })
	documentId = d!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
})

describe("highlights: anchoring across versions", () => {
	it("creates from a quote, re-anchors after re-extraction, orphans when the quote is gone", async () => {
		const v1 = await addVersion("Alpha bravo charlie delta echo.", 1)
		const created = await createHighlight({
			userId,
			documentId,
			input: { exact: "charlie delta", color: 3 },
		})
		expect(created.ok).toBe(true)
		if (!created.ok) return
		expect(created.highlight).toMatchObject({
			startOffset: 12,
			endOffset: 25,
			versionId: v1,
			color: 3,
			prefix: "Alpha bravo ",
			suffix: " echo.",
		})

		// re-extraction shifts the text
		const v2 = await addVersion("NEW PREFIX. Alpha bravo charlie delta echo. And more.", 2)
		const [after] = await listDocumentHighlights(userId, documentId)
		expect(after).toMatchObject({
			id: created.highlight.id,
			versionId: v2,
			startOffset: 24,
			endOffset: 37,
			orphaned: false,
		})

		// re-extraction lost the passage
		await addVersion("Completely different text now.", 3)
		const [orphan] = await listDocumentHighlights(userId, documentId)
		expect(orphan).toMatchObject({
			id: created.highlight.id,
			orphaned: true,
			exact: "charlie delta",
		})

		// and it comes back when the passage returns
		const v4 = await addVersion("Back again: charlie delta.", 4)
		const [restored] = await listDocumentHighlights(userId, documentId)
		expect(restored).toMatchObject({ versionId: v4, orphaned: false, startOffset: 12 })

		// found again loosely (other spacing and case): the quote becomes what the text says
		await addVersion("Now:  Charlie   Delta, once more.", 9)
		const [loose] = await listDocumentHighlights(userId, documentId)
		expect(loose).toMatchObject({ orphaned: false, startOffset: 6, exact: "Charlie   Delta" })
	})

	it("rejects ambiguous and missing quotes", async () => {
		await addVersion("dup dup dup", 5)
		expect(await createHighlight({ userId, documentId, input: { exact: "dup" } })).toMatchObject({
			ok: false,
			error: "ambiguous",
		})
		expect(await createHighlight({ userId, documentId, input: { exact: "nope" } })).toMatchObject({
			ok: false,
			error: "no_match",
		})
		expect(
			await createHighlight({
				userId,
				documentId,
				input: { exact: "dup", prefix: "dup ", suffix: " dup" },
			}),
		).toMatchObject({ ok: true })
	})
})

describe("highlights: paging", () => {
	it("skips nothing when rows share a millisecond", async () => {
		const versionId = await addVersion("one two three four five six", 10)
		// Postgres keeps microseconds; three highlights within one millisecond.
		const rows = await db
			.insert(highlights)
			.values(
				["000100", "000200", "000300"].map((us, i) => ({
					documentId,
					userId,
					versionId,
					startOffset: i * 4,
					endOffset: i * 4 + 3,
					exact: "one",
					prefix: "",
					suffix: "",
					color: 0,
					createdAt: sql`${`2020-01-01T00:00:00.${us}Z`}::timestamptz`,
				})),
			)
			.returning({ id: highlights.id })
		const seen: string[] = []
		let cursor: { createdAt: string; id: string } | null = null
		do {
			const page = await listUserHighlights({ userId, documentId, limit: 1, cursor })
			seen.push(...page.items.map((h) => h.id))
			cursor = page.nextCursor
		} while (cursor)
		const ours = seen.filter((id) => rows.some((r) => r.id === id))
		expect(ours).toEqual(rows.map((r) => r.id).reverse())
		// A cursor in milliseconds, as older clients hold, still pages.
		const [first] = (await listUserHighlights({ userId, documentId, limit: 100 })).items.filter(
			(h) => rows.some((r) => r.id === h.id),
		)
		const legacy = await listUserHighlights({
			userId,
			documentId,
			cursor: { createdAt: "2020-01-01T00:00:00.001Z", id: first!.id },
		})
		expect(legacy.items.map((h) => h.id)).toEqual(rows.map((r) => r.id).reverse())
	})

	it("searches with NUL characters dropped instead of failing", async () => {
		const q = `on${String.fromCharCode(0)}e`
		const page = await listUserHighlights({ userId, documentId, q, limit: 100 })
		expect(page.items.length).toBeGreaterThan(0)
	})
})
