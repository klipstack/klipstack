import { db, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import {
	adminCode,
	login,
	logout,
	PASSWORD,
	postInjectedForm,
	resetLocalIpLimit,
	signupAdmin,
	signupUser,
	waitForHydration,
	waitForSidebarPrefetch,
} from "./helpers"
import { insertArticle } from "./seed"

// The pages that let their forms go on to a provider or an app (`allowFormTargets`) send a wider
// form-action. A policy belongs to the document, and the app's own navigation keeps it: leaving such
// a page loads a fresh document (useFreshDocumentOnLeave), which must reach the next page in every
// engine. WebKit runs this spec too (ENGINE_SPECS): it cancels a module import a navigation away
// interrupts, and React Router reloads the page on that.

const toGitHub = "https://github.com/collect"
const blocked = { outcome: "form-action", reached: [] }

/** Marks this document, to tell it from the next one. */
const markDocument = (page: Page) =>
	page.evaluate(() => ((window as Window & { __left?: string }).__left = "here"))
const sameDocument = (page: Page) =>
	page.evaluate(() => (window as Window & { __left?: string }).__left === "here")

test("a link out of Settings → Ways to log in reaches its page, in a new document", async ({
	page,
}) => {
	await signupUser(page, "Fresh Leaving")
	await page.goto("/settings/account/sign-in")
	await waitForHydration(page)
	await markDocument(page)
	const entries = await page.evaluate(() => history.length)
	await page.getByRole("link", { name: "Back", exact: true }).click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)
	expect(await sameDocument(page)).toBe(false)
	// One step in history: the page left, then this one, with nothing in between.
	expect(await page.evaluate(() => history.length)).toBe(entries + 1)
	expect(await postInjectedForm(page, toGitHub)).toEqual(blocked)
	// Back returns to the page left, and Forward to this one.
	await waitForSidebarPrefetch(page)
	await page.goBack()
	await expect(page).toHaveURL(/\/settings\/account\/sign-in$/)
	await page.goForward()
	await expect(page).toHaveURL(/\/home$/)
})

test("/login's links reach their pages", async ({ page }) => {
	for (const [name, url] of [
		["Forgot your password?", /\/forgot-password$/],
		["Terms", /\/terms$/],
	] as const) {
		await page.goto("/login")
		await waitForHydration(page)
		await page.getByRole("link", { name, exact: true }).click()
		await expect(page).toHaveURL(url)
	}
})

test("a two-factor login from a hydrated /login reaches the code and signs in", async ({
	page: setup,
	browser,
}) => {
	const email = await signupAdmin(setup, "Fresh Two Factor")
	await resetLocalIpLimit("/sign-in/email")
	await resetLocalIpLimit("/two-factor/verify-totp")
	// Another browser, whose cache has none of the code page's scripts yet.
	const context = await browser.newContext()
	const page = await context.newPage()
	await page.goto("/login")
	await waitForHydration(page)
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill(PASSWORD)
	await page.getByRole("button", { name: "Log in", exact: true }).click()
	await expect(page).toHaveURL(/\/login\/code/)
	await waitForHydration(page)
	await page.getByLabel("Code").fill(adminCode(email))
	await page.getByRole("button", { name: "Continue" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)
	expect(await postInjectedForm(page, toGitHub)).toEqual(blocked)
	await context.close()
})

test("a sign-in page's wider form-action ends with the page", async ({ page }) => {
	const email = await signupUser(page, "Wider Policy")
	const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	await insertArticle(row!.id, "Policy", "<p>An article whose markup got past the sanitizer.</p>")

	// Signing in on a hydrated /login.
	await logout(page)
	await page.goto("/login")
	await waitForHydration(page)
	await login(page, email)
	await waitForHydration(page)
	expect(await postInjectedForm(page, toGitHub)).toEqual(blocked)

	// Leaving Settings → Ways to log in by its own link, then on to the library and the reader.
	await waitForSidebarPrefetch(page)
	await page.goto("/settings/account/sign-in")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Back", exact: true }).click()
	await expect(page).not.toHaveURL(/\/settings/)
	await waitForHydration(page)
	await page.getByRole("link", { name: "Library", exact: true }).first().click()
	await expect(page).toHaveURL(/\/library$/)
	await page.getByRole("link", { name: "Policy" }).first().click()
	await expect(page).toHaveURL(/\/read\//)
	await waitForHydration(page)
	expect(await postInjectedForm(page, toGitHub)).toEqual(blocked)
})
