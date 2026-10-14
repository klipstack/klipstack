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
	const maps = await finished("Old maps", 3 * 60_000, "listened")
	await page.reload()
	await waitForHydration(page)
	const card = page.getByRole("region", { name: "Anything to keep from these?" })
	const items = card.getByTestId("home-note")
	await expect(items).toHaveCount(3)

	// Read again: back in the library, unread, under Home's Read again; not asked about meanwhile.
	await items.filter({ hasText: "Old maps" }).getByRole("button", { name: "Read again" }).click()
	await expect(items.filter({ hasText: "Old maps" })).toBeHidden()
	await expect(page.getByText("It's back in your library, under Read again.")).toBeVisible()
	const again = page.getByRole("region", { name: "Read again" })
	await expect(again.getByRole("link", { name: /Old maps/ }).first()).toBeVisible()
	const [put] = await db.select().from(documents).where(eq(documents.id, maps))
	expect(put).toMatchObject({
		firstOpenedAt: null,
		readAt: null,
		archivedAt: null,
		readingCycle: 1,
	})
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
	await expect(second).toBeHidden()
	await expect.poll(skippedAt).toBeInstanceOf(Date)
	await page.getByRole("button", { name: "Undo" }).click()
	await expect.poll(skippedAt).toBeNull()
	await expect(second).toBeVisible()

	// Taken away for good; the note being written stays.
	const reloaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/home.data")
	await second.getByRole("button", { name: "Nothing to add" }).click()
	await expect(second).toBeHidden()
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

	// Read again on two, one right after the other: both go back, the card goes, the answers still
	// come, and Undo brings back the one whose answer came last.
	const other = await finished("Other lighthouse", 2 * 60_000, "listened")
	const lone = await finished("Lone lighthouse", 60_000, "listened")
	await page.reload()
	await waitForHydration(page)
	await expect(items).toHaveCount(2)
	await items
		.filter({ hasText: "Other lighthouse" })
		.getByRole("button", { name: "Read again" })
		.click()
	await items
		.filter({ hasText: "Lone lighthouse" })
		.getByRole("button", { name: "Read again" })
		.click()
	await expect(page.getByTestId("home-notes")).toBeHidden()
	const cycle = async (id: string) =>
		(await db.select().from(documents).where(eq(documents.id, id)))[0]?.readingCycle
	await expect.poll(() => cycle(other)).toBe(1)
	await expect.poll(() => cycle(lone)).toBe(1)
	await page.getByRole("button", { name: "Undo" }).click()
	await expect.poll(async () => [await cycle(other), await cycle(lone)].sort()).toEqual([0, 1])
	const back = (await cycle(lone)) === 0 ? "Lone lighthouse" : "Other lighthouse"
	await expect(items.filter({ hasText: back })).toBeVisible()
	await expect(items).toHaveCount(1)

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
