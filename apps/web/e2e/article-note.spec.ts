import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { caretToEnd, sameOrigin, signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
const QUOTE = "There are two types of schedule"

async function signupAndSave(page: Page): Promise<string> {
	await signupUser(page, "Noter", { verified: false })
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(QUOTE, { timeout: 60_000 })
	return id
}

const noteSaved = (page: Page, id: string) =>
	page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/note`) && r.ok())

test("article note: write, autosave, reload, keys, clear, export", async ({ page }) => {
	test.setTimeout(120_000)
	const id = await signupAndSave(page)
	const LONG_NOTE = `Makers need long blocks.\n${"Meetings cost more than their hour. ".repeat(8)}`
	const hl = await page.request.post(`/documents/${id}/highlights`, {
		headers: sameOrigin(),
		data: { intent: "create", exact: QUOTE, note: LONG_NOTE },
	})
	expect(hl.status()).toBe(201)
	await page.reload()
	await waitForHydration(page)

	await page.getByTestId("toggle-sidebar").click()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar.getByRole("heading", { name: "Notes and highlights" })).toBeVisible()
	// highlight notes show in full
	await expect(sidebar).toContainText(LONG_NOTE.trim())

	// typing saves on its own; j/k type letters, they don't move through highlights
	const note = sidebar.getByLabel("Your note", { exact: true })
	// The note is written on a post-it, in its hand; so is each highlight's note below it.
	await expect(
		sidebar
			.locator("[data-post-it]")
			.filter({ has: page.getByLabel("Your note", { exact: true }) }),
	).toBeVisible()
	await expect(note).toHaveCSS("font-style", "italic")
	await expect(
		sidebar.locator("[data-post-it]").filter({ hasText: "Makers need long blocks." }),
	).toBeVisible()
	await note.click()
	await Promise.all([noteSaved(page, id), page.keyboard.type("jk my take")])
	await expect(note).toHaveText("jk my take")
	await expect(sidebar.getByText("Saved", { exact: true })).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/article-note.png` })

	// Escape leaves the note first, then closes the sidebar
	await page.keyboard.press("Escape")
	await expect(sidebar).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(sidebar).toHaveCount(0)

	await page.reload()
	// Before hydration the toggle has no handler yet, and the click would be lost.
	await waitForHydration(page)
	await page.getByTestId("toggle-sidebar").click()
	await expect(sidebar.getByLabel("Your note", { exact: true })).toHaveText("jk my take")

	// clearing it saves on blur and sticks
	await sidebar.getByLabel("Your note", { exact: true }).fill("")
	await Promise.all([noteSaved(page, id), sidebar.getByLabel("Your note", { exact: true }).blur()])
	await page.reload()
	await waitForHydration(page)
	await page.getByTestId("toggle-sidebar").click()
	await expect(sidebar.getByLabel("Your note", { exact: true })).toHaveText("")
})

test("the end of the article asks for the note, the sidebar's, and can start the edition's", async ({
	page,
}) => {
	const email = await signupUser(page, "Noter", { verified: false, editions: true })
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	// Only the end of the article matters: it need not be extracted.
	const paragraphs = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} of the essay.</p>`)
	const id = await insertArticle(owner!.id, "Makers", paragraphs.join(""))
	await page.goto(`/read/${id}`)
	await waitForHydration(page)

	const end = page.getByTestId("reader-end")
	await expect(end).toBeAttached()
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
	// The end in one line, then the private note, named for who reads it, above Star and Share.
	await expect(end.getByTestId("reader-end-status")).toHaveText("You reached the end")
	const endNote = end.getByTestId("reader-end-note")
	await expect(endNote).toContainText("Your note · only you")
	const atEnd = endNote.getByRole("textbox", { name: "Your note" })
	await expect(atEnd).toHaveText("")
	await expect(endNote.locator("[data-placeholder]")).toHaveAttribute(
		"data-placeholder",
		"A line or two for later you:\n· What stayed with you?\n· What do you disagree with?\n· What would you tell a friend about it?",
	)
	// Every line of the placeholder shows: the empty note is as tall as its questions.
	const empty = endNote.getByTestId("note-editor")
	expect(await empty.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
	expect((await empty.boundingBox())!.height).toBeGreaterThan(80)
	const below = await end.getByRole("button", { name: "Star", exact: true }).boundingBox()
	expect((await endNote.boundingBox())!.y).toBeLessThan(below!.y)

	// One note: typed at the end, it is in the sidebar's editor as it is typed, and the other way.
	await page.getByTestId("toggle-sidebar").click()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar).toContainText("Your note · only you")
	const inSidebar = sidebar.getByLabel("Your note", { exact: true })
	await atEnd.click()
	await page.keyboard.type("Meetings cost a maker the afternoon.")
	await expect(inSidebar).toHaveText("Meetings cost a maker the afternoon.")
	// The article menu opens once, in the editor being typed in, not in its twin as well.
	await page.keyboard.type(" [[")
	await expect(page.getByTestId("note-link-menu")).toHaveCount(1)
	await page.keyboard.press("Escape")
	await expect(page.getByTestId("note-link-menu")).toHaveCount(0)
	// Escape closed the menu and left the caret in place: Backspace takes back what was typed.
	for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace")
	await expect(inSidebar).toHaveText("Meetings cost a maker the afternoon.")
	// Its own Link article button opens the same menu, without typing `[[`.
	await endNote.getByTestId("link-article").click()
	await expect(page.getByTestId("note-link-menu")).toHaveCount(1)
	await page.keyboard.press("Escape")
	for (let i = 0; i < 2; i++) await page.keyboard.press("Backspace")
	await expect(inSidebar).toHaveText("Meetings cost a maker the afternoon.")
	await Promise.all([noteSaved(page, id), inSidebar.click()])
	await caretToEnd(page)
	await page.keyboard.type(" Guard mornings.")
	await expect(atEnd).toHaveText("Meetings cost a maker the afternoon. Guard mornings.")
	await Promise.all([noteSaved(page, id), page.keyboard.press("Escape")])
	if (process.env.SHOT_DIR) await end.screenshot({ path: `${process.env.SHOT_DIR}/end-note.png` })

	// Written before: the end shows it, ready to edit.
	await page.reload()
	await waitForHydration(page)
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
	await expect(atEnd).toHaveText("Meetings cost a maker the afternoon. Guard mornings.")

	// Marked for the edition: its note is a second one, for its readers, and can start from the
	// private one, ready to edit.
	await end.getByRole("button", { name: "Add to next edition" }).click()
	const card = end.getByTestId("reader-end-edition-note")
	const forReaders = card.getByRole("textbox", { name: "For your edition's readers" })
	await expect(forReaders).toHaveText("")
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/edition-note`) && r.ok()),
		card.getByRole("button", { name: "Start from my note" }).click(),
	])
	await expect(forReaders).toHaveText("Meetings cost a maker the afternoon. Guard mornings.")
	await expect(forReaders).toBeFocused()
	await expect(card.getByRole("button", { name: "Start from my note" })).toHaveCount(0)
	await page.keyboard.type(" Worth it.")
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/edition-note`) && r.ok()),
		forReaders.blur(),
	])
	// The private note stays as it was.
	await expect(atEnd).toHaveText("Meetings cost a maker the afternoon. Guard mornings.")
	await page.reload()
	await waitForHydration(page)
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
	await expect(forReaders).toHaveText(
		"Meetings cost a maker the afternoon. Guard mornings. Worth it.",
	)
})
