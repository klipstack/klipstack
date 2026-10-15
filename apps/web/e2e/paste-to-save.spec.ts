import { and, db, documents, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

/** ⌘V / Ctrl+V outside a field: the browser's paste, with `text` on the clipboard. */
async function paste(page: Page, text: string) {
	await page.evaluate((value) => {
		const data = new DataTransfer()
		data.setData("text/plain", value)
		const target = document.activeElement ?? document.body
		target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }))
	}, text)
}

const saved = (userId: string, url: string) =>
	db
		.select({ id: documents.id, deletedAt: documents.deletedAt })
		.from(documents)
		.where(and(eq(documents.userId, userId), eq(documents.sourceUrl, url)))

test("pasting a link anywhere saves it, with Open and Undo", async ({ page }) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Paster")
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id
	const readId = await insertArticle(userId, "Reading", "<p>Something to read.</p>")

	// In the reader, where there is no Save button.
	await page.goto(`/read/${readId}`)
	await waitForHydration(page)
	const url = `https://example.com/pasted/${Date.now()}`
	await paste(page, `  ${url}\n`)
	const toast = page.getByRole("status").filter({ hasText: "Saved to your library." })
	await expect(toast).toBeVisible()
	await expect.poll(async () => (await saved(userId, url)).length).toBe(1)
	const [row] = await saved(userId, url)
	await expect(toast.getByRole("link", { name: "Open" })).toHaveAttribute(
		"href",
		`/read/${row!.id}`,
	)
	await toast.getByRole("button", { name: "Undo" }).click()
	await expect.poll(async () => (await saved(userId, url))[0]?.deletedAt).not.toBeNull()

	// In Settings: a link already in the library is not saved twice.
	const [reading] = await db
		.select({ url: documents.sourceUrl })
		.from(documents)
		.where(eq(documents.id, readId))
	await page.goto("/settings/shortcuts")
	await waitForHydration(page)
	await paste(page, reading!.url)
	const already = page.getByRole("status").filter({ hasText: "Already in your library." })
	await expect(already).toBeVisible()
	await expect(already.getByRole("button", { name: "Undo" })).toHaveCount(0)
	expect(await saved(userId, reading!.url)).toHaveLength(1)

	// On the library, where the Save link dialog is: saved, the dialog left closed.
	await page.goto("/library")
	await waitForHydration(page)
	const other = `https://example.com/pasted/library-${Date.now()}`
	await paste(page, other)
	await expect(page.getByRole("status").filter({ hasText: "Saved to your library." })).toBeVisible()
	await expect(page.getByRole("dialog", { name: "Save a link" })).toBeHidden()
	await expect.poll(async () => (await saved(userId, other)).length).toBe(1)

	// A link the save refuses: its reason, as the dialog would show it.
	await paste(page, `https://example.com/${"x".repeat(5000)}`)
	await expect(
		page.getByRole("status").filter({ hasText: "That does not look like a valid link." }),
	).toBeVisible()
})

test("text that is not a link, or a paste into a field, saves nothing", async ({ page }) => {
	const email = await signupUser(page, "Paster")
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	await page.goto("/search")
	await waitForHydration(page)
	await paste(page, "just some words https://example.com/inside")
	const field = page.getByRole("main").getByRole("searchbox")
	await field.focus()
	await paste(page, "https://example.com/into-the-field")
	// Nothing to wait for when nothing happens: time for a save's answer to come back.
	await page.waitForTimeout(1000)
	await expect(page.getByRole("status").filter({ hasText: "library" })).toHaveCount(0)
	expect(await db.select().from(documents).where(eq(documents.userId, owner!.id))).toHaveLength(0)
})
