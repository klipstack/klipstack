import { db, eq, user } from "@klipstack/db"
import { expect, type Locator, type Page, test } from "@playwright/test"
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

/** Signs up, saves each article, and opens the first. The articles' ids. */
async function open(page: Page, html: string | string[], width: number) {
	await page.setViewportSize({ width, height: 900 })
	const email = await signupUser(page, "Outliner")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const ids = []
	for (const one of [html].flat()) ids.push(await insertArticle(owner!.id, "Sectioned", one))
	await page.goto(`/read/${ids[0]}`)
	await waitForHydration(page)
	return ids
}

/** Where an entry's text starts: lower headings are indented under higher ones. */
const indent = async (outline: Locator, name: string) =>
	(await outline.getByRole("button", { name }).locator("span").boundingBox())!.x

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
	// Two levels: the article's highest headings, and every lower one (h3 or h4) under them.
	const top = await indent(outline, "Beginnings")
	expect(await indent(outline, "Small steps")).toBeGreaterThan(top)
	expect(await indent(outline, "A deep one")).toBe(await indent(outline, "Small steps"))
	expect(await indent(outline, "Endings")).toBe(top)

	const heading = page.locator(".reader-content h2", { hasText: "Endings" })
	await expect(heading).not.toBeInViewport()
	await outline.getByRole("button", { name: "Endings" }).click()
	await expect(heading).toBeInViewport()
	await expect(outline.getByRole("button", { name: "Endings" })).toHaveAttribute(
		"aria-current",
		"location",
	)

	// Turned off, it stays off on the next article (a preference).
	const saved = page.waitForResponse(
		(r) => r.url().includes("/prefs") && r.request().method() === "POST" && r.ok(),
	)
	const toggle = page.getByRole("button", { name: "Contents" })
	await expect(toggle).toHaveAttribute("aria-expanded", "true")
	await toggle.click()
	await saved
	await expect(outline).toBeHidden()
	await page.reload()
	await waitForHydration(page)
	await expect(outline).toBeHidden()
	await expect(toggle).toHaveAttribute("aria-expanded", "false")
	await toggle.click()
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
	const middles = page.locator(".reader-content h2", { hasText: "Middles" })
	await expect(middles).not.toBeInViewport()
	await toggle.click()
	await outline.getByRole("button", { name: "Middles" }).click()
	await expect(outline).toBeHidden()
	await expect(middles).toBeInViewport()

	// With a mouse: resting at the window's left edge slides it in; leaving it puts it away.
	await page.mouse.move(400, 450)
	await page.mouse.move(1, 450)
	// All the way in: a pointer that leaves while it slides never enters it, so never leaves it.
	await expect(outline).toBeInViewport({ ratio: 1 })
	await page.mouse.move(600, 450, { steps: 10 })
	await expect(outline).toBeHidden()
	// A press anywhere else puts it away too.
	await page.mouse.move(1, 450)
	await expect(outline).toBeVisible()
	await page.mouse.click(700, 600)
	await expect(outline).toBeHidden()

	// From the keyboard: the button takes it into the outline, Escape back to the button, and a
	// heading picked takes it to the heading.
	await toggle.focus()
	await page.keyboard.press("Enter")
	await expect(outline).toBeVisible()
	await expect(toggle).toHaveAttribute("aria-expanded", "true")
	await expect(outline.getByRole("button", { name: "Middles" })).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(outline).toBeHidden()
	await expect(toggle).toBeFocused()
	await page.keyboard.press("Enter")
	await outline.getByRole("button", { name: "Endings" }).focus()
	await page.keyboard.press("Enter")
	await expect(outline).toBeHidden()
	await expect(page.locator(".reader-content h2", { hasText: "Endings" })).toBeFocused()

	// The button closes it too.
	await toggle.click()
	await expect(outline).toBeVisible()
	await toggle.click()
	await expect(outline).toBeHidden()
})

test("outline: three headings make one, two don't", async ({ page }) => {
	const three = ["One", "Two", "Three"].map((h, i) => `<h2>${h}</h2>${para(i)}`).join("")
	const two = ["One", "Two"].map((h, i) => `<h2>${h}</h2>${para(i)}`).join("")
	const [, twoId] = await open(page, [three, two], 1700)
	const outline = page.getByRole("navigation", { name: "Contents" })
	await expect(outline.getByRole("button")).toHaveCount(3)
	await expect(page.getByTestId("toggle-outline")).toBeVisible()

	await page.goto(`/read/${twoId}`)
	await waitForHydration(page)
	await expect(page.locator(".reader-content h2").first()).toBeVisible()
	await expect(outline).toHaveCount(0)
	await expect(page.getByTestId("toggle-outline")).toHaveCount(0)
})
