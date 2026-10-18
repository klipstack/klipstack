import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { createInviteCode, turnOnEditions, uniqueEmail, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const TITLE = "Maker's Schedule, Manager's Schedule"
const SECOND = "Second article"

const stateResponse = (page: import("@playwright/test").Page) =>
	page.waitForResponse((r) => r.url().includes("/state") && r.request().method() === "POST")

test("keyboard: j/k move the cursor, keys act on it, the reader answers the same keys", async ({
	page,
}) => {
	test.setTimeout(120_000)
	const code = await createInviteCode()
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Keys")
	const email = uniqueEmail("keys")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await turnOnEditions(email)

	// Two ready articles: the fixture, then the fixture again under another title and address.
	const html = readFileSync(FIXTURE, "utf8")
	await page.request.post("/api/documents", {
		data: { url: "https://paulgraham.com/makersschedule.html", html },
	})
	await page.request.post("/api/documents", {
		data: { url: "https://example.com/keyboard/second", html: html.replaceAll(TITLE, SECOND) },
	})
	await page.goto("/library")
	await waitForHydration(page)
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 60_000 })
	await expect(page.getByRole("link", { name: SECOND })).toBeVisible({ timeout: 60_000 })

	// newest first: j lands on the second article, j again on the first, k back
	const selected = page.locator("li[data-cursor]")
	await expect(selected).toHaveCount(0)
	await page.keyboard.press("j")
	await expect(selected).toContainText(SECOND)
	await page.keyboard.press("j")
	await expect(selected).toContainText(TITLE)
	await page.keyboard.press("k")
	await expect(selected).toContainText(SECOND)

	// s stars the article under the cursor
	await Promise.all([stateResponse(page), page.keyboard.press("s")])
	await expect(selected.getByRole("button", { name: "Unstar" })).toBeVisible()

	// n marks it for the next edition, and the card says so; n again takes the mark off
	await Promise.all([stateResponse(page), page.keyboard.press("n")])
	await expect(selected.getByTestId("card-shortlisted")).toHaveText("· Next edition")
	await Promise.all([stateResponse(page), page.keyboard.press("n")])
	await expect(selected.getByTestId("card-shortlisted")).toHaveCount(0)

	// Enter opens it; the reader takes the same keys (s again: unstar)
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/read\//)
	await expect(page.getByRole("heading", { level: 1, name: SECOND })).toBeVisible()
	await waitForHydration(page)
	await Promise.all([stateResponse(page), page.keyboard.press("s")])
	await expect(page.getByLabel("Star", { exact: true })).toBeVisible()

	// h shows and hides the notes and highlights sidebar, which takes focus
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await page.keyboard.press("h")
	await expect(sidebar).toBeVisible()
	await expect(sidebar).toBeFocused()
	await page.keyboard.press("h")
	await expect(sidebar).toHaveCount(0)
	await page.keyboard.press("h")
	await page.keyboard.press("Escape")
	await expect(sidebar).toHaveCount(0)

	// the command palette offers the article's actions, with their keys
	const palette = page.getByRole("dialog", { name: "Command palette" })
	await page.keyboard.press("ControlOrMeta+k")
	await expect(palette.locator("[cmdk-input]")).toBeFocused()
	await expect(palette.getByText("This article", { exact: true })).toBeVisible()
	await expect(
		palette.getByRole("option", { name: "Star", exact: true }).locator("kbd"),
	).toHaveText("S")
	await page.keyboard.type("star")
	await Promise.all([stateResponse(page), page.keyboard.press("Enter")])
	await expect(palette).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Unstar" })).toBeVisible()

	// back: the cursor sits on the article we came from
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(selected).toContainText(SECOND)

	// the palette acts on the card under the cursor, and navigates
	await page.keyboard.press("ControlOrMeta+k")
	await expect(palette.getByText("Selected article")).toBeVisible()
	await page.keyboard.type("unstar")
	await Promise.all([stateResponse(page), page.keyboard.press("Enter")])
	await expect(selected.getByRole("button", { name: "Star", exact: true })).toBeVisible()
	await page.keyboard.press("ControlOrMeta+k")
	await page.keyboard.type("trash")
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/trash$/)
	await page.goto("/library")
	await waitForHydration(page)
	await page.keyboard.press("j")
	await expect(selected).toContainText(SECOND)

	// e archives it and the cursor moves on to the next article
	await Promise.all([stateResponse(page), page.keyboard.press("e")])
	await expect(page.getByRole("status").filter({ hasText: "Archived" })).toBeVisible()
	await expect(selected).toContainText(TITLE)

	// # deletes, with undo offered
	await Promise.all([stateResponse(page), page.keyboard.press("#")])
	await expect(page.getByRole("status").filter({ hasText: "Deleted" })).toBeVisible()
	await expect(page.getByRole("link", { name: TITLE })).toHaveCount(0)
	await expect(selected).toHaveCount(0)

	// an old search URL lands on the search page; keys typed into its field are just text
	await page.goto("/archive?q=second")
	await expect(page).toHaveURL(/\/search\?q=second$/)
	await waitForHydration(page)
	await expect(page.getByRole("link", { name: SECOND })).toBeVisible()
	const field = page.getByRole("main").getByRole("searchbox")
	await field.fill("")
	await page.keyboard.type("jk")
	await expect(selected).toHaveCount(0)
	await expect(field).toHaveValue("jk")
	// out of the field, the same keys move the cursor over the results, and "/" goes back to it
	await field.fill("second")
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/search\?q=second$/)
	await expect(field).not.toBeFocused()
	await page.keyboard.press("j")
	await expect(selected).toContainText(SECOND)
	await page.keyboard.press("/")
	await expect(field).toBeFocused()
	await expect(field).toHaveValue("second")
	// Escape in the emptied field leaves the search
	await field.fill("")
	await page.keyboard.press("Escape")
	await expect(page).toHaveURL(/\/library$/)
})
