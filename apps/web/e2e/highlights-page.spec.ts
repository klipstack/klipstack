import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createInviteCode, uniqueEmail, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
const TITLE = "Maker's Schedule, Manager's Schedule"

test("highlights page: filters, word search, stream and by article", async ({ page }) => {
	test.setTimeout(90_000)
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Marker")
	await page.getByLabel("Email").fill(uniqueEmail("hlpage"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto("/library")
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 60_000 })

	// highlights made through the API, like the extension or an agent would
	for (const h of [
		{ exact: "each day cut into one hour intervals", color: 0 },
		{ exact: "units of half a day at least", color: 1, note: "Why I block mornings." },
		{ exact: "Each type of schedule works fine by itself", color: 1 },
	]) {
		const created = await page.request.post(`/documents/${id}/highlights`, {
			data: { intent: "create", ...h },
		})
		expect(created.status()).toBe(201)
	}

	await page.goto("/highlights")
	await waitForHydration(page)
	const cards = page.locator("main li")
	const filters = page.getByRole("navigation", { name: "Show" })
	await expect(cards).toHaveCount(3)
	// by article first: the article once, its highlights in reading order below it
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible()
	await expect(page.getByText("3 highlights")).toBeVisible()
	await expect(cards.first()).toContainText("one hour intervals")
	// one color on the web: no color chips, only All and With notes
	await expect(filters.getByRole("link")).toHaveText(["All", "With notes1"])

	await filters.getByRole("link", { name: "With notes 1" }).click()
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Why I block mornings.")

	// the stream keeps the filter and names the article on every card
	await page.getByRole("link", { name: "Stream" }).click()
	await expect(page).toHaveURL(/show=notes&view=stream/)
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toHaveCount(0)
	await expect(cards).toHaveCount(1)
	await expect(cards.first()).toContainText(TITLE)

	// the choice sticks: plain /highlights (the sidebar link) opens the stream now
	await page.getByRole("complementary").getByRole("link", { name: "Highlights" }).click()
	await expect(page).toHaveURL(/\/highlights$/)
	await expect(cards).toHaveCount(3)
	await expect(page.getByRole("link", { name: "Stream" })).toHaveAttribute("aria-current", "true")
	await page.reload()
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toHaveCount(0)
	await expect(cards.first()).toContainText(TITLE)

	// every word has to match somewhere: quote, note or the article's title
	await page.goto("/highlights?q=manager+intervals")
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("one hour intervals")
	await page.goto("/highlights?q=mornings")
	await expect(cards).toHaveCount(1)
	// a quoted phrase matches as a whole, not word by word
	await page.goto(`/highlights?q=${encodeURIComponent('"half a day"')}`)
	await expect(cards).toHaveCount(1)
	await page.goto(`/highlights?q=${encodeURIComponent('"day a half"')}`)
	await expect(page.getByText("No highlights match that search.")).toBeVisible()
	// accents never matter; words find their variants, phrases do not
	await page.goto(`/highlights?q=${encodeURIComponent("MÓRNINGS")}`)
	await expect(cards).toHaveCount(1)
	await page.goto("/highlights?q=blocked")
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Why I block mornings.")
	await page.goto(`/highlights?q=${encodeURIComponent('"blocked mornings"')}`)
	await expect(page.getByText("No highlights match that search.")).toBeVisible()
	await page.goto("/highlights?q=intervals+zebra")
	await expect(page.getByText("No highlights match that search.")).toBeVisible()

	// no highlight with a note in the results: no notes chip
	await page.goto("/highlights?q=hour+intervals")
	await expect(cards).toHaveCount(1)
	await expect(filters.getByRole("link")).toHaveText(["All"])
})
