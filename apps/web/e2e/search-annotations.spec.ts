import { db, documents, documentVersions, eq, highlights } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const QUOTE = "The lantern was relit at dusk."
const HIGHLIGHT_NOTE = "Ask the keeper about the foghorn."
const ARTICLE_NOTE = "The lantern budget doubled after the storm."

test("search finds highlights and notes, grouped, and opens each where it is", async ({ page }) => {
	test.setTimeout(90_000)
	const email = await signupUser(page, "Finder")
	const owner = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) })
	// Long enough that the quote is far below the top.
	const filler = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} of the keeper's log.</p>`)
	const keeperId = await insertArticle(owner!.id, "Keepers", `${filler.join("")}<p>${QUOTE}</p>`)
	const version = await db.query.documentVersions.findFirst({
		where: eq(documentVersions.documentId, keeperId),
	})
	const text = filler.map((p) => p.replace(/<\/?p>/g, "")).join("") + QUOTE
	await db.update(documentVersions).set({ text }).where(eq(documentVersions.id, version!.id))
	const [highlight] = await db
		.insert(highlights)
		.values({
			documentId: keeperId,
			userId: owner!.id,
			versionId: version!.id,
			startOffset: text.indexOf(QUOTE),
			endOffset: text.indexOf(QUOTE) + QUOTE.length,
			exact: QUOTE,
			note: HIGHLIGHT_NOTE,
			color: 2,
		})
		.returning({ id: highlights.id })
	const harborId = await insertArticle(owner!.id, "Harbor log", "<p>Tides and ships.</p>")
	await db.update(documents).set({ note: ARTICLE_NOTE }).where(eq(documents.id, harborId))
	await insertArticle(owner!.id, "Lantern makers", "<p>Brass and glass.</p>")

	// One search, three groups: the article by its title, the highlight by its quote, the note.
	await page.goto("/search?q=lantern")
	await waitForHydration(page)
	const main = page.getByRole("main")
	await expect(main.getByRole("heading", { name: "Articles" })).toBeVisible()
	await expect(main.getByRole("link", { name: "Lantern makers" })).toBeVisible()
	const found = page.getByTestId("search-highlights")
	await expect(found.getByRole("heading", { name: "Highlights" })).toBeVisible()
	await expect(found.getByRole("link", { name: QUOTE })).toBeVisible()
	await expect(found.locator("mark")).toHaveText(["lantern"])
	await expect(found).toContainText("Keepers")
	const notes = page.getByTestId("search-notes")
	await expect(notes.getByRole("heading", { name: "Notes" })).toBeVisible()
	await expect(notes).toContainText(ARTICLE_NOTE)
	// The highlight in its color (blue), its note and the article note on post-its.
	await expect(found.getByRole("listitem")).toHaveAttribute("data-hl", "blue")
	await expect(found.locator("[data-post-it]")).toHaveText(HIGHLIGHT_NOTE)
	await expect(notes.locator("[data-post-it]")).toHaveText(ARTICLE_NOTE)
	const groups = page.getByTestId("search-groups")
	await expect(groups.getByRole("link", { name: "1 highlight" })).toBeVisible()
	await expect(groups.getByRole("link", { name: "1 note" })).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/search-groups.png`, fullPage: true })

	// A highlight opens the reader at it.
	await found.getByRole("link", { name: QUOTE }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${keeperId}#h=${highlight!.id}$`))
	await expect(page.getByText(QUOTE)).toBeInViewport()

	// A note opens its article with the note showing.
	await page.goBack()
	await page.getByRole("link", { name: "Note on Harbor log" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${harborId}#note$`))
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar.getByLabel("Note", { exact: true })).toHaveText(ARTICLE_NOTE)

	// Operators narrow every group by the article: none of these is starred.
	await page.goto("/search?q=lantern+is%3Astarred")
	await expect(page.getByRole("heading", { name: "Nothing matches that search." })).toBeVisible()
	await expect(page.getByTestId("search-highlights")).toHaveCount(0)
	await expect(page.getByTestId("search-notes")).toHaveCount(0)

	// The palette finds a highlight by the start of a word in its note (and shows the note: that is
	// where the words are), and an article note.
	await page.goto("/library")
	await waitForHydration(page)
	const palette = page.getByRole("dialog", { name: "Command palette" })
	await page.keyboard.press("ControlOrMeta+k")
	await page.keyboard.type("foghor")
	await expect(palette.getByRole("group", { name: "Highlights" })).toBeVisible()
	await palette.getByRole("option", { name: new RegExp(`^${HIGHLIGHT_NOTE} Keepers$`) }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${keeperId}#h=${highlight!.id}$`))

	await page.keyboard.press("ControlOrMeta+k")
	await page.keyboard.type("budg")
	await expect(palette.getByRole("group", { name: "Notes" })).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/search-palette.png` })
	await palette.getByRole("option", { name: new RegExp(`^${ARTICLE_NOTE}`) }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${harborId}#note$`))
	await expect(sidebar.getByLabel("Note", { exact: true })).toHaveText(ARTICLE_NOTE)
})
