import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { connectApp, signupUser, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/joelonsoftware-joel-test.html",
)
const FIXTURE_URL =
	"https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/"
const TITLE = "The Joel Test: 12 Steps to Better Code"

test("connected app → API save with captured html → search → palette → export → delete account", async ({
	page,
	request,
	baseURL,
}) => {
	test.setTimeout(150_000)
	const email = await signupUser(page, "Settings")

	// connect an app through OAuth
	const token = await connectApp(page, request, baseURL ?? "", "Playwright")

	// bearer auth without cookies, through the API (the browser's save endpoint takes no tokens)
	const anon = await request.post("/api/v1/articles", { data: { url: FIXTURE_URL } })
	expect(anon.status()).toBe(401)
	const bad = await request.post("/api/v1/articles", {
		headers: { authorization: "Bearer klip_nope" },
		data: { url: FIXTURE_URL },
	})
	expect(bad.status()).toBe(401)
	const saved = await request.post("/api/v1/articles", {
		headers: { authorization: `Bearer ${token}` },
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

	// disconnect the app → bearer stops working
	await page.getByRole("link", { name: "Connected apps" }).click()
	await expect(page).toHaveURL(/\/settings\/connected-apps$/)
	await waitForHydration(page)
	page.once("dialog", (d) => d.accept())
	await page.getByRole("button", { name: "Disconnect Playwright" }).click()
	await expect(page.getByText("No connected apps.")).toBeVisible()
	const revoked = await request.get("/api/v1/me", {
		headers: { authorization: `Bearer ${token}` },
	})
	expect(revoked.status()).toBe(401)

	// delete account
	await page.getByRole("link", { name: "Account", exact: true }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await page.getByRole("link", { name: "Delete account…" }).click()
	await expect(page).toHaveURL(/\/settings\/account\/delete$/)
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

test("every page tells of a newer version, and once closed only of the one after it", async ({
	page,
}) => {
	await page.clock.install()
	await signupUser(page, "Update Notice")
	await page.goto("/library")
	await waitForHydration(page)
	const notice = page.getByRole("status").filter({ hasText: "Klipstack has been updated." })
	await expect(notice).toHaveCount(0)

	// deployed while the tab is open: the next navigation after a few minutes finds out
	let live = "beefbee"
	await page.route("**/version", (route) =>
		route.fulfill({ status: 200, body: JSON.stringify({ version: live }) }),
	)
	let checks = 0
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/version") checks++
	})
	// within a few minutes of the last check, a navigation does not ask again
	await page.getByRole("link", { name: "Home" }).first().click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)
	expect(checks).toBe(0)
	await expect(notice).toHaveCount(0)
	// after them, the tab coming back to the front does
	await page.clock.fastForward("06:00")
	await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
	await expect(notice).toBeVisible()
	expect(checks).toBe(1)

	await page.evaluate(() => Object.assign(window, { beforeReload: true }))
	await notice.getByRole("button", { name: "Reload" }).click()
	await expect.poll(() => page.evaluate(() => "beforeReload" in window)).toBe(false)
	await waitForHydration(page)

	// closed, it stays closed in this tab for the same version
	await notice.getByRole("button", { name: "Close" }).click()
	await expect(notice).toHaveCount(0)
	// a new page load: the check has seen the newer version (Settings offers it), and the notice stays closed
	await page.goto("/settings/about")
	await waitForHydration(page)
	await expect(page.getByRole("main").getByRole("button", { name: /reload/i })).toBeVisible()
	await expect(notice).toHaveCount(0)

	// another deploy brings it back, found on the next navigation a few minutes later
	live = "cafe123"
	await page.clock.fastForward("06:00")
	await page.getByRole("link", { name: "Account", exact: true }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await expect(notice).toBeVisible()
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

test("a new account's Getting started card ticks a step as it is done, and goes for good with its ✕", async ({
	page,
}) => {
	await signupUser(page, "Starting")
	await page.goto("/home")
	await waitForHydration(page)
	// The phone drawer has its own, hidden here. No extension step: the server is not klipstack.com.
	const card = page.getByTestId("getting-started").filter({ visible: true })
	await expect(card).toContainText("0 of 3")
	const feature = card.getByRole("link", { name: /^Turn on .*feeds or editions$/ })
	await feature.click()
	await expect(page).toHaveURL(/\/settings\/features$/)
	// The save itself: a GET of the `prefs-*.js` chunk matches /prefs too.
	const done = page.waitForResponse(
		(r) => r.request().method() === "POST" && r.url().includes("/prefs") && r.ok(),
	)
	await page.getByTestId("feature-feeds").check()
	await done
	await page.goto("/home")
	await waitForHydration(page)
	await expect(card).toContainText("1 of 3")
	await expect(card.getByRole("link", { name: /^Turn on/ })).toHaveCount(0)
	// Done: struck through, its box named so for screen readers.
	const doneStep = card.getByRole("listitem").filter({ hasText: /Turn on .*feeds or editions/ })
	await expect(doneStep.getByRole("img", { name: "Done" })).toBeVisible()
	await expect(card.getByRole("img", { name: "To do" })).toHaveCount(2)

	await card.getByRole("button", { name: "Hide this" }).click()
	await expect(page.getByTestId("getting-started")).toHaveCount(0)
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByRole("link", { name: "Library" })).toBeVisible()
	await expect(page.getByTestId("getting-started")).toHaveCount(0)
})

test("Getting started opens the guide to try a highlight in", async ({ page }) => {
	await signupUser(page, "Highlighting")
	await page.goto("/home")
	await waitForHydration(page)
	const card = page.getByTestId("getting-started").filter({ visible: true })
	await card.getByRole("button", { name: "Highlight a passage" }).click()
	await expect(page).toHaveURL(/\/read\//)
	await expect(page.getByRole("heading", { name: "How to use Klipstack" })).toBeVisible()
})
