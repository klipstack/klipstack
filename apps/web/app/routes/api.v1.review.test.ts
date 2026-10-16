import { db, documents, eq } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, describe, expect, it } from "vitest"
import { REVIEW } from "~/lib/review"
import { apiUsers } from "~/test/api-harness"
import { insertArticle } from "../../e2e/seed"

/**
 * The review of old saves in /api/v1, through the SDK as the iPhone app calls it, on the real
 * database: the list, keeping (PATCH /articles with `kept`) and its undo, and Home's suggestion.
 */

const users = apiUsers("api-review")
afterAll(async () => {
	await users.cleanup()
	await stopBoss()
})

const DAY_MS = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY_MS)

async function article(
	owner: string,
	title: string,
	values: Partial<typeof documents.$inferInsert> = {},
) {
	const id = await insertArticle(owner, title, `<p>${title}</p>`)
	await db.update(documents).set(values).where(eq(documents.id, id))
	return id
}

const titles = (items: { title: string | null }[]) => items.map((a) => a.title)

describe("the review of old saves in the API", () => {
	it("lists the reader's old saves never opened, the oldest first", async () => {
		const me = await users.create("Reviewer")
		const other = await users.create("Other")
		const year = await article(me.id, "A year", { createdAt: ago(365) })
		await article(me.id, "Forty days", { createdAt: ago(40) })
		// Too recent, opened, or not in the library: none of these.
		await article(me.id, "Twenty days", { createdAt: ago(20) })
		await article(me.id, "Opened", { createdAt: ago(60), firstOpenedAt: ago(50) })
		await article(me.id, "Archived", { createdAt: ago(60), archivedAt: ago(50) })
		await article(me.id, "Trashed", { createdAt: ago(60), deletedAt: ago(1) })
		await article(other.id, "Theirs", { createdAt: ago(100) })

		const page = await me.client.review.list()
		expect(titles(page.items)).toEqual(["A year", "Forty days"])
		expect(page).toMatchObject({
			more: false,
			afterDays: REVIEW.afterDays,
			keepDays: REVIEW.keepDays,
		})
		// As every list of the API shows an article.
		expect(page.items[0]).toMatchObject({
			id: year,
			location: "inbox",
			opened: false,
			finished: false,
		})
		expect(titles((await other.client.review.list()).items)).toEqual(["Theirs"])
	})

	it("leaves out what is kept, until the keep is undone", async () => {
		const me = await users.create("Keeper")
		const old = await article(me.id, "Old", { createdAt: ago(100) })
		await article(me.id, "Older", { createdAt: ago(200) })

		const kept = await me.client.articles.update([old], { kept: true })
		expect(kept.items.map((a) => a.id)).toEqual([old])
		expect(titles((await me.client.review.list()).items)).toEqual(["Older"])

		await me.client.articles.undo(kept.undo![0]!)
		expect(titles((await me.client.review.list()).items)).toEqual(["Older", "Old"])
	})

	it("keeps only the reader's own articles", async () => {
		const me = await users.create("Mine")
		const other = await users.create("Not mine")
		const theirs = await article(other.id, "Theirs", { createdAt: ago(100) })

		const answer = await me.client.articles.update([theirs], { kept: true })
		expect(answer).toMatchObject({ items: [], notFound: [theirs], undo: [] })
		expect(titles((await other.client.review.list()).items)).toEqual(["Theirs"])
	})

	it("is suggested on Home with enough saves, until put off", async () => {
		const me = await users.create("Suggested")
		const other = await users.create("Also suggested")
		for (let i = 1; i < REVIEW.minToSuggest; i++)
			await article(me.id, `Save ${i}`, { createdAt: ago(40 + i) })
		for (let i = 0; i < REVIEW.minToSuggest; i++)
			await article(other.id, `Theirs ${i}`, { createdAt: ago(40 + i) })
		expect(await me.client.review.suggested()).toEqual({ suggested: false })

		await article(me.id, "One more", { createdAt: ago(60) })
		expect(await me.client.review.suggested()).toEqual({ suggested: true })

		await me.client.review.snooze()
		expect(await me.client.review.suggested()).toEqual({ suggested: false })
		// The list stays; only the suggestion is put off, and only the reader's.
		expect((await me.client.review.list()).items).toHaveLength(REVIEW.minToSuggest)
		expect(await other.client.review.suggested()).toEqual({ suggested: true })
	})
})
