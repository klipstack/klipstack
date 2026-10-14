import { db, documents, eq, highlights, readingCompletions, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const HOUR = 3_600_000

test("Home asks about articles finished without a note, gently", async ({ page }) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Notes Reader")
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id

	/** An article finished `ago` milliseconds back, opened a day before. */
	const finished = async (title: string, ago: number, source: "progress" | "listened") => {
		const id = await insertArticle(userId, title, `<p>${title}</p>`)
		await db
			.update(documents)
			.set({ firstOpenedAt: new Date(Date.now() - 24 * HOUR) })
			.where(eq(documents.id, id))
		await db.insert(readingCompletions).values({
			userId,
			documentId: id,
			cycle: 0,
			completedAt: new Date(Date.now() - ago),
			source,
		})
		return id
	}

	// One read to the end, and nothing else: not enough to ask.
	const read = await finished("Slow gardens", 2 * HOUR, "progress")
	await page.goto("/home")
	await waitForHydration(page)
	await expect(page.getByTestId("home-notes")).toHaveCount(0)

	// One listened to: Home asks at once, about both.
	const heard = await finished("Tides and moons", 60_000, "listened")
	const [doc] = await db
		.select({ versionId: documents.currentVersionId })
		.from(documents)
		.where(eq(documents.id, heard))
	await db.insert(highlights).values({
		userId,
		documentId: heard,
		versionId: doc!.versionId!,
		startOffset: 0,
		endOffset: 5,
		exact: "The moon pulls the sea.",
	})
	await page.reload()
	await waitForHydration(page)
	const card = page.getByRole("region", { name: "Anything to keep from these?" })
	const items = card.getByTestId("home-note")
	await expect(items).toHaveCount(2)
	const first = items.filter({ hasText: "Tides and moons" })
	await expect(first).toContainText("Listened to")
	await expect(first).toContainText("The moon pulls the sea.")
	await expect(items.filter({ hasText: "Slow gardens" })).toContainText("Finished")

	// The note is written in place, and saved as it is typed.
	await first.getByRole("button", { name: "Write a note" }).click()
	const field = first.getByRole("textbox", { name: "Note" })
	await field.click()
	await page.keyboard.type("Tides are a conversation with the moon.")
	await expect
		.poll(async () => (await db.select().from(documents).where(eq(documents.id, heard)))[0]?.note)
		.toBe("Tides are a conversation with the moon.")

	// Nothing to add takes one away, with undo.
	const second = items.filter({ hasText: "Slow gardens" })
	const skippedAt = async () =>
		(await db.select().from(documents).where(eq(documents.id, read)))[0]?.noteSkippedAt
	await second.getByRole("button", { name: "Nothing to add" }).click()
	await expect(second).toHaveCount(0)
	await expect.poll(skippedAt).toBeInstanceOf(Date)
	await page.getByRole("button", { name: "Undo" }).click()
	await expect.poll(skippedAt).toBeNull()
	await expect(second).toHaveCount(1)

	// Taken away for good; the note being written stays.
	const reloaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/home.data")
	await second.getByRole("button", { name: "Nothing to add" }).click()
	await expect(second).toHaveCount(0)
	await expect.poll(skippedAt).toBeInstanceOf(Date)
	// Home loaded again after it, and no longer asks about either: give the page a moment to show
	// that answer, so the check below would see the article go if the card dropped it.
	await reloaded
	await page.waitForTimeout(300)
	await expect(first).toBeVisible()
	await expect(field).toHaveText("Tides are a conversation with the moon.")

	// Both answered: nothing left to ask.
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByTestId("home-notes")).toHaveCount(0)

	// Not now puts a new question off.
	await finished("Rivers", 60_000, "listened")
	await page.reload()
	await waitForHydration(page)
	const snoozed = page.waitForResponse(
		(r) => new URL(r.url()).pathname === "/home/notes.data" && r.request().method() === "POST",
	)
	await card.getByRole("button", { name: "Not now" }).click()
	await expect(page.getByTestId("home-notes")).toHaveCount(0)
	await snoozed
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByTestId("home-notes")).toHaveCount(0)
})
