import { expect, type Page, type Request, test } from "@playwright/test"
import { signupUser, uniqueEmail, waitForHydration } from "./helpers"

/** One string of each language, from `packages/i18n/src/locales/{en,es}/auth.ts`. */
const STRINGS = ["Invalid email or password.", "Correo o contraseña incorrectos."]

/** The JavaScript the page loads, in development (a module each) as in production (chunks). */
async function scriptsOf(page: Page, path: string): Promise<string[]> {
	const urls = new Set<string>()
	const collect = (request: Request) => {
		if (request.resourceType() === "script") urls.add(request.url())
	}
	page.on("request", collect)
	await page.goto(path)
	await waitForHydration(page)
	await page.waitForLoadState("networkidle")
	page.off("request", collect)
	return Promise.all([...urls].map(async (url) => (await page.request.get(url)).text()))
}

test("the browser's scripts carry no translation strings: it loads them from /api/locales", async ({
	page,
}) => {
	const loaded = [...(await scriptsOf(page, "/")), ...(await scriptsOf(page, "/login"))]
	await signupUser(page, "Locales Reader")
	loaded.push(...(await scriptsOf(page, "/home")))
	expect(loaded.length).toBeGreaterThan(0)
	for (const string of STRINGS)
		expect(loaded.filter((script) => script.includes(string)).length, string).toBe(0)
})

test("a Spanish reader sees the server's error in Spanish", async ({ browser }) => {
	const context = await browser.newContext({ locale: "es-ES" })
	const page = await context.newPage()
	await page.goto("/login")
	await waitForHydration(page)
	await page.locator('input[name="email"]').fill(uniqueEmail("locales"))
	await page.locator('input[name="password"]').fill("wrong-password")
	await page.getByRole("button", { name: "Entrar" }).click()
	// The action answers with a key; the browser shows it only if it knows the key's string.
	await expect(page.getByRole("alert")).toHaveText("Correo o contraseña incorrectos.")
	await context.close()
})
