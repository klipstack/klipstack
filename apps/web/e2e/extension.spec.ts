import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test"
import { createInviteCode, uniqueEmail } from "./helpers"

/** Minimal typing for the extension APIs used inside evaluate() callbacks. */
declare const chrome: {
	storage: {
		sync: {
			set(values: Record<string, unknown>): Promise<void>
		}
	}
}

const EXTENSION_DIR = join(import.meta.dirname, "../../extension/dist/chrome-mv3")
const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PAGE_URL = "https://fixture.test/makers.html"
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5180}`

test.skip(
	!existsSync(EXTENSION_DIR),
	"extension not built (pnpm --filter @klipstack/extension build)",
)

/** A browser with the extension, signed up to Klipstack and pointed at this server. */
async function signedInBrowser() {
	const context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			// For `Extensions.triggerAction`, which clicks the toolbar button.
			"--enable-unsafe-extension-debugging",
		],
	})
	// Sign up in this browser: the extension saves with its session cookie.
	const page = await context.newPage()
	const code = await createInviteCode()
	await page.goto(`${APP_URL}/signup`, { timeout: 20_000 })
	await page.getByLabel("Invite code").fill(code)
	await page.getByLabel("Name").fill("Ext")
	await page.getByLabel("Email").fill(uniqueEmail("ext"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)

	// The extension's background service worker.
	const sw = await test.step("service worker", async () => {
		const [existing] = context.serviceWorkers()
		return existing ?? (await context.waitForEvent("serviceworker", { timeout: 20_000 }))
	})
	sw.on("console", (m) => console.log("[sw]", m.text()))
	const extensionId = new URL(sw.url()).host
	console.log("[ext] service worker", sw.url())

	// Point it at this server from its own options page. The page offers no API key any more.
	const options = await context.newPage()
	options.on("console", (m) => console.log("[options-page]", m.text()))
	await options.goto(`chrome-extension://${extensionId}/options.html`, { timeout: 20_000 })
	await expect(options.getByLabel("Klipstack address")).toBeVisible()
	await expect(options.getByLabel("API key")).toHaveCount(0)
	// A local server needs no permission prompt: the extension may always reach one.
	await options.getByLabel("Klipstack address").fill(APP_URL)
	await options.getByRole("button", { name: "Save" }).click()
	await expect(options.getByRole("status")).toHaveText("Saved.")
	return { context, page, options, extensionId }
}

/**
 * Clicks the extension's toolbar button on `tab`. The click is what grants the extension the tab
 * (`activeTab`): it has no lasting access to the sites it saves.
 */
const clickButton = (context: BrowserContext, extensionId: string, tab: Page) =>
	test.step("click the button", async () => {
		const browser = await context.browser()!.newBrowserCDPSession()
		// The action needs the tab's own target, not the page's.
		const { targetInfos } = await browser.send("Target.getTargets", {
			filter: [{ type: "tab", exclude: false }],
		})
		const target = targetInfos.find((t) => t.url === tab.url())
		if (!target) throw new Error(`no tab target for ${tab.url()}`)
		await browser.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId })
	})

test("extension captures the rendered page and saves it with the browser session", async () => {
	test.setTimeout(90_000)
	const { context, page, extensionId } = await signedInBrowser()
	try {
		// Serve the fixture at a realistic https URL (no network involved).
		await context.route(`${PAGE_URL}**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: readFileSync(FIXTURE, "utf8"),
			}),
		)

		// Open the article, then click the button on it.
		const article = await context.newPage()
		await article.goto(PAGE_URL, { timeout: 20_000 })
		await expect(article.getByText("There are two types of schedule")).toBeVisible()
		await clickButton(context, extensionId, article)
		await expect(article.getByText("Saved to Klipstack")).toBeVisible({ timeout: 30_000 })

		// The server extracted from the captured DOM (nothing was fetched from fixture.test).
		await page.goto(`${APP_URL}/library`)
		const link = page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" })
		await expect(link).toBeVisible({ timeout: 60_000 })
		await link.click()
		await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	} finally {
		await context.close()
	}
})

test("extension saves the whole article when the page's paywall cut it in the browser", async () => {
	test.setTimeout(90_000)
	const { context, page, extensionId } = await signedInBrowser()
	const url = "https://fixture.test/soft-paywall.html"
	// The site sends the whole article, and its script cuts it after the third paragraph.
	const paragraphs = Array.from(
		{ length: 30 },
		(_, i) =>
			`<p>Paragraph ${i + 1} of the paywalled story, long enough to read as article prose.</p>`,
	).join("")
	const body = `<!doctype html><html><head><title>The Paywalled Story</title>
		<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>
		</head><body>
		<article><h1>The Paywalled Story</h1>${paragraphs}</article>
		<script>
			for (const p of [...document.querySelectorAll("article p")].slice(3)) p.remove()
			document.querySelector("article").insertAdjacentHTML("beforeend", "<p>Subscribe to keep reading.</p>")
		</script></body></html>`
	let requests = 0
	try {
		await context.route(`${url}**`, (route) => {
			requests++
			return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body })
		})
		const article = await context.newPage()
		await article.goto(url, { timeout: 20_000 })
		await expect(article.getByText("Subscribe to keep reading.")).toBeVisible()
		await expect(article.getByText("Paragraph 30 of the paywalled story")).toHaveCount(0)

		await clickButton(context, extensionId, article)
		await expect(article.getByText("Saved to Klipstack")).toBeVisible({ timeout: 30_000 })
		// The page was fetched again, by the extension inside the tab.
		expect(requests).toBe(2)

		await page.goto(`${APP_URL}/library`)
		const link = page.getByRole("link", { name: "The Paywalled Story" })
		await expect(link).toBeVisible({ timeout: 60_000 })
		await link.click()
		await expect(page.locator(".reader-content")).toContainText(
			"Paragraph 30 of the paywalled story",
		)
	} finally {
		await context.close()
	}
})

test("extension asks for access to a server the user has not allowed, and sends nothing", async () => {
	test.setTimeout(90_000)
	const { context, options, extensionId } = await signedInBrowser()
	const server = "https://klipstack.example"
	let sent = 0
	try {
		await context.route(`${server}/**`, (route) => {
			sent++
			return route.fulfill({ status: 202, contentType: "application/json", body: "{}" })
		})
		await context.route(`${PAGE_URL}**`, (route) =>
			route.fulfill({ status: 200, contentType: "text/html", body: readFileSync(FIXTURE, "utf8") }),
		)
		// A server set before this version, which asked for access to every site.
		await options.evaluate(async (appUrl) => chrome.storage.sync.set({ appUrl }), server)
		await options.close()

		const article = await context.newPage()
		await article.goto(PAGE_URL, { timeout: 20_000 })
		await clickButton(context, extensionId, article)
		await expect(
			article.getByText("Allow the extension to reach your Klipstack server"),
		).toBeVisible({
			timeout: 30_000,
		})
		// The options page opens, where saving the address asks for access to it.
		const optionsUrl = `chrome-extension://${extensionId}/options.html`
		await expect.poll(() => context.pages().some((p) => p.url() === optionsUrl)).toBe(true)
		expect(sent).toBe(0)
	} finally {
		await context.close()
	}
})
