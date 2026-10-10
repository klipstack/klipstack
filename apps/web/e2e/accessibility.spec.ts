import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const TITLE = "Maker's Schedule, Manager's Schedule"

const stateResponse = (page: Page) =>
	page.waitForResponse((r) => r.url().includes("/state") && r.request().method() === "POST")

async function libraryWithArticle(page: Page) {
	await signupUser(page, "Access")
	await page.request.post("/api/documents", {
		data: {
			url: "https://paulgraham.com/makersschedule.html",
			html: readFileSync(FIXTURE, "utf8"),
		},
	})
	await page.goto("/library")
	await waitForHydration(page)
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 60_000 })
}

test("a … menu works from the keyboard and gives the focus back", async ({ page }) => {
	await libraryWithArticle(page)
	const button = page.getByRole("button", { name: /^Sort/ })
	const menu = page.getByRole("menu")
	await button.focus()
	await page.keyboard.press("Enter")
	const items = menu.getByRole("menuitem")
	await expect(items.first()).toBeFocused()
	await page.keyboard.press("ArrowDown")
	await expect(items.nth(1)).toBeFocused()
	await page.keyboard.press("End")
	await expect(items.last()).toBeFocused()
	await page.keyboard.press("ArrowDown")
	await expect(items.first()).toBeFocused()
	// Tab leaves the menu, back to its button, not to the end of the page.
	await page.keyboard.press("Tab")
	await expect(menu).toHaveCount(0)
	await expect(button).toBeFocused()
	// ArrowUp on the button opens it at the last item; Escape closes it.
	await page.keyboard.press("ArrowUp")
	await expect(items.last()).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(menu).toHaveCount(0)
	await expect(button).toBeFocused()
})

test("an undo toast waits while it has the pointer, and ⌘Z / Ctrl+Z presses its Undo", async ({
	page,
}) => {
	await libraryWithArticle(page)
	await page.clock.install()
	const toast = page.getByRole("status").filter({ hasText: "Archived" })
	const archive = async () => {
		await page.keyboard.press("j")
		await Promise.all([stateResponse(page), page.keyboard.press("e")])
		await expect(toast).toBeVisible()
		await expect(page.getByRole("link", { name: TITLE })).toHaveCount(0)
	}

	// Past its six seconds, a toast under the pointer stays; ⌘Z / Ctrl+Z undoes from the page.
	await archive()
	await toast.hover()
	await page.clock.runFor(20_000)
	await expect(toast).toBeVisible()
	await page.mouse.move(0, 0)
	await Promise.all([stateResponse(page), page.keyboard.press("ControlOrMeta+z")])
	await expect(toast).toHaveCount(0)
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible()

	// Left alone, it goes.
	await archive()
	await page.clock.runFor(7_000)
	await expect(toast).toHaveCount(0)
})

test("single-key shortcuts can be turned off; Enter still opens", async ({ page }) => {
	await libraryWithArticle(page)
	await page.goto("/settings/shortcuts")
	await waitForHydration(page)
	const setting = page.getByRole("checkbox", { name: "Single-key shortcuts" })
	await expect(setting).toBeChecked()
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/prefs") && r.request().method() === "POST"),
		setting.uncheck(),
	])
	await expect(page.locator("html")).toHaveAttribute("data-shortcuts", "off")

	await page.goto("/library")
	await waitForHydration(page)
	const cursor = page.locator("li[data-cursor]")
	await page.keyboard.press("j")
	await expect(cursor).toHaveCount(0)
	// The arrows are not characters: they still move the cursor, and Enter opens.
	await page.keyboard.press("ArrowDown")
	await expect(cursor).toContainText(TITLE)
	await page.keyboard.press("e")
	await page.keyboard.press("#")
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible()
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/read\//)
})

test.describe("phone drawer", () => {
	test.use({ viewport: { width: 390, height: 800 } })

	test("closed, nothing in it takes the focus; closing gives it back to the menu button", async ({
		page,
	}) => {
		await signupUser(page, "Drawer")
		await page.goto("/library")
		await waitForHydration(page)
		const drawer = page.locator("#mobile-drawer")
		const menuButton = page.getByRole("button", { name: "Menu" })
		expect(await drawer.evaluate((el) => Boolean(el.closest("[inert]")))).toBe(true)
		await menuButton.click()
		await expect(drawer.getByRole("link").first()).toBeFocused()
		// Open, the page behind it is inert.
		expect(await menuButton.evaluate((el) => Boolean(el.closest("[inert]")))).toBe(true)
		await page.keyboard.press("Escape")
		await expect(menuButton).toBeFocused()
		expect(await drawer.evaluate((el) => Boolean(el.closest("[inert]")))).toBe(true)
	})
})
