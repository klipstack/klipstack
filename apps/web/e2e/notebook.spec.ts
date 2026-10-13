import { db, documents, documentTags, eq, tags, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const noteSaved = (page: Page, id: string, status = 200) =>
	page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/note`) && r.status() === status)

async function writeNote(page: Page, id: string, note: string) {
	const res = await page.request.post(`/documents/${id}/note`, { data: { note } })
	expect(res.ok()).toBe(true)
}

const stored = async (id: string) =>
	(await db.query.documents.findFirst({ where: eq(documents.id, id) }))!.note

test("the notebook lists every note as a post-it, edits it in place, and finds it", async ({
	page,
}) => {
	test.setTimeout(120_000)
	const email = await signupUser(page, "Notebook")
	const owner = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) })

	// Empty: an invitation to write the first note.
	await page.goto("/notebook")
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "Your notebook is empty" })).toBeVisible()
	await expect(page.getByRole("link", { name: "Open your library" })).toBeVisible()

	const tides = await insertArticle(owner!.id, "Tides", "<p>Tides and moons.</p>")
	const lighthouses = await insertArticle(owner!.id, "Lighthouses", "<p>Lamps.</p>")
	await insertArticle(owner!.id, "Without a note", "<p>Nothing to say.</p>")
	await writeNote(page, tides, "The moon pulls twice a day.")
	await writeNote(page, lighthouses, `Ask the keeper. Compare with [Tides](/read/${tides}).`)
	const [birds] = await db.insert(tags).values({ userId: owner!.id, name: "coast" }).returning()
	await db.insert(documentTags).values({ documentId: tides, tagId: birds!.id })

	// Most recently edited first, each next to its article; the link reads as in the reader.
	await page.goto("/notebook")
	await waitForHydration(page)
	const notes = page.getByTestId("notebook-note")
	await expect(notes).toHaveCount(2)
	await expect(notes.nth(0).getByLabel("Note on Lighthouses")).toContainText("Ask the keeper.")
	await expect(notes.nth(0).getByRole("link", { name: "Open Lighthouses" })).toBeVisible()
	await expect(notes.nth(1).getByLabel("Note on Tides")).toHaveText("The moon pulls twice a day.")
	// The link to Tides is a chip, as in the reader.
	await expect(notes.nth(0).getByTestId("doc-chip")).toHaveText("Tides")
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/notebook.png`, fullPage: true })

	// Written in place, saved on its own.
	const tidesNote = page.getByLabel("Note on Tides")
	await tidesNote.click()
	await page.keyboard.press("End")
	await Promise.all([noteSaved(page, tides), page.keyboard.type(" Spring tides are higher.")])
	await expect(page.getByTestId("notebook-note").nth(1)).toContainText("Saved")
	expect(await stored(tides)).toBe("The moon pulls twice a day. Spring tides are higher.")
	// The next save replaces the note this one wrote: no conflict with itself.
	await Promise.all([noteSaved(page, tides), page.keyboard.type(" Twice a month.")])
	expect(await stored(tides)).toBe(
		"The moon pulls twice a day. Spring tides are higher. Twice a month.",
	)

	// Changed elsewhere meanwhile: nothing is overwritten unseen, and the writer chooses.
	await writeNote(page, tides, "Rewritten in the reader.")
	await Promise.all([noteSaved(page, tides, 409), page.keyboard.type(" Neap tides too.")])
	const alert = page.getByRole("alert")
	await expect(alert).toContainText("This note changed somewhere else")
	expect(await stored(tides)).toBe("Rewritten in the reader.")
	await Promise.all([
		noteSaved(page, tides),
		alert.getByRole("button", { name: "Keep mine" }).click(),
	])
	await expect(alert).toHaveCount(0)
	expect(await stored(tides)).toBe(
		"The moon pulls twice a day. Spring tides are higher. Twice a month. Neap tides too.",
	)

	await writeNote(page, tides, "The reader's version wins.")
	await tidesNote.click()
	await page.keyboard.press("End")
	await Promise.all([noteSaved(page, tides, 409), page.keyboard.type("!")])
	await page.getByRole("button", { name: "Use the saved note" }).click()
	await expect(page.getByLabel("Note on Tides")).toHaveText("The reader's version wins.")
	// The editor left behind sends nothing: once the page is quiet, the saved note is still there.
	await page.waitForLoadState("networkidle")
	expect(await stored(tides)).toBe("The reader's version wins.")

	// Search by the note's words, and the tag filter.
	await page.goto("/notebook?q=keeper")
	await expect(notes).toHaveCount(1)
	await expect(notes.first()).toContainText("Lighthouses")
	await page.goto("/notebook?q=nothingmatches")
	await expect(page.getByText("No notes match that search.")).toBeVisible()
	await page.goto("/notebook")
	await page.getByRole("navigation", { name: "Tags" }).getByRole("link", { name: /coast/ }).click()
	await expect(page).toHaveURL(/\/notebook\?tag=coast$/)
	await expect(notes).toHaveCount(1)
	await expect(notes.first()).toContainText("Tides")

	// An article opens with its note showing.
	await page.getByRole("link", { name: "Open Tides" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${tides}#note$`))
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar.getByLabel("Note", { exact: true })).toHaveText("The reader's version wins.")

	// From the sidebar and the command palette.
	await page.goto("/home")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Notebook" }).click()
	await expect(page).toHaveURL(/\/notebook$/)
	await page.goto("/library")
	await waitForHydration(page)
	await page.keyboard.press("ControlOrMeta+k")
	await page.keyboard.type("notebook")
	await page
		.getByRole("dialog", { name: "Command palette" })
		.getByRole("option", { name: "Notebook", exact: true })
		.click()
	await expect(page).toHaveURL(/\/notebook$/)
})

test("a Spanish reader's empty notebook, on a phone", async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
	const page = await context.newPage()
	const email = await signupUser(page, "Cuaderno")
	await db.update(user).set({ locale: "es" }).where(eq(user.email, email))
	await page.goto("/notebook")
	await expect(page.getByRole("heading", { name: "Tu cuaderno está vacío" })).toBeVisible()
	await expect(page.getByRole("link", { name: "Abrir tu biblioteca" })).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/notebook-empty-es.png` })
	await context.close()
})
