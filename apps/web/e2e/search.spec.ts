import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { createInviteCode, sameOrigin, uniqueEmail, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const TITLE = "Maker's Schedule, Manager's Schedule"
const KEPT = "Kept wombat essay"
const FILED = "Filed wombat essay"
const BINNED = "Binned wombat essay"

async function save(page: Page, slug: string, title: string): Promise<string> {
	const html = readFileSync(FIXTURE, "utf8").replaceAll(TITLE, title)
	const res = await page.request.post("/api/documents", {
		data: { url: `https://example.com/search/${slug}`, html },
	})
	return ((await res.json()) as { article: { id: string } }).article.id
}

const setState = (page: Page, id: string, intent: string) =>
	page.request.post(`/documents/${id}/state`, { headers: sameOrigin(), form: { intent } })

test("search page: a view's button, chips, the trash apart, what was not understood, tips", async ({
	page,
}) => {
	test.setTimeout(120_000)
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Searcher")
	await page.getByLabel("Email").fill(uniqueEmail("search"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	// The move to Home must be over: a navigation started during it is interrupted.
	await waitForHydration(page)

	// One article in the inbox, one in the archive, one in the trash; "wombat" is in every title.
	await save(page, "kept", KEPT)
	const filed = await save(page, "filed", FILED)
	const binned = await save(page, "binned", BINNED)
	await page.goto("/library")
	for (const title of [KEPT, FILED, BINNED])
		await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 60_000 })
	expect((await setState(page, filed, "archive")).ok()).toBe(true)
	expect((await setState(page, binned, "delete")).ok()).toBe(true)

	// The archive's search button opens the search looking at the archive, ready for the words.
	await page.goto("/archive")
	await waitForHydration(page)
	await page.getByRole("main").getByRole("link", { name: "Search", exact: true }).click()
	await expect(page).toHaveURL(/\/search\?q=in%3Aarchive%20$/)
	const field = page.getByRole("main").getByRole("searchbox", { name: "Search" })
	await expect(field).toBeFocused()
	await expect(field).toHaveValue("in:archive ")
	await page.keyboard.type("wombat")
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/search\?q=in%3Aarchive\+wombat$/)
	await expect(page.getByRole("link", { name: FILED })).toBeVisible()
	await expect(page.getByRole("link", { name: KEPT })).toHaveCount(0)
	// A search that says where to look does not show the trash apart.
	await expect(page.getByTestId("search-trash")).toHaveCount(0)

	// The chip says so, and widens the search when clicked. The query is all the state there is.
	const archiveChip = page.getByTestId("search-chip-archive")
	await expect(archiveChip).toHaveAttribute("aria-current", "true")
	await archiveChip.click()
	await expect(page).toHaveURL(/\/search\?q=wombat$/)
	await expect(field).toHaveValue("wombat")
	await expect(archiveChip).not.toHaveAttribute("aria-current")
	await expect(page.getByRole("link", { name: FILED })).toBeVisible()
	await expect(page.getByRole("link", { name: KEPT })).toBeVisible()

	// Now the trash shows apart, under the results, and an article comes back from there.
	const trash = page.getByTestId("search-trash")
	await expect(trash.getByRole("heading", { name: "In the trash" })).toBeVisible()
	await expect(trash).toContainText(BINNED)
	await expect(page.getByRole("link", { name: BINNED })).toHaveCount(0)
	await trash.getByRole("button", { name: "Restore" }).click()
	await expect(trash).toHaveCount(0)
	await expect(page.getByRole("link", { name: BINNED })).toBeVisible()

	// A place replaces the place; other chips add up.
	await page.getByTestId("search-chip-library").click()
	await expect(page).toHaveURL(/\/search\?q=wombat%20in%3Alibrary$/)
	await expect(page.getByRole("link", { name: FILED })).toHaveCount(0)
	await page.getByTestId("search-chip-archive").click()
	await expect(page).toHaveURL(/\/search\?q=wombat%20in%3Aarchive$/)
	await page.getByTestId("search-chip-starred").click()
	await expect(page).toHaveURL(/\/search\?q=wombat%20in%3Aarchive%20is%3Astarred$/)
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()
	await page.getByRole("link", { name: "Search everywhere" }).click()
	await expect(page).toHaveURL(/\/search\?q=wombat$/)
	await expect(page.getByRole("link", { name: FILED })).toBeVisible()

	// Escape in the emptied field goes back to where the search was opened, searches later.
	await field.fill("")
	await field.press("Escape")
	await expect(page).toHaveURL(/\/archive$/)

	// An operator that was not understood is said, and filters nothing.
	await page.goto("/search?q=wombat+is%3Aunred")
	await waitForHydration(page)
	await expect(page.getByTestId("search-ignored")).toContainText("Ignored: is:unred.")
	await expect(page.getByRole("link", { name: KEPT })).toBeVisible()

	// Its link leads to the tips, where every example runs.
	await page.getByRole("link", { name: "See search tips" }).click()
	await expect(page).toHaveURL(/\/search$/)
	const tips = page.getByTestId("search-tips")
	await expect(tips.getByRole("heading", { name: "Search tips" })).toBeVisible()
	await tips.getByRole("link", { name: "in:archive", exact: true }).click()
	await expect(page).toHaveURL(/\/search\?q=in%3Aarchive$/)
	await expect(page.getByRole("link", { name: FILED })).toBeVisible()
	await expect(page.getByRole("link", { name: KEPT })).toHaveCount(0)
})

test("search field: completes keys and values, and Enter still searches", async ({ page }) => {
	test.setTimeout(120_000)
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Completer")
	await page.getByLabel("Email").fill(uniqueEmail("complete"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	// The move to Home must be over: a navigation started during it is interrupted.
	await waitForHydration(page)
	await save(page, "kept", KEPT)
	await page.goto("/library")
	await expect(page.getByRole("link", { name: KEPT })).toBeVisible({ timeout: 60_000 })

	await page.goto("/search")
	await waitForHydration(page)
	const main = page.getByRole("main")
	const field = main.getByRole("searchbox", { name: "Search" })
	const options = main.getByTestId("search-suggestion")
	const paint = main.getByTestId("search-field-paint")
	await expect(field).toBeFocused()

	// A value: the arrows go into the list, Enter takes the row and does not search.
	await page.keyboard.type("wombat is:un")
	await expect(options).toHaveText(["is:unread"])
	// Still being typed: not a mistake yet.
	await expect(paint.locator("[data-kind=ignored]")).toHaveCount(0)
	await page.keyboard.press("ArrowDown")
	await expect(options.first()).toHaveAttribute("aria-selected", "true")
	await page.keyboard.press("Enter")
	await expect(field).toHaveValue("wombat is:unread ")
	await expect(options).toHaveCount(0)
	await expect(page).toHaveURL(/\/search$/)
	await expect(paint.locator("[data-kind=operator]")).toHaveText(["is:unread"])

	// A key: Tab takes the first row, and the list goes on with the library's own values.
	await page.keyboard.type("si")
	await expect(options).toHaveText(["site:Part of the site's name or address."])
	await page.keyboard.press("Tab")
	await expect(field).toHaveValue("wombat is:unread site:")
	await expect(field).toBeFocused()
	await expect(options).toHaveText(["site:example.com"])
	await options.first().click()
	await expect(field).toHaveValue("wombat is:unread site:example.com ")
	await expect(field).toBeFocused()

	// Escape closes the list and leaves the text; with the list open and no row chosen, Enter searches.
	await page.keyboard.type("in:arch")
	await expect(options).toHaveText(["in:archive"])
	await page.keyboard.press("Escape")
	await expect(options).toHaveCount(0)
	await expect(field).toHaveValue("wombat is:unread site:example.com in:arch")
	await page.keyboard.press("Backspace")
	await expect(options).toHaveText(["in:archive"])
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/search\?q=wombat\+is%3Aunread\+site%3Aexample\.com\+in%3Aarc$/)
	await expect(page.getByTestId("search-ignored")).toContainText("Ignored: in:arc.")
	await expect(page.getByRole("link", { name: KEPT })).toBeVisible()
	// Searched, the unfinished operator is a mistake, and is marked as one.
	await expect(paint.locator("[data-kind=ignored]")).toHaveText(["in:arc"])
	await expect(paint.locator("[data-kind=operator]")).toHaveText(["is:unread", "site:example.com"])

	// Dates say what they mean.
	await field.fill("saved:")
	await expect(options.first()).toHaveText("saved:7dLast 7 days")
	await expect(options).toHaveCount(5)
})
