import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/joelonsoftware-joel-test.html",
)
const FIXTURE_URL =
	"https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/"
const TITLE = "The Joel Test: 12 Steps to Better Code"

test("api key → API save with captured html → search → palette → export → delete account", async ({
	page,
	request,
}) => {
	test.setTimeout(150_000)
	const email = await signupUser(page, "Settings")

	// create an API key
	await page.goto("/settings/api-keys")
	await waitForHydration(page)
	await page.getByLabel("Name (e.g. MacBook Chrome)").fill("Playwright")
	await page.getByRole("button", { name: "Create key" }).click()
	const key = (await page.getByTestId("new-api-key").textContent())?.trim() ?? ""
	expect(key).toMatch(/^klip_/)
	await expect(page.getByText("Playwright", { exact: true })).toBeVisible()

	// bearer auth without cookies, through the API (the browser's save endpoint takes no keys)
	const anon = await request.post("/api/v1/articles", { data: { url: FIXTURE_URL } })
	expect(anon.status()).toBe(401)
	const bad = await request.post("/api/v1/articles", {
		headers: { authorization: "Bearer klip_nope" },
		data: { url: FIXTURE_URL },
	})
	expect(bad.status()).toBe(401)
	const saved = await request.post("/api/v1/articles", {
		headers: { authorization: `Bearer ${key}` },
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	expect(saved.status()).toBe(202)
	const { id } = ((await saved.json()) as { article: { id: string } }).article

	await page.goto("/library")
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 60_000 })

	// search (full text, body words)
	await page.goto("/search?q=source%20control")
	await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeAttached()
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible()
	await expect(page.getByText("Nothing matches that search.")).toHaveCount(0)
	await expect(page.getByText("loaderData")).toHaveCount(0)
	// Escape on the emptied field leaves the search
	await waitForHydration(page)
	const searchBox = page.getByRole("searchbox", { name: "Search" })
	await searchBox.fill("")
	await searchBox.press("Escape")
	await expect(page).toHaveURL(/\/library$/)
	// an old search URL still works
	await page.goto("/library?q=zzzznotthere")
	await expect(page).toHaveURL(/\/search\?q=zzzznotthere$/)
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()
	const api = await page.request.get("/api/search?q=joel")
	expect(((await api.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toContain(id)

	// command palette
	await page.goto("/library")
	await waitForHydration(page)
	await page.keyboard.press("ControlOrMeta+k")
	const paletteInput = page.getByPlaceholder("Search or type a command…")
	await expect(paletteInput).toBeVisible()
	await paletteInput.fill("joel test")
	const hit = page.locator("[cmdk-item]").filter({ hasText: TITLE })
	await expect(hit).toBeVisible()
	await hit.click()
	await expect(page).toHaveURL(new RegExp(`/read/${id}$`))

	// the palette's last row searches for the same words on the search page
	await page.goto("/library")
	await waitForHydration(page)
	await page.keyboard.press("ControlOrMeta+k")
	await expect(paletteInput).toBeFocused()
	await paletteInput.fill("source control")
	await page.getByRole("option", { name: "Search articles for “source control”" }).click()
	await expect(page).toHaveURL(/\/search\?q=source(\+|%20)control$/)
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible()

	// the library's search button opens the search page on this view
	await page.goto("/library")
	await waitForHydration(page)
	const searchButton = page.getByRole("main").getByRole("link", { name: "Search", exact: true })
	// icon buttons name themselves in a tooltip on hover, with their key
	await searchButton.hover()
	const tip = page.getByTestId("tooltip")
	await expect(tip).toHaveText(/^Search\/$/)
	await searchButton.click()
	await expect(tip).toHaveCount(0)
	await expect(page).toHaveURL(/\/search\?q=in%3Alibrary%20$/)
	await expect(searchBox).toBeFocused()
	await expect(searchBox).toHaveValue("in:library ")

	// export, through the links in Settings
	await page.goto("/settings/data")
	await waitForHydration(page)
	const download = async (name: string) => {
		const [file] = await Promise.all([
			page.waitForEvent("download"),
			page.getByRole("link", { name }).click(),
		])
		return { name: file.suggestedFilename(), body: readFileSync(await file.path()) }
	}
	const zip = await download("Download .zip (Markdown + JSON)")
	expect(zip.name).toMatch(/^klipstack-.*\.zip$/)
	expect(zip.body.byteLength).toBeGreaterThan(1000)
	const json = await download("Download .json")
	const bundle = JSON.parse(json.body.toString("utf8")) as {
		documents: Array<{ title: string; markdown: string }>
	}
	expect(bundle.documents.map((d) => d.title)).toContain(TITLE)
	expect(bundle.documents[0]?.markdown).toContain("source control")

	// revoke key → bearer stops working
	await page.getByRole("link", { name: "API keys" }).click()
	await expect(page).toHaveURL(/\/settings\/api-keys$/)
	page.once("dialog", (d) => d.accept())
	await page.getByRole("button", { name: "Revoke Playwright" }).click()
	await expect(page.getByText("No keys yet.")).toBeVisible()
	const revoked = await request.get("/api/v1/me", {
		headers: { authorization: `Bearer ${key}` },
	})
	expect(revoked.status()).toBe(401)

	// delete account
	await page.getByRole("link", { name: "Account", exact: true }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await page.getByLabel("Type your email to confirm").fill("wrong@example.com")
	await page.getByRole("button", { name: "Delete my account" }).click()
	await expect(page.getByText("The email does not match.")).toBeVisible()
	await page.getByLabel("Type your email to confirm").fill(email)
	await page.getByRole("button", { name: "Delete my account" }).click()
	await expect(page).toHaveURL(/\/login\?deleted=1$/)
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page.getByRole("alert")).toHaveText("Invalid email or password.")
})

test("settings shows the running version, and offers a reload when a newer one is live", async ({
	page,
}) => {
	await signupUser(page, "Settings")
	await page.goto("/settings/about")
	await waitForHydration(page)
	const about = page.getByRole("main")
	await expect(about.locator("code")).toHaveText("dev")
	await expect(about.getByRole("button")).toHaveCount(0)

	// the same page, loaded while the server already runs a newer commit
	await page.route("**/version", (route) =>
		route.fulfill({ status: 200, body: JSON.stringify({ version: "beefbee" }) }),
	)
	await page.goto("/settings/about")
	await waitForHydration(page)
	await expect(about.getByRole("button", { name: /reload/i })).toBeVisible()
	await expect(about.locator("code")).toHaveText("dev")
})

test("Settings replaces the app's sidebar with its sections, and goes back where it was opened", async ({
	page,
}) => {
	await signupUser(page, "Settings Frame")
	await page.goto("/archive?sort=oldest")
	await waitForHydration(page)
	await page.getByRole("button", { name: /^Account:/ }).click()
	await page.getByRole("menuitem", { name: "Settings" }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveCount(0)
	await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible()

	// One page per section; a reload keeps the way back.
	await page.getByRole("link", { name: "Usage" }).click()
	await expect(page).toHaveURL(/\/settings\/usage$/)
	await expect(page.getByRole("link", { name: "Usage" })).toHaveAttribute("aria-current", "page")
	await page.reload()
	await waitForHydration(page)
	await page.getByRole("link", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/archive\?sort=oldest$/)

	// Phones: the sections are in a drawer, under the way back.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto("/settings/appearance")
	await waitForHydration(page)
	await expect(page.getByRole("heading", { level: 1, name: "Appearance" })).toBeVisible()
	await page.getByRole("button", { name: "Menu" }).click()
	const drawer = page.getByRole("dialog", { name: "Menu" })
	await drawer.getByRole("link", { name: "About" }).click()
	await expect(page).toHaveURL(/\/settings\/about$/)
	await expect(drawer).toBeHidden()
	await page.getByRole("button", { name: "Menu" }).click()
	await drawer.getByRole("link", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/archive\?sort=oldest$/)
})
