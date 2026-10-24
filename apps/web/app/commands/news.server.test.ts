import { db, eq, user as userTable } from "@klipstack/db"
import { afterAll, describe, expect, it, vi } from "vitest"
import { closeNews } from "./news.server"

// The shipped entries change with every release: these tests bring entries of their own.
vi.mock("~/news", () => {
	const page = (title: string) =>
		`<html><head><title>${title}</title><meta name="description" content="${title}."></head><body><article><p>${title}</p></article></body></html>`
	return {
		NEWS: [
			{ slug: "first", date: "2026-10-01" },
			{ slug: "second", date: "2026-10-02" },
		],
		NEWS_PAGES: Object.fromEntries(
			["first", "second"].flatMap((slug) => [
				[`./${slug}/en.html`, page(slug)],
				[`./${slug}/es.html`, page(slug)],
			]),
		),
	}
})

const stamp = `test-news-${Date.now()}`
const users: string[] = []

async function reader() {
	const id = `${stamp}-${users.length}`
	users.push(id)
	await db.insert(userTable).values({
		id,
		name: "Reader",
		email: `${id}@example.com`,
		prefs: { theme: "dark", onboarding: { cardEndedAt: "2026-01-01T00:00:00.000Z" } },
	})
	return id
}

const prefsOf = async (id: string) =>
	(await db.select({ prefs: userTable.prefs }).from(userTable).where(eq(userTable.id, id)))[0]!
		.prefs

afterAll(async () => {
	for (const id of users) await db.delete(userTable).where(eq(userTable.id, id))
})

describe("closeNews", () => {
	it("keeps each closed entry once, and the rest of the preferences", async () => {
		const id = await reader()
		expect(await closeNews(id, { slug: "second" })).toEqual({ slug: "second" })
		await closeNews(id, { slug: "first" })
		await closeNews(id, { slug: "second" })
		const prefs = await prefsOf(id)
		expect([...prefs.newsClosed!].sort()).toEqual(["first", "second"])
		expect(prefs.theme).toBe("dark")
		expect(prefs.onboarding).toEqual({ cardEndedAt: "2026-01-01T00:00:00.000Z" })
	})

	it("refuses an entry that is not in the news, and keeps nothing for it", async () => {
		const id = await reader()
		await expect(closeNews(id, { slug: "nothing-like-it" })).rejects.toMatchObject({
			code: "not_found",
		})
		expect((await prefsOf(id)).newsClosed).toBeUndefined()
	})
})
