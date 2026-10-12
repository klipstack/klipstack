import { db, documents, eq, inArray, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser } from "./helpers"
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
	await library(email, { Psyche: 13, Aeon: 12 })

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
	await page.getByRole("button", { name: "Confirm topics" }).click()

	// The library is sorted into the topic kept. Aeon's articles fit none, and growing new topics
	// never brings Aeon back: the reader removed it.
	const list = page.getByTestId("topics-list")
	await expect(list).toContainText("13 articles", { timeout: 60_000 })
	await expect(page.getByTestId("topics-sorting")).toHaveCount(0, { timeout: 60_000 })
	await expect(list).not.toContainText("Aeon")
	await expect(page.getByTestId("topics-nav-dot")).toHaveCount(0)

	await page.getByRole("button", { name: "Rename the topic Psyche" }).click()
	await page.getByLabel("Name of the topic Psyche").fill("Minds")
	await page.getByRole("button", { name: "Rename", exact: true }).click()
	await page.getByRole("link", { name: "Minds" }).click()
	await expect(page.getByTestId("topic-name")).toHaveText("Minds")
	await expect(page.getByTestId("topic-articles").getByRole("listitem")).toHaveCount(13)
	await page.getByRole("button", { name: "Take Psyche essay 1 out of this topic" }).click()
	await expect(page.getByText("Taken out of Minds. It won't be put back.")).toBeVisible()
	await page.reload()
	await expect(page.getByTestId("topic-articles").getByRole("listitem")).toHaveCount(12)

	await page.goto("/topics")
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
