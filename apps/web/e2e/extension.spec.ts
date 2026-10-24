import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test"
import { createInviteCode, uniqueEmail } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PAGE_URL = "https://fixture.test/makers.html"
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5180}`

// A build saves to one server, fixed when it is built: this spec builds its own, for this server.
const OUT_DIR = join(import.meta.dirname, "../../extension/dist/e2e")
const EXTENSION_DIR = join(OUT_DIR, "chrome-mv3")

test.beforeAll(() => {
	execFileSync("pnpm", ["--filter", "@klipstack/extension", "exec", "wxt", "build"], {
		env: { ...process.env, WXT_APP_URL: APP_URL, WXT_OUT_DIR: OUT_DIR },
	})
})

/** A browser with the extension, signed up to Klipstack. */
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

	return { context, page, extensionId }
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
		// Its link opens the article the server saved.
		await expect(article.getByRole("link", { name: "Open" })).toHaveAttribute(
			"href",
			new RegExp(`^${APP_URL}/read/[0-9a-f-]{36}$`),
		)

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

test("extension asks for the server when the browser withholds it, instead of failing to reach it", async () => {
	test.setTimeout(90_000)
	const { context, extensionId } = await signedInBrowser()
	try {
		// Safari grants an extension no site until the reader allows it; Chrome's "on click" site
		// access withholds them the same way. Without it, a save is cross-origin and the server
		// refuses it, which the browser reports as a network error.
		const settings = await context.newPage()
		await settings.goto("chrome://extensions")
		await settings.evaluate(
			(id) =>
				new Promise<void>((done) =>
					// @ts-expect-error chrome.developerPrivate exists on chrome://extensions only
					chrome.developerPrivate.updateExtensionConfiguration(
						{ extensionId: id, hostAccess: "ON_CLICK" },
						done,
					),
				),
			extensionId,
		)
		await context.route(`${PAGE_URL}**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: readFileSync(FIXTURE, "utf8"),
			}),
		)
		const article = await context.newPage()
		await article.goto(PAGE_URL, { timeout: 20_000 })
		await clickButton(context, extensionId, article)
		// The browser now asks the reader (a prompt outside the page, which the test can't answer).
		// Before, the save went out at once and failed within a second as "Can't reach Klipstack".
		const shown = new Set<string>()
		for (const until = Date.now() + 8000; Date.now() < until;) {
			const text = await article.evaluate(
				() =>
					document.getElementById("klipstack-toast-host")?.shadowRoot?.querySelector(".toast")
						?.textContent ?? "",
			)
			if (text) shown.add(text)
			await article.waitForTimeout(200)
		}
		expect([...shown]).toEqual([])
	} finally {
		await context.close()
	}
})
