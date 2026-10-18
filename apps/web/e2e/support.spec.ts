import { expect, type Page, test } from "@playwright/test"
import { login, logout, signupUser, waitForHydration } from "./helpers"

const SUPPYHQ = "https://app.suppyhq.com"

/** SuppyHQ's panel, as far as the app relies on it: it says its height, and closes on its ✕. */
const panel = `<!doctype html><body>
<p id="address"></p><button id="close">Close</button>
<script>
	document.getElementById("address").textContent = location.href
	parent.postMessage({ type: "suppyhq:resize", height: 300 }, "*")
	document.getElementById("close").onclick = () => parent.postMessage({ type: "suppyhq:close" }, "*")
</script>`

/** Every request to SuppyHQ the page makes, answered by the stand-in panel. */
async function stubSuppyHQ(page: Page) {
	const requests: string[] = []
	await page.route(`${SUPPYHQ}/**`, (route) => {
		requests.push(route.request().url())
		return route.fulfill({ contentType: "text/html", body: panel })
	})
	return requests
}

test("Contact support reaches SuppyHQ only when clicked, right after signing in", async ({
	page,
}) => {
	const requests = await stubSuppyHQ(page)
	const email = await signupUser(page, "Support Reader")
	await logout(page)
	// Signing in moves to the app without loading a new page: the panel must still open there.
	await page.goto("/login")
	await waitForHydration(page)
	await login(page, email)
	await page.goto("/library")
	await waitForHydration(page)
	expect(requests).toEqual([])

	await page.getByRole("button", { name: "Contact support" }).click()
	const dialog = page.getByRole("dialog", { name: "Contact support" })
	const frame = page.frameLocator('iframe[title="Contact support"]')
	await expect(dialog).toBeVisible()
	const address = new URL((await frame.locator("#address").textContent()) ?? "")
	expect(address.origin + address.pathname).toBe(`${SUPPYHQ}/widget/e2e/panel`)
	expect(address.searchParams.get("user_email")).toBe(email)
	expect(address.searchParams.get("user_name")).toBe("Support Reader")
	expect(address.searchParams.get("avatar_mode")).toBe("face")

	// Only the panel's own frame can close it: not the page, not another window.
	await page.evaluate(() => window.postMessage({ type: "suppyhq:close" }, "*"))
	await expect(dialog).toBeVisible()
	await frame.getByRole("button", { name: "Close" }).click()
	await expect(dialog).toBeHidden()
})

test("a support form that doesn't load gives way to the support email", async ({ page }) => {
	await page.route(`${SUPPYHQ}/**`, (route) => route.abort())
	await signupUser(page, "Support Offline")
	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Contact support" }).click()
	await expect(page.getByRole("link", { name: "hello@klipstack.com" })).toBeVisible({
		timeout: 15_000,
	})
})
