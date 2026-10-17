import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test"
import { createInviteCode, uniqueEmail } from "./helpers"

const EXTENSION_DIR = join(import.meta.dirname, "../../extension/dist/chrome-mv3")
const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PAGE_URL = "https://fixture.test/makers.html"
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5180}`

const BUILD = `WXT_APP_URL=${APP_URL} pnpm --filter @klipstack/extension build`

test.skip(!existsSync(EXTENSION_DIR), `extension not built (${BUILD})`)

test.beforeAll(() => {
	// A build saves to one server, fixed when it is built: this one.
	const manifest = JSON.parse(readFileSync(join(EXTENSION_DIR, "manifest.json"), "utf8")) as {
		host_permissions: string[]
	}
	const { protocol, hostname } = new URL(APP_URL)
	expect(manifest.host_permissions, `build it for this server: ${BUILD}`).toEqual([
		`${protocol}//${hostname}/*`,
	])
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
