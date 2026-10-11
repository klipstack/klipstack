import { and, db, documents, eq, inArray, isNotNull, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { urlHash } from "./seed"

const day = 86_400_000

test("old saves never opened come up for review, to archive, keep or delete, with undo", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Review Reader")
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const saves = [
		{ title: "Three months old", age: 90 },
		{ title: "Two months old", age: 60 },
		{ title: "Seven weeks old", age: 49 },
		{ title: "Six weeks old", age: 42 },
		{ title: "Five weeks old", age: 35 },
		{ title: "Thirty-two days old", age: 32 },
		{ title: "Thirty-one days old", age: 31 },
		// Recent: not in the review, and enough unfinished articles for Home to offer a time choice.
		{ title: "Saved last week", age: 7 },
		{ title: "Saved two days ago", age: 2 },
		{ title: "Saved yesterday", age: 1 },
	]
	const rows = await db
		.insert(documents)
		.values(
			saves.map((s) => {
				const url = `https://example.com/review/${owner!.id}/${s.age}`
				return {
					userId: owner!.id,
					sourceUrl: url,
					urlHash: urlHash(url),
					title: s.title,
					status: "ready" as const,
					readingMinutes: 8,
					createdAt: new Date(Date.now() - s.age * day),
				}
			}),
		)
		.returning({ id: documents.id, title: documents.title })
	const id = (title: string) => rows.find((r) => r.title === title)!.id
	const read = (title: string) =>
		db.query.documents.findFirst({ where: eq(documents.id, id(title)) })
	const column = async (titles: string[], key: "archivedAt" | "keptAt") =>
		(
			await db
				.select({ at: documents[key] })
				.from(documents)
				.where(inArray(documents.id, titles.map(id)))
		).map((d) => d.at !== null)

	// Home suggests it quietly, without a count; "Not now" puts it off.
	await page.goto("/home")
	await waitForHydration(page)
	const card = page.getByTestId("home-review")
	await expect(card.getByRole("heading", { name: "Still want to read these?" })).toBeVisible()
	await expect(card).not.toContainText(/\d/)
	// With a time chosen, the reader came to read: no card.
	const time = page.getByTestId("home-time")
	await time.getByRole("link", { name: "15 min", exact: true }).click()
	await expect(time.getByRole("link", { name: "15 min", exact: true })).toHaveAttribute(
		"aria-current",
		"true",
	)
	await expect(card).toHaveCount(0)
	await time.getByRole("link", { name: "Any", exact: true }).click()
	await expect(card).toBeVisible()
	await card.getByRole("button", { name: "Not now" }).click()
	await expect(card).toHaveCount(0)
	await page.reload()
	await expect(page.getByTestId("home-article").first()).toBeVisible()
	await expect(card).toHaveCount(0)

	// A month later it's back; opening the review puts it off again.
	await db.update(user).set({ prefs: {} }).where(eq(user.id, owner!.id))
	await page.reload()
	await waitForHydration(page)
	await card.getByRole("button", { name: "Go through them" }).click()
	await expect(page).toHaveURL(/\/library\/review$/)
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "Saved long ago, never opened" })).toBeVisible()
	const items = page.getByTestId("review-item")
	const titles = saves.slice(0, 7).map((s) => s.title)
	// Each title's link, so "Seven weeks old" doesn't also find "Six weeks old" by its text.
	const link = (title: string) => page.getByRole("link", { name: title, exact: true })
	await expect(items.getByRole("link")).toHaveText(titles)
	const prefs = await db.query.user.findFirst({ where: eq(user.id, owner!.id) })
	expect(prefs?.prefs.reviewSuggestAfter).toBeTruthy()

	// One at a time: archive, and undo.
	const row = (title: string) => items.filter({ has: link(title) })
	await row("Three months old").getByRole("button", { name: "Archive" }).click()
	await expect(link("Three months old")).toHaveCount(0)
	await expect(page.getByText("Archived", { exact: true })).toBeVisible()
	await expect.poll(async () => (await read("Three months old"))?.archivedAt).not.toBeNull()
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(link("Three months old")).toBeVisible()
	await expect.poll(async () => (await read("Three months old"))?.archivedAt).toBeNull()

	// Keep: it leaves the review, remembered.
	await row("Two months old").getByRole("button", { name: "Keep" }).click()
	await expect(link("Two months old")).toHaveCount(0)
	await expect(page.getByText("Kept", { exact: true })).toBeVisible()
	await expect.poll(async () => (await read("Two months old"))?.keptAt).not.toBeNull()

	// Delete is in the article's menu: to the trash.
	await row("Seven weeks old").getByRole("button", { name: "More for “Seven weeks old”" }).click()
	await page.getByRole("menuitem", { name: "Delete" }).click()
	await expect(link("Seven weeks old")).toHaveCount(0)
	await expect.poll(async () => (await read("Seven weeks old"))?.deletedAt).not.toBeNull()

	// All at once: those shown, and undo brings them all back.
	await expect(items).toHaveCount(5)
	await page.getByRole("button", { name: "Archive these 5" }).click()
	await expect(page.getByRole("heading", { name: "Nothing left to go through" })).toBeVisible()
	await expect(page.getByText("5 articles archived")).toBeVisible()
	const shown = [
		"Three months old",
		"Six weeks old",
		"Five weeks old",
		"Thirty-two days old",
		"Thirty-one days old",
	]
	await expect.poll(() => column(shown, "archivedAt")).toEqual([true, true, true, true, true])
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(items).toHaveCount(5)
	await expect.poll(() => column(shown, "archivedAt")).toEqual([false, false, false, false, false])

	await page.getByRole("button", { name: "Keep these 5" }).click()
	await expect(page.getByRole("heading", { name: "Nothing left to go through" })).toBeVisible()
	await expect(page.getByText("5 articles kept")).toBeVisible()
	await expect.poll(() => column(shown, "keptAt")).toEqual([true, true, true, true, true])
	expect((await read("Saved last week"))?.keptAt).toBeNull()
})

test("all at once acts on the saves shown, and the next ones come up after them", async ({
	page,
}) => {
	const email = await signupUser(page, "Review Many")
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	// One more than a page: the newest of them waits for the next.
	const rows = await db
		.insert(documents)
		.values(
			Array.from({ length: 26 }, (_, i) => {
				const url = `https://example.com/review-many/${owner!.id}/${i}`
				return {
					userId: owner!.id,
					sourceUrl: url,
					urlHash: urlHash(url),
					title: `Old save ${i + 1}`,
					status: "ready" as const,
					createdAt: new Date(Date.now() - (100 - i) * day),
				}
			}),
		)
		.returning({ id: documents.id, title: documents.title })
	const last = rows.find((r) => r.title === "Old save 26")!.id

	// Always reachable from the Library, card or not.
	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Library options" }).click()
	await page.getByRole("menuitem", { name: "Review old saves" }).click()
	await expect(page).toHaveURL(/\/library\/review$/)
	await waitForHydration(page)
	const items = page.getByTestId("review-item")
	await expect(items).toHaveCount(25)
	await expect(page.getByText("The oldest 25 are here. More come up as you go.")).toBeVisible()
	await expect(page.getByRole("link", { name: "Old save 26", exact: true })).toHaveCount(0)

	await page.getByRole("button", { name: "Archive these 25" }).click()
	await expect(page.getByText("25 articles archived")).toBeVisible()
	// The one not shown was left alone, and takes their place.
	await expect(items.getByRole("link")).toHaveText(["Old save 26"])
	const [left] = await db
		.select({ archivedAt: documents.archivedAt })
		.from(documents)
		.where(eq(documents.id, last))
	expect(left?.archivedAt).toBeNull()
	const archived = await db
		.select({ id: documents.id })
		.from(documents)
		.where(and(eq(documents.userId, owner!.id), isNotNull(documents.archivedAt)))
	expect(archived).toHaveLength(25)
})
