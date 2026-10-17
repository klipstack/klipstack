import { db, documents, eq, inArray, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text })
const card = (page: Page, title: string) =>
	page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title }) })

/** Ready articles, newest first, for a new account. */
async function library(
	page: Page,
	titles: string[],
	extra: Partial<typeof documents.$inferInsert> = {},
) {
	const email = await signupUser(page, "Menus")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing article-menus test user")
	const rows = await db
		.insert(documents)
		.values(
			titles.map((title, i) => ({
				userId: owner.id,
				sourceUrl: `https://example.com/menus/${i}`,
				urlHash: `${owner.id}-${i}`,
				title,
				status: "ready" as const,
				createdAt: new Date(Date.now() - i * 60_000),
				...extra,
			})),
		)
		.returning({ id: documents.id, title: documents.title })
	return rows
}

test("a card's menu: its groups, Mark as finished with an undo, and Rename", async ({ page }) => {
	const [first] = await library(page, ["First of the menus", "Second of the menus"])
	await page.goto("/library")
	await waitForHydration(page)

	// Never opened: nothing to mark unread. Then what it is in, then the original, then Delete.
	await card(page, "First of the menus").getByRole("button", { name: "More actions" }).click()
	const menu = page.getByRole("menu", { name: "More actions" })
	await expect(menu.getByRole("menuitem")).toHaveText([
		"Mark as finished",
		"Add to next editionN",
		"Tags…T",
		"Rename…",
		"Open original",
		"Copy link",
		"Delete#",
	])

	// Finishing archives it: it leaves the Inbox, and the undo brings it back unfinished.
	await menu.getByRole("menuitem", { name: "Mark as finished" }).click()
	await expect(toast(page, "Finished and archived")).toBeVisible()
	await expect(card(page, "First of the menus")).toHaveCount(0)
	const stored = () => db.query.documents.findFirst({ where: eq(documents.id, first!.id) })
	await expect.poll(async () => Boolean((await stored())?.readAt)).toBe(true)
	expect((await stored())?.archivedAt).not.toBeNull()
	await toast(page, "Finished and archived").getByRole("button", { name: "Undo" }).click()
	await expect(card(page, "First of the menus")).toBeVisible()
	await expect.poll(async () => (await stored())?.readAt ?? null).toBeNull()
	expect((await stored())?.archivedAt).toBeNull()

	// Rename asks for the title in a dialog; the card shows the new one.
	await card(page, "Second of the menus").getByRole("button", { name: "More actions" }).click()
	await menu.getByRole("menuitem", { name: "Rename…" }).click()
	const dialog = page.getByRole("dialog", { name: "Rename article" })
	await expect(dialog.getByLabel("Title")).toHaveValue("Second of the menus")
	await dialog.getByLabel("Title").fill("Renamed from its menu")
	await dialog.getByRole("button", { name: "Rename" }).click()
	await expect(dialog).toHaveCount(0)
	await expect(card(page, "Renamed from its menu")).toBeVisible()
})

test("trashed articles can be deleted forever together, after a second tap", async ({ page }) => {
	const rows = await library(page, ["Trashed one", "Trashed two"], { deletedAt: new Date() })
	await page.goto("/trash")
	await waitForHydration(page)
	const bar = page.getByRole("toolbar", { name: "Selected articles" })
	await page.getByRole("checkbox", { name: "Select “Trashed one”" }).click()
	await bar.getByRole("button", { name: "Select all 2" }).click()
	await expect(bar.getByRole("button", { name: "Restore" })).toBeVisible()
	await bar.getByRole("button", { name: "Delete forever" }).click()
	// The first tap only asks: nothing is gone yet.
	await expect(bar.getByRole("button", { name: "Tap again to delete forever" })).toBeVisible()
	await expect(card(page, "Trashed one")).toBeVisible()
	await bar.getByRole("button", { name: "Tap again to delete forever" }).click()
	await expect(toast(page, "2 articles deleted forever")).toBeVisible()
	// For good: no undo.
	await expect(
		toast(page, "2 articles deleted forever").getByRole("button", { name: "Undo" }),
	).toHaveCount(0)
	await expect
		.poll(async () =>
			db
				.select({ id: documents.id })
				.from(documents)
				.where(
					inArray(
						documents.id,
						rows.map((r) => r.id),
					),
				),
		)
		.toEqual([])
})

test("the reader's menu: archive with an undo either way, and Mark as finished", async ({
	page,
}) => {
	const email = await signupUser(page, "Reader menus")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing article-menus test user")
	const title = "Read from its menu"
	const id = await insertArticle(owner.id, title, "<p>Something to read, then finish.</p>")
	const stored = () => db.query.documents.findFirst({ where: eq(documents.id, id) })

	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("link", { name: title }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
	await waitForHydration(page)
	const more = page.getByRole("banner").getByRole("button", { name: "More actions" })
	const menu = page.getByRole("menu", { name: "More actions" })
	await more.click()
	await expect(menu.getByRole("menuitem")).toHaveText([
		"ArchiveE",
		"Mark as finished",
		"Mark as unreadU",
		"Add to next editionN",
		"Tags…T",
		"Open original",
		"Copy link",
		"Delete#",
	])

	// Archived, the reader stays; the toast says so and can take it back.
	await menu.getByRole("menuitem", { name: "Archive" }).click()
	await expect(toast(page, "Archived")).toBeVisible()
	await expect.poll(async () => Boolean((await stored())?.archivedAt)).toBe(true)
	await toast(page, "Archived").getByRole("button", { name: "Undo" }).click()
	await expect.poll(async () => (await stored())?.archivedAt ?? null).toBeNull()
	await more.click()
	await expect(menu.getByRole("menuitem", { name: "Archive" })).toBeVisible()

	// Archived, then moved back: its undo archives it again, and the menu says so.
	await menu.getByRole("menuitem", { name: "Archive" }).click()
	await expect.poll(async () => Boolean((await stored())?.archivedAt)).toBe(true)
	await more.click()
	await menu.getByRole("menuitem", { name: "Move to Inbox" }).click()
	await expect(toast(page, "Moved to Inbox")).toBeVisible()
	await expect.poll(async () => (await stored())?.archivedAt ?? null).toBeNull()
	await toast(page, "Moved to Inbox").getByRole("button", { name: "Undo" }).click()
	await expect.poll(async () => Boolean((await stored())?.archivedAt)).toBe(true)
	await more.click()
	await expect(menu.getByRole("menuitem", { name: "Move to Inbox" })).toBeVisible()
	await page.keyboard.press("Escape")

	// Mark as finished: finished, and back to the list it came from.
	await more.click()
	await menu.getByRole("menuitem", { name: "Mark as finished" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(toast(page, "Marked as finished")).toBeVisible()
	await expect.poll(async () => Boolean((await stored())?.readAt)).toBe(true)
})
