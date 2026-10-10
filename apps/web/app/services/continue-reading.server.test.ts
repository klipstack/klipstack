import { db, documents, eq, sql, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { decodeCursor, listDocuments } from "./documents.server"

const userId = `test-reading-order-${Date.now()}`
const otherId = `${userId}-other`
const ids: Record<string, string> = {}

beforeAll(async () => {
	await db
		.insert(user)
		.values([userId, otherId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })))
	const seeds = [
		{
			title: "Saved last",
			createdAt: new Date("2026-09-20"),
			lastReadAt: new Date("2026-09-20"),
			readingMinutes: 2,
		},
		{
			title: "Read last",
			createdAt: new Date("2026-08-01"),
			lastReadAt: sql`'2026-09-22T12:00:00.123457Z'::timestamptz`,
			readingMinutes: 20,
		},
		{
			title: "Read just before",
			createdAt: new Date("2026-08-02"),
			lastReadAt: sql`'2026-09-22T12:00:00.123456Z'::timestamptz`,
			readingMinutes: 10,
		},
		{
			title: "Same instant",
			createdAt: new Date("2026-08-03"),
			lastReadAt: sql`'2026-09-22T12:00:00.123456Z'::timestamptz`,
			readingMinutes: 12,
		},
		{
			title: "Opened only",
			createdAt: new Date("2026-08-04"),
			firstOpenedAt: new Date("2026-09-21"),
			lastReadAt: null,
			readingMinutes: 5,
		},
		{ title: "Archived", archivedAt: new Date() },
		{ title: "Finished", readAt: new Date() },
		{ title: "Scrolled to end", readingProgress: 1 },
		{ title: "Trashed", deletedAt: new Date() },
		{ title: "Other owner", userId: otherId },
		{ title: "Unread", firstOpenedAt: null, readingProgress: 0 },
	]
	for (const seed of seeds) {
		const [row] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: `https://example.com/${encodeURIComponent(seed.title)}`,
				urlHash: `${userId}-${seed.title}`,
				status: "ready",
				createdAt: new Date("2026-08-01"),
				firstOpenedAt: new Date("2026-09-01"),
				readingProgress: 0.4,
				lastReadAt: new Date("2026-09-23"),
				...seed,
			})
			.returning({ id: documents.id })
		ids[seed.title] = row!.id
	}
})

afterAll(async () => {
	await db.delete(user).where(eq(user.id, userId))
	await db.delete(user).where(eq(user.id, otherId))
})

describe("continue reading", () => {
	it("orders by reading activity across pages, including ties and missing timestamps", async () => {
		const found: string[] = []
		let cursor = null
		do {
			const page = await listDocuments({
				userId,
				view: "inbox",
				filter: "progress",
				cursor: decodeCursor(cursor),
				limit: 1,
			})
			found.push(...page.items.map((d) => d.id))
			cursor = page.nextCursor
		} while (cursor)
		expect(found).toEqual([
			ids["Read last"],
			...[ids["Read just before"], ids["Same instant"]].sort().reverse(),
			ids["Opened only"],
			ids["Saved last"],
		])
	})

	it("respects explicit saved-date and length sorts", async () => {
		const newest = await listDocuments({
			userId,
			view: "inbox",
			filter: "progress",
			sort: "newest",
		})
		expect(newest.items[0]?.title).toBe("Saved last")
		const shortest = await listDocuments({
			userId,
			view: "inbox",
			filter: "progress",
			sort: "shortest",
		})
		expect(shortest.items.map((d) => d.readingMinutes)).toEqual([2, 5, 10, 12, 20])
	})
})
