import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

async function signup(page: Page) {
	await signupUser(page, "Theme", { verified: false })
}

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const themeAttr = (page: Page) =>
	page.evaluate(() => document.documentElement.dataset.theme ?? null)

test("follows the OS preference by default", async ({ browser }) => {
	const light = await browser.newContext({ colorScheme: "light" })
	const dark = await browser.newContext({ colorScheme: "dark" })
	const lightPage = await light.newPage()
	const darkPage = await dark.newPage()
	await lightPage.goto("/login")
	await darkPage.goto("/login")
	expect(await themeAttr(lightPage)).toBeNull()
	expect(await themeAttr(darkPage)).toBeNull()
	expect(await bodyBg(lightPage)).not.toBe(await bodyBg(darkPage))
	await light.close()
	await dark.close()
})

test("settings can force light or dark, and system restores the OS preference", async ({
	browser,
}) => {
	const context = await browser.newContext({ colorScheme: "dark" })
	const page = await context.newPage()
	await signup(page)
	await page.goto("/home")
	const systemBg = await bodyBg(page)

	await page.goto("/settings/appearance")
	await waitForHydration(page)
	const picker = page.getByRole("group", { name: "Theme" }).first()
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/prefs") && r.request().method() === "POST"),
		picker.getByRole("button", { name: "Light" }).click(),
	])
	await expect.poll(() => themeAttr(page)).toBe("light")
	const lightBg = await bodyBg(page)
	expect(lightBg).not.toBe(systemBg)

	await page.reload()
	expect(await themeAttr(page)).toBe("light")

	// the account menu switch works too and shares the same state
	await page.goto("/library")
	expect(await themeAttr(page)).toBe("light")
	await waitForHydration(page)
	await page
		.getByRole("button", { name: /^Account:/ })
		.first()
		.click()
	const menu = page.getByRole("menu")
	await expect(menu.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
		"aria-checked",
		"true",
	)
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/prefs") && r.request().method() === "POST"),
		menu.getByRole("menuitemradio", { name: "Dark" }).click(),
	])
	await expect.poll(() => themeAttr(page)).toBe("dark")

	// the menu stays open, so the choice can be seen and changed again
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/prefs") && r.request().method() === "POST"),
		menu.getByRole("menuitemradio", { name: "System" }).click(),
	])
	await expect.poll(() => themeAttr(page)).toBeNull()
	expect(await bodyBg(page)).toBe(systemBg)
	await context.close()
})
