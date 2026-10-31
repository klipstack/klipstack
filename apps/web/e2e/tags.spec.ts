import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { sameOrigin, signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const TITLE = "Maker's Schedule, Manager's Schedule"
const OLDER = "Older numbat essay"
const NEWER = "Newer numbat essay"

async function save(page: Page, slug: string, title: string): Promise<string> {
	const html = readFileSync(FIXTURE, "utf8").replaceAll(TITLE, title)
	const res = await page.request.post("/api/documents", {
		data: { url: `https://example.com/tags/${slug}`, html },
	})
	return ((await res.json()) as { article: { id: string } }).article.id
}

test("tags: on a card, as a search, in the command menu, in the reader, on their page", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await signupUser(page, "Tagger")
	await save(page, "older", OLDER)
	await save(page, "newer", NEWER)
	await page.goto("/library")
	for (const title of [OLDER, NEWER])
		await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 60_000 })
	await waitForHydration(page)
	// The sidebar has one link to the tags page, never the tags themselves.
	const tagsLink = page.locator("aside").getByRole("link", { name: "Tags", exact: true })
	const card = (title: string) => page.getByRole("listitem").filter({ hasText: title })
	const dialog = page.getByTestId("tag-dialog")
	const field = dialog.getByRole("combobox", { name: "Tag name" })

	// T on the card under the cursor. Enter makes a tag, and so does a comma.
	await page.keyboard.press("j")
	await expect(card(NEWER)).toHaveAttribute("data-cursor", "true")
	await page.keyboard.press("t")
	await expect(field).toBeFocused()
	await field.fill("later")
	await expect(dialog.getByRole("option", { name: "Create “later”" })).toBeVisible()
	await page.keyboard.press("Enter")
	await expect(dialog.getByTestId("tag-dialog-tags")).toContainText("later")
	await expect(field).toHaveValue("")
	await page.keyboard.type("Deep  Work,")
	await expect(dialog.getByRole("button", { name: "Remove tag Deep Work" })).toBeVisible()
	// The card's own keys stay quiet while the dialog is open: "e" would archive it.
	await page.keyboard.type("e")
	await expect(field).toHaveValue("e")
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)
	await expect(card(NEWER)).toBeVisible()
	await expect(card(NEWER).getByTestId("card-tags").getByRole("listitem")).toHaveText([
		"Deep Work",
		"later",
	])

	// The other card, from its menu: the tags that exist are offered, whatever the case typed.
	await card(OLDER).hover()
	await card(OLDER).getByRole("button", { name: "More actions" }).click()
	await page.getByRole("menuitem", { name: "Tags…" }).click()
	await field.fill("LAT")
	await expect(dialog.getByRole("option")).toHaveText(["later", "Create “LAT”"])
	await page.keyboard.press("ArrowDown")
	await page.keyboard.press("Enter")
	await expect(dialog.getByRole("button", { name: "Remove tag later" })).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(card(OLDER).getByTestId("card-tags").getByRole("listitem")).toHaveText(["later"])

	// The tags page, from the sidebar, lists them with their counts; a name there is a search.
	await tagsLink.click()
	await expect(page).toHaveURL(/\/tags$/)
	await expect(tagsLink).toHaveAttribute("aria-current", "page")
	await expect(page.getByRole("heading", { name: "Tags", level: 1 })).toBeVisible()
	const rows = page.getByTestId("tags-list").getByRole("listitem")
	await expect(rows).toHaveText([/Deep Work.*1 article/, /later.*2 articles/])
	await rows.getByRole("link", { name: "later" }).click()
	await expect(page).toHaveURL(/\/search\?q=tag%3Alater$/)
	await expect(page.getByRole("link", { name: OLDER })).toBeVisible()
	await expect(page.getByRole("link", { name: NEWER })).toBeVisible()
	// The chips on the cards are text, not links: a card has one link, to its article.
	await expect(page.getByTestId("card-tags").getByRole("link")).toHaveCount(0)
	// A name with a space goes in quotes.
	await page.goto("/tags")
	await waitForHydration(page)
	await rows.getByRole("link", { name: "Deep Work" }).click()
	await expect(page).toHaveURL(/\/search\?q=tag%3A%22Deep%20Work%22$/)
	await expect(page.getByRole("link", { name: NEWER })).toBeVisible()
	await expect(page.getByRole("link", { name: OLDER })).toHaveCount(0)
	// The command menu finds tags as they are typed, a few letters of each word being enough.
	await page.keyboard.press("ControlOrMeta+k")
	const palette = page.getByPlaceholder("Search or type a command…")
	await palette.fill("dw")
	const tagOption = page.getByRole("option", { name: /Deep Work/ })
	await expect(tagOption).toContainText("1 article")
	await expect(tagOption).toHaveAttribute("aria-selected", "true")
	await palette.fill("later")
	await expect(page.getByRole("option", { name: /^later/ })).toHaveAttribute(
		"aria-selected",
		"true",
	)
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/search\?q=tag%3Alater$/)
	await expect(page.getByRole("link", { name: OLDER })).toBeVisible()
	// The untagged are one dash away.
	await page.goto(`/search?q=${encodeURIComponent("-has:tags numbat")}`)
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()

	// The reader shows the tags under the title, and edits them with the same dialog.
	await page.goto(`/search?q=${encodeURIComponent("tag:later")}`)
	await page.getByRole("link", { name: OLDER }).click()
	await expect(page).toHaveURL(/\/read\//)
	await waitForHydration(page)
	const readerTags = page.getByTestId("reader-tags")
	await expect(readerTags.getByRole("link")).toHaveText(["later"])
	await page.keyboard.press("t")
	await expect(field).toBeFocused()
	await field.fill('bad "name"')
	await page.keyboard.press("Enter")
	await expect(dialog.getByRole("alert")).toContainText("no quotes or commas")
	await field.fill("")
	// Backspace in the empty field takes the last tag off.
	await page.keyboard.press("Backspace")
	await expect(dialog.getByTestId("tag-dialog-tags")).toHaveCount(0)
	await page.keyboard.press("Escape")
	await expect(readerTags.getByRole("link")).toHaveCount(0)
	await expect(readerTags.getByRole("button", { name: "Add tag" })).toBeVisible()

	// Back on the tags page: a rename onto another tag's name merges the two; a delete takes two
	// taps, and names the saved searches that use the tag first.
	await page.goto("/tags")
	await waitForHydration(page)
	await expect(rows).toHaveCount(2)
	// Names are text until their menu's Rename is chosen, and one at a time: a second Rename closes
	// the first field. Escape gives up, and the menu's button has the focus again.
	const fields = page.getByTestId("tags-list").getByRole("textbox")
	await expect(fields).toHaveCount(0)
	const rename = async (tag: string) => {
		await page.getByRole("button", { name: `More for ${tag}` }).click()
		await page.getByRole("menuitem", { name: "Rename" }).click()
	}
	await rename("later")
	await expect(page.getByRole("textbox", { name: "Name of the tag later" })).toBeFocused()
	await page.keyboard.type("dropped")
	await rename("Deep Work")
	await expect(fields).toHaveCount(1)
	const name = page.getByRole("textbox", { name: "Name of the tag Deep Work" })
	await expect(name).toBeFocused()
	await expect(name).toHaveValue("Deep Work")
	await page.keyboard.press("Escape")
	await expect(fields).toHaveCount(0)
	await expect(page.getByRole("button", { name: "More for Deep Work" })).toBeFocused()
	await expect(rows.filter({ hasText: "later" })).toHaveCount(1)
	// A name no tag can have keeps the field open and says why. Enter opens the menu, then Rename.
	await page.keyboard.press("Enter")
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused()
	await page.keyboard.press("Enter")
	await name.fill('Deep "Work"')
	await page.keyboard.press("Enter")
	await expect(page.getByRole("alert")).toContainText("no quotes or commas")
	await name.fill("LATER")
	await page.keyboard.press("Enter")
	await expect(page.getByText("Merged into later")).toBeVisible()
	await expect(rows).toHaveCount(1)
	await expect(fields).toHaveCount(0)
	await expect(rows).toContainText("1 article")
	// A saved search names the tag. Made after the page loaded, it is news to the page: the delete
	// is refused, and the row says which search, and that it would find nothing.
	const soon = await page.request.post("/saved-searches", {
		headers: sameOrigin(),
		form: { intent: "create", name: "Soon", query: "is:unread -TAG:Later" },
	})
	expect(soon.ok()).toBe(true)
	const deleteLater = {
		click: async () => {
			await page.getByRole("button", { name: "More for later" }).click()
			await page.getByRole("menuitem", { name: "Delete" }).click()
		},
	}
	const confirmDelete = page.getByRole("button", { name: "Tap again to delete" })
	const warning = page.getByTestId("tags-list").getByRole("alert")
	const warned = "A saved search uses this tag: Soon. Without the tag, it will find nothing."
	await deleteLater.click()
	// The confirm takes the menu's place, and the focus with it.
	await expect(confirmDelete).toBeFocused()
	await expect(warning).toHaveCount(0)
	await confirmDelete.click()
	await expect(warning).toHaveText(warned)
	await expect(rows).toHaveCount(1)
	// Known when the page loads, the search is named at the first tap. The second tap deletes the
	// tag anyway; the saved search stays as it was.
	await page.reload()
	await waitForHydration(page)
	await deleteLater.click()
	await expect(warning).toHaveText(warned)
	await confirmDelete.click()
	await expect(page.getByTestId("tags-empty")).toBeVisible()
	await expect(
		page.locator("aside").getByTestId("saved-searches").getByRole("link", { name: "Soon" }),
	).toHaveAttribute("href", `/search?q=${encodeURIComponent("is:unread -TAG:Later")}`)
	// The article is still there, with no tags.
	await page.goto("/library")
	await expect(page.getByRole("link", { name: NEWER })).toBeVisible()
	await expect(page.getByTestId("card-tags")).toHaveCount(0)
})

test.describe("quick changes", () => {
	// Requests the service worker answers never reach `page.route`.
	test.use({ serviceWorkers: "block" })

	test("two tags added quickly both stay", async ({ page }) => {
		const email = await signupUser(page, "Quick Tagger")
		const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
		// Straight in the database: the test is about tags, not about saving.
		const id = await insertArticle(owner!.id, OLDER, "<p>Numbats eat termites.</p>")
		// A slow server: the second tag is added while the first is still on its way.
		const answered: number[] = []
		await page.route(`**/documents/${id}/tags*`, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 300))
			const response = await route.fetch().catch(() => null)
			if (!response) return
			answered.push(response.status())
			await route.fulfill({ response }).catch(() => undefined)
		})
		await page.goto("/library")
		await expect(page.getByRole("link", { name: OLDER })).toBeVisible()
		await waitForHydration(page)
		await page.keyboard.press("j")
		await page.keyboard.press("t")
		const dialog = page.getByTestId("tag-dialog")
		await expect(dialog.getByRole("combobox", { name: "Tag name" })).toBeFocused()
		await page.keyboard.type("alpha,beta,")
		await expect(dialog.getByTestId("tag-dialog-tags")).toContainText("alpha")
		await expect(dialog.getByTestId("tag-dialog-tags")).toContainText("beta")
		await expect.poll(() => answered).toEqual([200, 200])
		await page.keyboard.press("Escape")
		await expect(dialog).toHaveCount(0)

		await page.reload()
		const card = page.getByRole("listitem").filter({ hasText: OLDER })
		await expect(card.getByTestId("card-tags").getByRole("listitem")).toHaveText(["alpha", "beta"])
	})
})
