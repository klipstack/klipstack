import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const TITLE = "Maker's Schedule, Manager's Schedule"
const OLDER = "Older quokka essay"
const NEWER = "Newer quokka essay"

async function save(page: Page, slug: string, title: string): Promise<string> {
	const html = readFileSync(FIXTURE, "utf8").replaceAll(TITLE, title)
	const res = await page.request.post("/api/documents", {
		data: { url: `https://example.com/saved-searches/${slug}`, html },
	})
	return ((await res.json()) as { article: { id: string } }).article.id
}

test("saved searches: save one, open it from the sidebar, rename it, delete it; a tag rename follows", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await signupUser(page, "Searcher")
	await save(page, "older", OLDER)
	const newer = await save(page, "newer", NEWER)
	await page.goto("/library")
	for (const title of [OLDER, NEWER])
		await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 60_000 })
	const tagged = await page.request.post(`/documents/${newer}/tags`, {
		form: { intent: "add", name: "later" },
	})
	expect(tagged.ok()).toBe(true)

	const section = page.locator("aside").getByTestId("saved-searches")
	const rows = section.getByRole("link")
	const dialog = page.getByTestId("saved-search-dialog")
	const name = dialog.getByRole("textbox", { name: "Name" })
	const saveButton = page.getByRole("button", { name: "Save search" })
	// With none, the sidebar has no such section, and the tips page nothing to save.
	await expect(section).toHaveCount(0)
	await page.goto("/search")
	await waitForHydration(page)
	await expect(saveButton).toHaveCount(0)

	// A query gets a name, which starts as the query.
	await page.goto("/search?q=quokka")
	await waitForHydration(page)
	await saveButton.click()
	await expect(name).toBeFocused()
	await expect(name).toHaveValue("quokka")
	await name.fill("  Marsupials ")
	await page.keyboard.press("Enter")
	await expect(dialog).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Saved as “Marsupials”" })).toBeVisible()
	await expect(saveButton).toHaveCount(0)
	await expect(section.getByRole("heading", { name: "Saved searches" })).toBeVisible()
	await expect(rows).toHaveText(["Marsupials"])
	await expect(rows).toHaveAttribute("aria-current", "page")

	// The command menu saves too. A name is taken whatever its case.
	await page.goto(`/search?q=${encodeURIComponent("is:unread")}`)
	await waitForHydration(page)
	await expect(rows).not.toHaveAttribute("aria-current", "page")
	await page.keyboard.press("ControlOrMeta+k")
	const palette = page.getByPlaceholder("Search or type a command…")
	await palette.fill("save this")
	await expect(page.getByRole("option", { name: "Save this search" })).toHaveAttribute(
		"aria-selected",
		"true",
	)
	await page.keyboard.press("Enter")
	await expect(name).toBeFocused()
	await name.fill("MARSUPIALS")
	await page.keyboard.press("Enter")
	await expect(dialog.getByText("Another saved search has that name.")).toBeVisible()
	await name.fill("Unread")
	await page.keyboard.press("Enter")
	await expect(dialog).toHaveCount(0)
	await expect(rows).toHaveText(["Marsupials", "Unread"])

	// From anywhere, a row opens its query; so does the command menu.
	await page.goto("/archive")
	await waitForHydration(page)
	await rows.filter({ hasText: "Marsupials" }).click()
	await expect(page).toHaveURL(/\/search\?q=quokka$/)
	await expect(page.getByRole("link", { name: OLDER })).toBeVisible()
	await expect(page.getByRole("link", { name: NEWER })).toBeVisible()
	await page.keyboard.press("ControlOrMeta+k")
	await palette.fill("unrea")
	await expect(page.getByRole("option", { name: "Unread", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	)
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/search\?q=is%3Aunread$/)

	// A saved `tag:` is a pinned tag: its name starts as the tag's. Renaming the tag rewrites the
	// query, so the row still finds the articles; the row's own name is the user's, and stays.
	await page.goto(`/search?q=${encodeURIComponent("tag:later")}`)
	await waitForHydration(page)
	await saveButton.click()
	await expect(name).toHaveValue("later")
	await page.keyboard.press("Enter")
	await expect(rows).toHaveText(["later", "Marsupials", "Unread"])
	await page.goto("/tags")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Rename the tag later" }).click()
	await page.getByRole("textbox", { name: "Name of the tag later" }).fill("read soon")
	await page.keyboard.press("Enter")
	await expect(page.getByTestId("tags-list").getByRole("link", { name: "read soon" })).toBeVisible()
	await rows.filter({ hasText: "later" }).click()
	await expect(page).toHaveURL(/\/search\?q=tag%3A%22read%20soon%22$/)
	await expect(page.getByRole("link", { name: NEWER })).toBeVisible()
	await expect(page.getByRole("link", { name: OLDER })).toHaveCount(0)
	await expect(rows.filter({ hasText: "later" })).toHaveAttribute("aria-current", "page")

	// Rename, from the row's menu.
	await rows.filter({ hasText: "later" }).hover()
	await section.getByRole("button", { name: "More for “later”" }).click()
	await page.getByRole("menuitem", { name: "Rename" }).click()
	await expect(name).toHaveValue("later")
	await name.fill("Pinned")
	await page.keyboard.press("Enter")
	await expect(dialog).toHaveCount(0)
	await expect(rows).toHaveText(["Marsupials", "Pinned", "Unread"])
	await expect(page.getByRole("button", { name: "Saved as “Pinned”" })).toBeVisible()

	// Delete, from a right-click: no question asked, the toast puts it back.
	await rows.filter({ hasText: "Unread" }).click({ button: "right" })
	await page.getByRole("menuitem", { name: "Delete" }).click()
	await expect(rows).toHaveText(["Marsupials", "Pinned"])
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(rows).toHaveText(["Marsupials", "Pinned", "Unread"])

	// The Saved button of the search page has the same menu.
	await page.getByRole("button", { name: "Saved as “Pinned”" }).click()
	await page.getByRole("menuitem", { name: "Delete" }).click()
	await expect(saveButton).toBeVisible()
	await expect(rows).toHaveText(["Marsupials", "Unread"])
	for (const row of ["Marsupials", "Unread"]) {
		await rows.filter({ hasText: row }).click({ button: "right" })
		await page.getByRole("menuitem", { name: "Delete" }).click()
		await expect(rows.filter({ hasText: row })).toHaveCount(0)
	}
	await expect(section).toHaveCount(0)
})

test("saved searches: the rail lists them in a menu, the phone drawer as rows", async ({
	page,
}) => {
	await signupUser(page, "Pocket")
	const create = (name: string, query: string) =>
		page.request.post("/saved-searches", { form: { intent: "create", name, query } })
	expect((await create("Long reads", "sort:longest")).ok()).toBe(true)
	await page.goto("/library")
	await waitForHydration(page)
	const section = page.locator("aside").getByTestId("saved-searches")
	await expect(section.getByRole("link")).toHaveText(["Long reads"])

	// The rail has no room for names: one button opens them as a menu.
	await page.getByRole("button", { name: "Collapse sidebar" }).click()
	await expect(section).toHaveCount(0)
	await expect.poll(async () => (await page.locator("aside").boundingBox())?.width).toBe(64)
	const button = page.locator("aside").getByRole("button", { name: "Saved searches" })
	const box = await button.boundingBox()
	expect(box?.width).toBe(box?.height)
	await button.hover()
	await expect(page.getByTestId("tooltip")).toHaveText("Saved searches")
	await button.click()
	const menu = page.getByRole("menu")
	await expect(menu.getByRole("menuitem")).toHaveText(["Long reads"])
	await menu.getByRole("menuitem", { name: "Long reads" }).click()
	await expect(page).toHaveURL(/\/search\?q=sort%3Alongest$/)
	await expect(menu).toHaveCount(0)
	// On that search, the button and the entry show it.
	await expect(button).toHaveClass(/bg-selected/)
	await button.click()
	await expect(menu.getByRole("menuitem", { name: "Long reads" })).toHaveAttribute(
		"aria-current",
		"page",
	)
	await page.keyboard.press("Escape")
	await expect(menu).toHaveCount(0)

	// Many of them: the list scrolls inside the menu, which stays open.
	for (let i = 1; i <= 15; i++) expect((await create(`Topic ${i}`, `topic${i}`)).ok()).toBe(true)
	await page.reload()
	await waitForHydration(page)
	await button.click()
	await expect(menu.getByRole("menuitem")).toHaveCount(16)
	const list = menu.locator(".overflow-y-auto")
	await list.hover()
	await page.mouse.wheel(0, 400)
	await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
	await expect(menu).toBeVisible()
	// Beside the rail, not over its icons, and all in the window.
	const menuBox = (await menu.boundingBox())!
	const buttonBox = (await button.boundingBox())!
	expect(menuBox.x).toBeGreaterThan(buttonBox.x + buttonBox.width)
	expect(menuBox.y).toBeGreaterThanOrEqual(0)
	expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(page.viewportSize()!.height)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/rail-saved-searches.png` })
	await page.keyboard.press("Escape")

	await page.getByRole("button", { name: "Expand sidebar" }).click()
	await expect(section).toBeVisible()

	// A phone's library has the drawer (the search page's bar has Back instead).
	await page.goto("/library")
	await waitForHydration(page)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.getByRole("button", { name: "Menu" }).click()
	const drawer = page.getByRole("dialog", { name: "Menu" })
	await drawer.getByTestId("saved-searches").getByRole("link", { name: "Long reads" }).click()
	await expect(page).toHaveURL(/\/search\?q=sort%3Alongest$/)
	// Phones save from the chips row: the button is an icon there.
	await page.goto("/search?q=quokka")
	await waitForHydration(page)
	await expect(page.getByRole("button", { name: "Save search" })).toBeVisible()
})
