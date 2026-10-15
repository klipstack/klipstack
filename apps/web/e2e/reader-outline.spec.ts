import { db, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const para = (n: number) =>
	`<p>${"A sentence that fills the page with reading. ".repeat(40)} (${n})</p>`

// Two levels (h3 under h2, an h4 skipping one), and a heading in a list that is not a section.
const SECTIONED = [
	"<h2>Beginnings</h2>",
	para(1),
	"<h3>Small steps</h3>",
	para(2),
	"<ul><li><h3>Listed book</h3></li></ul>",
	"<h2>Middles</h2>",
	para(3),
	"<h4>A deep one</h4>",
	para(4),
	"<h2>Endings</h2>",
	para(5),
	para(6),
].join("")

async function open(page: Page, html: string, width: number) {
	await page.setViewportSize({ width, height: 900 })
	const email = await signupUser(page, "Outliner")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(owner!.id, "Sectioned", html)
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
}

test("outline: docked beside the article on a wide window, kept hidden when turned off", async ({
	page,
}) => {
	await open(page, SECTIONED, 1280)
	const outline = page.getByRole("navigation", { name: "Contents" })
	await expect(outline).toBeVisible()
	await expect(outline).toHaveAttribute("data-docked", "true")
	await expect(outline.getByRole("button")).toHaveText([
		"Beginnings",
		"Small steps",
		"Middles",
		"A deep one",
		"Endings",
	])

	await outline.getByRole("button", { name: "Endings" }).click()
	const heading = page.locator(".reader-content h2", { hasText: "Endings" })
	await expect(heading).toBeInViewport()
	await expect(outline.getByRole("button", { name: "Endings" })).toHaveAttribute(
		"aria-current",
		"location",
	)

	// Turned off, it stays off on the next article (a preference).
	const saved = page.waitForResponse(
		(r) => r.url().includes("/prefs") && r.request().method() === "POST" && r.ok(),
	)
	await page.getByRole("button", { name: "Hide contents" }).click()
	await saved
	await expect(outline).toBeHidden()
	await page.reload()
	await waitForHydration(page)
	await expect(outline).toBeHidden()
	await page.getByRole("button", { name: "Show contents" }).click()
	await expect(outline).toHaveAttribute("data-docked", "true")
})

test("outline: slides in from the button on a narrower window, and goes again", async ({
	page,
}) => {
	await open(page, SECTIONED, 1000)
	const outline = page.getByRole("navigation", { name: "Contents" })
	await expect(outline).toBeHidden()

	const toggle = page.getByTestId("toggle-outline")
	await toggle.click()
	await expect(outline).toBeVisible()
	await expect(outline).not.toHaveAttribute("data-docked")
	await page.keyboard.press("Escape")
	await expect(outline).toBeHidden()

	// Picking a heading goes there and puts the outline away.
	await toggle.click()
	await outline.getByRole("button", { name: "Middles" }).click()
	await expect(outline).toBeHidden()
	await expect(page.locator(".reader-content h2", { hasText: "Middles" })).toBeInViewport()

	// The button closes it too.
	await toggle.click()
	await expect(outline).toBeVisible()
	await toggle.click()
	await expect(outline).toBeHidden()
})

test("outline: none for an article with fewer than three headings", async ({ page }) => {
	await open(page, `<h2>One</h2>${para(1)}<h2>Two</h2>${para(2)}`, 1700)
	await expect(page.locator(".reader-content h2").first()).toBeVisible()
	await expect(page.getByRole("navigation", { name: "Contents" })).toHaveCount(0)
	await expect(page.getByTestId("toggle-outline")).toHaveCount(0)
})
