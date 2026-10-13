import {
	db,
	documents,
	documentVersions,
	eq,
	highlightResurfacing,
	highlights,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	listDay,
	pickDay,
	pickHighlights,
	RESURFACING,
	type ResurfacingCandidate,
	resurfacingDay,
	setResurfacingDismissed,
} from "./resurfacing.server"

const run = `test-resurfacing-${Date.now()}`
const DAY = "2026-10-13"
const OLD = new Date("2026-09-01T12:00:00Z")

async function newUser(name: string) {
	const id = `${run}-${name}`
	await db.insert(userTable).values({ id, name, email: `${id}@example.com` })
	return id
}

async function article(userId: string, title = "An article") {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			title,
			siteName: "example.com",
			sourceUrl: `https://example.com/${Math.random()}`,
			urlHash: `${userId}-${Math.random()}`,
			status: "ready",
		})
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: "<p>Text</p>",
			text: "Text",
			textHash: `${Math.random()}`,
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return { id: doc!.id, versionId: version!.id }
}

async function highlight(
	userId: string,
	doc: { id: string; versionId: string },
	fields: Partial<typeof highlights.$inferInsert> = {},
) {
	const [row] = await db
		.insert(highlights)
		.values({
			userId,
			documentId: doc.id,
			versionId: doc.versionId,
			startOffset: 0,
			endOffset: 4,
			exact: "Text",
			createdAt: OLD,
			...fields,
		})
		.returning({ id: highlights.id })
	return row!.id
}

/** What the command does: the day's picks, picked on the first call. */
const dailyHighlights = (userId: string, day: string) =>
	db.transaction(async (tx) => {
		await pickDay(tx, userId, day)
		return listDay(userId, day, tx)
	})

const ids = (list: Array<{ id: string }>) => list.map((h) => h.id).sort()

const users: string[] = []
beforeAll(async () => {
	for (const name of ["a", "b", "c", "d", "e"]) users.push(await newUser(name))
})

afterAll(async () => {
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
})

describe("pickHighlights", () => {
	const pool = (n: number, extra: Partial<ResurfacingCandidate> = {}) =>
		Array.from({ length: n }, (_, i) => ({
			id: `h${i}`,
			documentId: `d${i}`,
			hasNote: false,
			shownOn: null,
			...extra,
		}))
	const share = (id: string, candidates: ResurfacingCandidate[]) => {
		let hits = 0
		for (let i = 0; i < 1000; i++)
			if (pickHighlights(candidates, { day: DAY, seed: `s${i}`, count: 1 })[0] === id) hits++
		return hits / 1000
	}

	it("picks up to the count, the same ones for the same seed", () => {
		const candidates = pool(10)
		const picks = pickHighlights(candidates, { day: DAY, seed: "x" })
		expect(picks).toHaveLength(RESURFACING.perDay)
		expect(new Set(picks).size).toBe(picks.length)
		expect(pickHighlights(candidates, { day: DAY, seed: "x" })).toEqual(picks)
		expect(pickHighlights(pool(2), { day: DAY, seed: "x" })).toHaveLength(2)
		expect(pickHighlights([], { day: DAY, seed: "x" })).toEqual([])
	})

	it("takes one per article while there are other articles, then more from the same", () => {
		const twoArticles = [
			...pool(4, { documentId: "a" }),
			{ ...pool(1)[0]!, id: "b0", documentId: "b" },
		]
		for (let i = 0; i < 50; i++) {
			const picks = pickHighlights(twoArticles, { day: DAY, seed: `s${i}` })
			expect(picks).toHaveLength(3)
			expect(picks).toContain("b0")
		}
	})

	it("favors a highlight with a note, with some chance for the rest", () => {
		const candidates = [{ id: "noted", documentId: "dn", hasNote: true, shownOn: null }, ...pool(9)]
		// Three times the weight of each of nine others: 3/12 of the picks.
		const noted = share("noted", candidates)
		expect(noted).toBeGreaterThan(0.18)
		expect(noted).toBeLessThan(0.33)
		expect(share("h0", candidates)).toBeGreaterThan(0.04)
	})

	it("rarely picks one shown lately, and treats one shown long ago as new", () => {
		const yesterday = [
			{ id: "seen", documentId: "ds", hasNote: true, shownOn: "2026-10-12" },
			...pool(3),
		]
		expect(share("seen", yesterday)).toBeLessThan(0.03)
		const longAgo = [
			{ id: "seen", documentId: "ds", hasNote: false, shownOn: "2026-01-01" },
			...pool(3),
		]
		expect(share("seen", longAgo)).toBeGreaterThan(0.18)
	})
})

describe("resurfacingDay", () => {
	it("is the reader's local day", () => {
		const at = new Date("2026-10-13T02:00:00Z")
		expect(resurfacingDay(at, "UTC")).toBe("2026-10-13")
		expect(resurfacingDay(at, "America/Santiago")).toBe("2026-10-12")
	})
})

describe("dailyHighlights", () => {
	it("never brings back deleted, orphaned, dismissed, new or trashed highlights, or someone else's", async () => {
		const [userId, other] = [users[0]!, users[1]!]
		const doc = await article(userId, "Kept")
		const trashed = await article(userId, "Trashed")
		const kept = await highlight(userId, doc, { exact: "Worth keeping", note: "Mine", color: 2 })
		await highlight(userId, doc, { deletedAt: new Date() })
		await highlight(userId, doc, { orphaned: true })
		await highlight(userId, doc, { createdAt: new Date("2026-10-10T12:00:00Z") })
		await highlight(userId, trashed)
		await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, trashed.id))
		const dismissed: string[] = []
		for (let i = 0; i < 4; i++) {
			const id = await highlight(userId, doc)
			expect(await setResurfacingDismissed(db, userId, id, new Date())).toBe(true)
			dismissed.push(id)
		}
		await highlight(other, await article(other))

		expect(await dailyHighlights(userId, DAY)).toEqual([
			{
				id: kept,
				documentId: doc.id,
				exact: "Worth keeping",
				note: "Mine",
				color: 2,
				documentTitle: "Kept",
				siteName: "example.com",
				sourceUrl: expect.any(String),
			},
		])
		// Dismissed ones were not picked and hidden: they never took one of the day's places.
		const rows = await db
			.select()
			.from(highlightResurfacing)
			.where(eq(highlightResurfacing.userId, userId))
		expect(rows.filter((r) => r.shownOn).map((r) => r.highlightId)).toEqual([kept])
		// Someone else's highlight is not the user's to dismiss.
		const [theirs] = await db
			.select({ id: highlights.id })
			.from(highlights)
			.where(eq(highlights.userId, other))
		expect(await setResurfacingDismissed(db, userId, theirs!.id, new Date())).toBe(false)
	})

	it("keeps the day's picks, records the day, and picks again the next day", async () => {
		const userId = users[2]!
		const doc = await article(userId)
		for (let i = 0; i < 6; i++) await highlight(userId, doc)
		// Two first loads at once pick once.
		const [first, alongside] = await Promise.all([
			dailyHighlights(userId, DAY),
			dailyHighlights(userId, DAY),
		])
		expect(first).toHaveLength(RESURFACING.perDay)
		expect(ids(alongside!)).toEqual(ids(first!))
		expect(ids(await dailyHighlights(userId, DAY))).toEqual(ids(first!))
		const shown = await db
			.select()
			.from(highlightResurfacing)
			.where(eq(highlightResurfacing.userId, userId))
		expect(
			shown
				.map((r) => ({ id: r.highlightId, shownOn: r.shownOn }))
				.sort((a, b) => (a.id < b.id ? -1 : 1)),
		).toEqual(ids(first!).map((id) => ({ id, shownOn: DAY })))
		const next = await dailyHighlights(userId, "2026-10-14")
		expect(next).toHaveLength(RESURFACING.perDay)
	})

	it("shows fewer once one is dismissed, without picking another, and it comes back on undo", async () => {
		const userId = users[3]!
		const doc = await article(userId)
		for (let i = 0; i < 5; i++) await highlight(userId, doc)
		const picks = await dailyHighlights(userId, DAY)
		const [gone, ...rest] = picks
		await setResurfacingDismissed(db, userId, gone!.id, new Date())
		expect(ids(await dailyHighlights(userId, DAY))).toEqual(ids(rest))
		for (const h of rest) await setResurfacingDismissed(db, userId, h.id, new Date())
		expect(await dailyHighlights(userId, DAY)).toEqual([])
		await setResurfacingDismissed(db, userId, gone!.id, null)
		expect(ids(await dailyHighlights(userId, DAY))).toEqual([gone!.id])
		// Dismissed ones are never picked on another day.
		const later = await dailyHighlights(userId, "2026-12-31")
		expect(later.map((h) => h.id)).not.toContain(rest[0]!.id)
	})

	it("is empty without highlights", async () => {
		expect(await dailyHighlights(users[4]!, DAY)).toEqual([])
	})
})
