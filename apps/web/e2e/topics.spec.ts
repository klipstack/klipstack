import { db, documents, eq, inArray, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

/**
 * Automatic topics, end to end with the worker and the fake models (AI_FAKE): the fake proposes a
 * topic for each site several articles share, and sorts an article into a topic whose name it
 * holds.
 */
async function library(email: string, sites: Record<string, number>) {
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	for (const [site, count] of Object.entries(sites)) {
		const ids: string[] = []
		for (let i = 0; i < count; i++)
			ids.push(await insertArticle(owner!.id, `${site} essay ${i + 1}`, `<p>${site}</p>`))
		await db.update(documents).set({ siteName: site }).where(inArray(documents.id, ids))
	}
}

test("topics: turned on, proposed, confirmed, sorted, corrected and turned off", async ({
	page,
}) => {
	test.setTimeout(180_000)
	const email = await signupUser(page, "Topic Reader", { features: ["topics"] })
	await library(email, { Psyche: 18, Aeon: 12 })

	await page.goto("/topics")
	await expect(page.getByTestId("topics-off")).toContainText("TypeSafe and to Anthropic")
	await page.getByRole("button", { name: "Turn on topics" }).click()
	await expect(page.getByTestId("topics-proposing")).toBeVisible()

	// The worker proposes one topic per site; Home and the sidebar say so until the page is opened.
	// Home says it when loaded after the proposal: the test comes back until then.
	await expect(async () => {
		await page.goto("/home")
		await expect(page.getByTestId("home-topics")).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 60_000 })
	await expect(page.getByTestId("topics-nav-dot").first()).toBeVisible()
	await page.getByRole("link", { name: "See your topics" }).click()
	await expect(page.getByLabel("Keep Psyche")).toBeChecked()
	await page.getByLabel("Keep Aeon").uncheck()
	// Left out: its card dims, and its name can't be edited.
	const aeon = page.getByTestId("proposed-topic").filter({ has: page.getByLabel("Keep Aeon") })
	await expect(aeon).toHaveAttribute("data-kept", "false")
	await expect(aeon).toHaveCSS("opacity", "0.5")
	await expect(page.getByLabel("Name of the topic Aeon")).toBeDisabled()
	await page.getByRole("button", { name: "Confirm topics" }).click()

	// The library is sorted into the topic kept, as a shelf. Aeon's articles fit none, and growing
	// new topics never brings Aeon back: the reader removed it.
	const shelves = page.getByTestId("topics-shelves")
	await expect(shelves).toContainText("18 articles", { timeout: 60_000 })
	await expect(page.getByTestId("topics-sorting")).toHaveCount(0, { timeout: 60_000 })
	await expect(shelves).not.toContainText("Aeon")
	await expect(page.getByTestId("topics-nav-dot")).toHaveCount(0)
	// A full shelf: the newest 15 articles as books, each opening its article, then "+3" for the rest.
	await page.reload()
	const books = page.getByRole("list", { name: "Articles in Psyche" })
	await expect(books.getByRole("link", { name: /^Psyche essay \d+, Psyche$/ })).toHaveCount(15)
	await expect(books.getByRole("link", { name: "See all 18 articles in Psyche" })).toHaveText("+3")

	await page.getByRole("button", { name: "More for Psyche" }).click()
	await page.getByRole("menuitem", { name: "Rename" }).click()
	await page.getByLabel("Name of the topic Psyche").fill("Minds")
	await page.getByRole("button", { name: "Rename", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Minds" })).toBeVisible()
	await page.getByRole("link", { name: "See all 18 articles in Minds" }).click()
	await expect(page.getByTestId("topic-name")).toHaveText("Minds")
	await expect(page.getByTestId("topic-articles").getByRole("listitem")).toHaveCount(18)
	await page.getByRole("button", { name: "Take Psyche essay 1 out of this topic" }).click()
	await expect(page.getByText("Taken out of Minds. It won't be put back.")).toBeVisible()
	await page.reload()
	await expect(page.getByTestId("topic-articles").getByRole("listitem")).toHaveCount(17)

	// On a phone a shelf holds 11 books and "+6", and a book is too narrow to aim at: the shelf
	// opens the topic.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto("/topics")
	const shelf = page.getByRole("list", { name: "Articles in Minds" })
	await expect(shelf.getByRole("link").filter({ visible: true })).toHaveCount(12)
	await expect(shelf.getByRole("link", { name: "See all 17 articles in Minds" })).toHaveText("+6")
	const book = (await shelf.getByRole("link").first().boundingBox())!
	await page.mouse.click(book.x + book.width / 2, book.y + book.height / 2)
	await expect(page).toHaveURL(/\/topics\/[\w-]+$/)
	await page.setViewportSize({ width: 1280, height: 720 })

	// Removed from its own page, after a question: the reader is back on Topics, with none left.
	await page.getByRole("button", { name: "More for Minds" }).click()
	await page.getByRole("menuitem", { name: "Remove" }).click()
	await expect(page.getByText("Remove Minds? Its articles leave it")).toBeVisible()
	await page.getByRole("button", { name: "Remove", exact: true }).click()
	await expect(page).toHaveURL(/\/topics$/)
	await expect(page.getByText("Removed Minds. It won't be proposed again.")).toBeVisible()
	await expect(page.getByTestId("topics-empty")).toBeVisible()

	await page.goto("/topics")
	// The second tap is the page's script: it must be running first.
	await waitForHydration(page)
	await page.getByRole("button", { name: "Turn off topics" }).click()
	await page.getByRole("button", { name: "Tap again: this deletes your topics" }).click()
	await expect(page.getByTestId("topics-off")).toBeVisible()
})

test("topics: an account without the feature has no page and no link", async ({ page }) => {
	await signupUser(page, "No Topics")
	const res = await page.goto("/topics")
	expect(res?.status()).toBe(404)
	await page.goto("/home")
	await expect(page.getByRole("link", { name: "Topics", exact: true })).toHaveCount(0)
})
