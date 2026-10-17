import { db, documents, eq, inArray, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

/**
 * Automatic topics, end to end with the worker and the fake models (AI_FAKE): the fake proposes a
 * topic for each site several articles share, and sorts an article into a topic whose name it
 * holds. It writes each topic's description, which the reader sees, and a boundary sentence,
 * which only sorting reads.
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
	// The reader sees what a topic holds, never the sentence that sorting reads.
	const psyche = page.getByTestId("proposed-topic").filter({ has: page.getByLabel("Keep Psyche") })
	await expect(psyche).toContainText("Articles from Psyche.")
	await expect(page.getByTestId("topics-proposal")).not.toContainText("other sites")
	// Home may not have been running yet, and the page then loads anew: unchecking needs its script.
	await waitForHydration(page)
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
	await expect(shelves).not.toContainText("other sites")
	await expect(page.getByTestId("topics-nav-dot")).toHaveCount(0)
	// A full shelf: the newest 15 articles as books, each opening its article, then "+3" for the rest.
	// All 18 were saved today.
	await page.reload()
	await waitForHydration(page)
	await expect(shelves).toContainText("18 new")
	const books = page.getByRole("list", { name: "Articles in Psyche" })
	await expect(books.getByRole("link", { name: /^Psyche essay \d+, Psyche$/ })).toHaveCount(15)
	await expect(books.getByRole("link").first()).toHaveAttribute("href", /^\/read\/[\w-]+$/)
	await expect(books.getByRole("link", { name: "See all 18 articles in Psyche" })).toHaveText("+3")

	// Removing asks first, in place; Cancel keeps the topic.
	await page.getByRole("button", { name: "More for Psyche" }).click()
	await page.getByRole("menuitem", { name: "Remove" }).click()
	await expect(page.getByText("Remove Psyche? Its articles leave it")).toBeVisible()
	await page.getByRole("button", { name: "Cancel" }).click()
	await expect(page.getByText("Remove Psyche? Its articles leave it")).toHaveCount(0)
	await expect(books).toBeVisible()

	await page.getByRole("button", { name: "More for Psyche" }).click()
	await page.getByRole("menuitem", { name: "Rename" }).click()
	await page.getByLabel("Name of the topic Psyche").fill("Minds")
	await page.getByRole("button", { name: "Rename", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Minds" })).toBeVisible()
	await page.getByRole("link", { name: "See all 18 articles in Minds" }).click()
	await expect(page.getByTestId("topic-name")).toHaveText("Minds")
	await expect(page.getByText("Articles from Psyche.")).toBeVisible()
	await expect(page.locator("main")).not.toContainText("other sites")
	await expect(page.getByTestId("topic-articles").getByRole("listitem")).toHaveCount(18)
	// The library's cards, as a list or a grid, and the library's switch between them.
	const articles = page.getByTestId("topic-articles")
	await waitForHydration(page)
	const toggle = page.getByTestId("layout-toggle").filter({ visible: true })
	await toggle.click()
	await expect(articles.locator("ul")).toHaveAttribute("data-layout", "grid")
	await toggle.click()
	await expect(articles.locator("ul")).toHaveAttribute("data-layout", "list")
	// The keys move the cursor. With no selection bar here, select-all is the browser's again.
	await page.keyboard.press("j")
	await expect(articles.locator("[data-cursor]")).toHaveCount(1)
	await page.keyboard.press("ControlOrMeta+a")
	expect(await page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBeGreaterThan(
		0,
	)
	await page.evaluate(() => window.getSelection()?.removeAllRanges())
	// Taking an article out is in its card's menu.
	await articles
		.getByRole("listitem")
		.filter({ has: page.getByRole("link", { name: "Psyche essay 18", exact: true }) })
		.getByRole("button", { name: "More actions" })
		.click()
	// The toast shows before the request is sent: a reload right after it would cancel the request.
	const takenOut = page.waitForResponse(
		(r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/topics/"),
	)
	await page.getByRole("menuitem", { name: "Take out of this topic" }).click()
	await expect(page.getByText("Taken out of Minds. It won't be put back.")).toBeVisible()
	expect((await takenOut).ok()).toBe(true)
	await page.reload()
	await expect(page.getByTestId("topic-articles").getByRole("listitem")).toHaveCount(17)

	// The reader names the article's topic above its title, and ends with its unread articles.
	await page
		.getByTestId("topic-articles")
		.getByRole("link", { name: "Psyche essay 2", exact: true })
		.click()
	await expect(page.getByTestId("reader-topics")).toHaveText("Minds")
	// On a phone's screen, where the shelf takes the short article past one screen.
	await page.setViewportSize({ width: 390, height: 600 })
	await page.reload()
	const next = page.getByTestId("reader-shelf")
	await expect(next.getByRole("heading")).toHaveText("More in Minds")
	await expect(next).toContainText("16 unread · See all")
	await expect(next.getByRole("listitem")).toHaveCount(3)
	// The shelf comes after the article: with the article and its end in view, it is all read.
	await expect(page.getByTestId("reading-progress")).toHaveAttribute("style", /scaleX\(1\)/)
	await expect(next).not.toContainText("Psyche essay 2")
	await next.getByRole("listitem").first().getByRole("link").click()
	await expect(page).not.toHaveURL(/\/topics\//)
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Psyche essay")
	await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Psyche essay 2")
	await page.getByTestId("reader-topics").getByRole("link", { name: "Minds" }).click()
	await expect(page.getByTestId("topic-name")).toHaveText("Minds")
	await page.setViewportSize({ width: 1280, height: 720 })

	// On a phone a shelf holds 11 books and "+6", and a book is too narrow to aim at: the shelf
	// opens the topic.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto("/topics")
	await waitForHydration(page)
	const shelf = page.getByRole("list", { name: "Articles in Minds" })
	await expect(shelf.getByRole("link").filter({ visible: true })).toHaveCount(12)
	await expect(shelf.getByRole("link", { name: "See all 17 articles in Minds" })).toHaveText("+6")
	const book = (await shelf.getByRole("link").first().boundingBox())!
	await page.mouse.click(book.x + book.width / 2, book.y + book.height / 2)
	await expect(page).toHaveURL(/\/topics\/[\w-]+$/)
	await page.setViewportSize({ width: 1280, height: 720 })
	await waitForHydration(page)

	// Removed from its own page, after a question: the reader is back on Topics, with none left.
	await page.getByRole("button", { name: "More for Minds" }).click()
	await page.getByRole("menuitem", { name: "Remove" }).click()
	await expect(page.getByText("Remove Minds? Its articles leave it")).toBeVisible()
	await page.getByRole("button", { name: "Remove", exact: true }).click()
	await expect(page).toHaveURL(/\/topics$/)
	await expect(page.getByText("Removed Minds. It won't be proposed again.")).toBeVisible()
	await expect(page.getByTestId("topics-empty")).toBeVisible()
	// None left: an empty shelf is drawn above the words.
	await expect(
		page.getByTestId("topics-empty").locator("[data-empty-drawing=shelf] svg"),
	).toBeVisible()
	if (process.env.SHOT_DIR) {
		await page.screenshot({ path: `${process.env.SHOT_DIR}/topics-empty.png` })
		await page.emulateMedia({ colorScheme: "dark" })
		await page.screenshot({ path: `${process.env.SHOT_DIR}/topics-empty-dark.png` })
		await page.emulateMedia({ colorScheme: "light" })
	}

	await page.goto("/topics")
	// The second tap is the page's script: it must be running first.
	await waitForHydration(page)
	await page.getByRole("button", { name: "Turn off topics" }).click()
	await page.getByRole("button", { name: "Tap again: this deletes your topics" }).click()
	await expect(page.getByTestId("topics-off")).toBeVisible()
})

test("topics: a Spanish reader sees descriptions in Spanish, without the boundary", async ({
	page,
}) => {
	test.setTimeout(180_000)
	const email = await signupUser(page, "Lectora de temas", { features: ["topics"] })
	await db.update(user).set({ locale: "es" }).where(eq(user.email, email))
	await library(email, { Psyche: 13, Aeon: 12 })

	await page.goto("/topics")
	await page.getByRole("button", { name: "Activar los temas" }).click()
	const psyche = page
		.getByTestId("proposed-topic")
		.filter({ has: page.getByLabel("Conservar Psyche") })
	await expect(psyche).toContainText("Artículos de Psyche.", { timeout: 60_000 })
	await expect(page.getByTestId("topics-proposal")).not.toContainText("otros sitios")
	await page.getByRole("button", { name: "Confirmar los temas" }).click()

	const shelves = page.getByTestId("topics-shelves")
	await expect(shelves).toContainText("13 artículos", { timeout: 60_000 })
	await expect(shelves).not.toContainText("otros sitios")
	await shelves.getByRole("heading", { name: "Psyche" }).getByRole("link").click()
	await expect(page.getByTestId("topic-name")).toHaveText("Psyche")
	await expect(page.getByText("Artículos de Psyche.")).toBeVisible()
	await expect(page.locator("main")).not.toContainText("otros sitios")
})

test("topics: turned on and off in Settings → Features, off only on a second answer", async ({
	page,
}) => {
	await signupUser(page, "Topics Switch", { features: ["topics"] })
	await page.goto("/settings/features")
	await waitForHydration(page)
	const topicsSwitch = page.getByRole("checkbox", { name: "Sort my library into topics" })
	await expect(topicsSwitch).not.toBeChecked()
	// The switch follows the server's answer: clicked, not `check()`ed.
	await topicsSwitch.click()
	await expect(topicsSwitch).toBeChecked()
	await expect(page.getByRole("link", { name: "Open Topics" })).toBeVisible()

	// Turning them off deletes them: it asks first, and Keep them changes nothing.
	await topicsSwitch.click()
	await expect(topicsSwitch).toBeChecked()
	await page.getByRole("button", { name: "Keep them" }).click()
	await expect(page.getByRole("link", { name: "Open Topics" })).toBeVisible()
	await topicsSwitch.click()
	await page.getByRole("button", { name: "Turn off and delete" }).click()
	await expect(topicsSwitch).not.toBeChecked()
	expect((await page.goto("/topics"))?.status()).toBe(200)
	// Off: the Topics page offers them again.
	await expect(page.getByRole("button", { name: "Turn on topics" })).toBeVisible()
})

test("topics: an account without the feature has no page and no link", async ({ page }) => {
	await signupUser(page, "No Topics")
	const res = await page.goto("/topics")
	expect(res?.status()).toBe(404)
	await page.goto("/home")
	await expect(page.getByRole("link", { name: "Topics", exact: true })).toHaveCount(0)
})

test("topics: home invites a reader with topics off, once the library is big enough", async ({
	page,
}) => {
	const email = await signupUser(page, "Invited Reader", { features: ["topics"] })
	await library(email, { Psyche: 24 })
	const invitation = page.getByTestId("home-topics-invitation")
	await page.goto("/home")
	await expect(page.locator("#home-recent")).toBeVisible()
	await expect(invitation).toHaveCount(0)

	await library(email, { Aeon: 1 })
	// With reading times, Home offers to choose how long to read.
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	await db.update(documents).set({ readingMinutes: 10 }).where(eq(documents.userId, owner!.id))
	await page.goto("/home")
	await expect(invitation).toContainText("You've saved 25 articles")
	// Honest from the start: where the text goes, before the reader goes on.
	await expect(invitation).toContainText("article text is sent to TypeSafe and Anthropic")
	// The reader came to read: with a time chosen, no invitation.
	await page.getByTestId("home-time").getByRole("link", { name: "15 min" }).click()
	await expect(page).toHaveURL(/time=15/)
	await expect(invitation).toHaveCount(0)
	await page.goto("/home")
	await waitForHydration(page)
	const declined = page.waitForResponse(
		(res) => res.request().method() === "POST" && new URL(res.url()).pathname.startsWith("/topics"),
	)
	await invitation.getByRole("button", { name: "No thanks" }).click()
	await expect(invitation).toHaveCount(0)
	await declined
	// For good.
	await page.reload()
	await expect(page.locator("#home-recent")).toBeVisible()
	await expect(invitation).toHaveCount(0)
})

test("topics: opening the Topics page from home's invitation ends it", async ({ page }) => {
	const email = await signupUser(page, "Curious Reader", { features: ["topics"] })
	await library(email, { Psyche: 25 })
	await page.goto("/home")
	const invitation = page.getByTestId("home-topics-invitation")
	await waitForHydration(page)
	const ended = page.waitForResponse(
		(res) => res.request().method() === "POST" && new URL(res.url()).pathname.startsWith("/topics"),
	)
	await invitation.getByRole("link", { name: "See topics" }).click()
	await expect(page.getByTestId("topics-off")).toContainText("TypeSafe and to Anthropic")
	await ended
	await page.goto("/home")
	await expect(page.locator("#home-recent")).toBeVisible()
	await expect(invitation).toHaveCount(0)
})
