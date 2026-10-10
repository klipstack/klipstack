import { db, documents, eq, user } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { homeShelves } from "~/lib/home-shelves"
import { TIME_CHOICES } from "~/lib/inbox-filters"
import {
	countUnfinished,
	documentsThatFit,
	homeCandidates,
	rediscoverDocuments,
} from "./reading-suggestions.server"

const userId = `test-suggest-${Date.now()}`
const otherId = `${userId}-other`
const now = new Date("2026-10-10T12:00:00Z")
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

type Save = Partial<typeof documents.$inferInsert> & { title: string }

async function save(owner: string, saves: Save[]) {
	await db.insert(documents).values(
		saves.map((doc) => ({
			userId: owner,
			sourceUrl: `https://example.com/${encodeURIComponent(doc.title)}`,
			urlHash: `${owner}-${doc.title}`,
			status: "ready" as const,
			...doc,
		})),
	)
}

const titles = (docs: { title: string | null }[]) => docs.map((d) => d.title)

beforeAll(async () => {
	await db
		.insert(user)
		.values([userId, otherId].map((id) => ({ id, name: "Reader", email: `${id}@example.com` })))
	await save(userId, [
		...Array.from({ length: 8 }, (_, i) => ({
			title: `Old ${i}`,
			readingMinutes: 50,
			createdAt: daysAgo(20 + i),
		})),
		{ title: "Two weeks", readingMinutes: 50, createdAt: daysAgo(13) },
		{ title: "Old, opened", readingMinutes: 50, createdAt: daysAgo(30), firstOpenedAt: daysAgo(2) },
		{ title: "Old, archived", readingMinutes: 50, createdAt: daysAgo(30), archivedAt: daysAgo(1) },
		{ title: "Old, trashed", readingMinutes: 50, createdAt: daysAgo(30), deletedAt: daysAgo(1) },
		{ title: "Old, failed", status: "failed", createdAt: daysAgo(30) },
		{ title: "Old, processing", status: "processing", createdAt: daysAgo(30) },
		// For the time choices, saved lately so they stay out of the rediscovered.
		{ title: "Twelve", readingMinutes: 12, createdAt: daysAgo(1) },
		{ title: "Fifteen", readingMinutes: 15, createdAt: daysAgo(2) },
		{ title: "Fifteen, older", readingMinutes: 15, createdAt: daysAgo(3) },
		{ title: "Sixteen", readingMinutes: 16, createdAt: daysAgo(1) },
		{
			title: "Forty, half read",
			readingMinutes: 40,
			readingProgress: 0.7,
			firstOpenedAt: daysAgo(1),
			createdAt: daysAgo(1),
		},
		{ title: "Ten, finished", readingMinutes: 10, readAt: daysAgo(1), createdAt: daysAgo(1) },
		{ title: "Ten, scrolled", readingMinutes: 10, readingProgress: 0.96, createdAt: daysAgo(1) },
		{ title: "Ten, a post", type: "post", readingMinutes: 10, createdAt: daysAgo(1) },
		{ title: "No length", readingMinutes: null, createdAt: daysAgo(1) },
		{ title: "Ten, archived", readingMinutes: 10, archivedAt: daysAgo(1), createdAt: daysAgo(1) },
	])
	await save(otherId, [{ title: "Someone else's", readingMinutes: 10, createdAt: daysAgo(30) }])
})

afterAll(async () => {
	for (const id of [userId, otherId]) await db.delete(user).where(eq(user.id, id))
})

describe("rediscoverDocuments", () => {
	const old = Array.from({ length: 8 }, (_, i) => `Old ${i}`)

	it("picks unread library saves from more than two weeks ago", async () => {
		const all = await rediscoverDocuments({ userId, limit: 50, now })
		expect(titles(all).sort()).toEqual(old)
	})

	it("holds its pick through the day and changes it from day to day", async () => {
		const morning = await rediscoverDocuments({ userId, limit: 3, now })
		const evening = await rediscoverDocuments({
			userId,
			limit: 3,
			now: new Date("2026-10-10T23:00:00Z"),
		})
		expect(titles(evening)).toEqual(titles(morning))
		const picks = new Set<string>()
		for (let day = 11; day <= 20; day++) {
			const later = new Date(`2026-10-${day}T12:00:00Z`)
			picks.add(titles(await rediscoverDocuments({ userId, limit: 3, now: later })).join())
		}
		expect(picks.size).toBeGreaterThan(1)
	})

	it("leaves out the articles shown elsewhere", async () => {
		const first = await rediscoverDocuments({ userId, limit: 3, now })
		const rest = await rediscoverDocuments({
			userId,
			limit: 50,
			now,
			excludeIds: first.map((d) => d.id),
		})
		expect(rest).toHaveLength(5)
		expect(titles(rest)).not.toContain(first[0]!.title)
	})
})

describe("documentsThatFit", () => {
	it("gives the closest fit first, counting the time left of articles in progress", async () => {
		const fits = await documentsThatFit({ userId, minutes: 15, limit: 50 })
		expect(titles(fits)).toEqual(["Fifteen", "Fifteen, older", "Forty, half read", "Twelve"])
	})

	it("leaves out finished articles, posts, articles without a length and other libraries", async () => {
		const fits = await documentsThatFit({ userId, minutes: 11, limit: 50 })
		expect(titles(fits)).toEqual([])
		const hour = titles(await documentsThatFit({ userId, minutes: 60, limit: 50 }))
		for (const title of ["Ten, finished", "Ten, scrolled", "Ten, a post", "No length"])
			expect(hour).not.toContain(title)
		expect(hour).not.toContain("Ten, archived")
		expect(hour).not.toContain("Someone else's")
		expect(hour.slice(0, 2)).toEqual(["Two weeks", "Old 0"])
	})
})

describe("homeCandidates", () => {
	const owners: string[] = []
	afterAll(async () => {
		for (const id of owners) await db.delete(user).where(eq(user.id, id))
	})

	/** Repeatable random numbers (mulberry32), so a failing library can be rebuilt. */
	function random(seed: number) {
		return () => {
			seed = (seed + 0x6d2b79f5) | 0
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}

	/** In progress, unread lately and long ago, finished, posts and articles without a length. */
	async function randomLibrary(seed: number) {
		const next = random(seed)
		const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)]!
		const id = `${userId}-library-${seed}`
		owners.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		await save(
			id,
			Array.from({ length: 60 }, (_, i) => {
				const kind = pick(["reading", "unread", "unread", "unread", "finished"])
				const opened = kind !== "unread"
				return {
					title: `${seed}-${i}`,
					type: next() < 0.1 ? ("post" as const) : ("article" as const),
					readingMinutes: next() < 0.1 ? null : 1 + Math.floor(next() * 90),
					createdAt: daysAgo(next() * 40),
					firstOpenedAt: opened ? daysAgo(next() * 5) : null,
					lastReadAt: opened ? daysAgo(next() * 5) : null,
					readingProgress: kind === "reading" ? next() * 0.9 : 0,
					readAt: kind === "finished" ? daysAgo(1) : null,
				}
			}),
		)
		return id
	}

	it("has what every time choice shows in every section, as if it had everything", async () => {
		const everything = { reading: 1e6, recent: 1e6, rediscover: 1e6 }
		for (const seed of [1, 2, 3, 4, 5, 6]) {
			const id = await randomLibrary(seed)
			const some = await homeCandidates(id, { now })
			const all = await homeCandidates(id, { now, keep: everything })
			for (const minutes of [null, ...TIME_CHOICES]) {
				const ids = (shelves: Record<string, { title: string | null }[]>) =>
					Object.values(shelves).map((docs) => docs.map((d) => d.title))
				expect(ids(homeShelves(some, minutes)), `seed ${seed}, ${minutes} min`).toEqual(
					ids(homeShelves(all, minutes)),
				)
			}
			// Only what some choice needs, not the library.
			const sent = some.reading.length + some.recent.length + some.rediscover.length
			expect(sent).toBeLessThan(all.reading.length + all.recent.length + all.rediscover.length)
		}
	})

	it("counts the minutes left as the cards show them", async () => {
		const id = `${userId}-rounding`
		owners.push(id)
		await db.insert(user).values({ id, name: "Reader", email: `${id}@example.com` })
		await save(id, [
			{ title: "Fifty at 0.9", readingMinutes: 50, readingProgress: 0.9, firstOpenedAt: now },
			{ title: "Zero minutes", readingMinutes: 0 },
		])
		const { reading, recent } = await homeCandidates(id, { now })
		expect(reading.map((d) => d.minutesLeft)).toEqual([5])
		expect(recent.map((d) => d.minutesLeft)).toEqual([null])
	})

	it("counts no time for posts and articles without a length", async () => {
		const { recent } = await homeCandidates(userId, { now })
		const minutes = Object.fromEntries(recent.map((d) => [d.title, d.minutesLeft]))
		expect(minutes["Ten, a post"]).toBeNull()
		expect(minutes["No length"]).toBeNull()
		expect(minutes.Twelve).toBe(12)
		expect(await countUnfinished(userId)).toBeGreaterThan(0)
	})
})
