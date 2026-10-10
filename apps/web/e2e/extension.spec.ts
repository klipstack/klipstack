import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, expect, test } from "@playwright/test"
import { createInviteCode, uniqueEmail } from "./helpers"

/** Minimal typing for the extension APIs used inside evaluate() callbacks. */
declare const chrome: {
	storage: {
		sync: {
			set(values: Record<string, unknown>): Promise<void>
		}
	}
	tabs: { query(query: { url: string }): Promise<Array<{ id?: number; url?: string }>> }
	runtime: { sendMessage<T>(message: unknown): Promise<T>; lastError?: { message?: string } }
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

test("extension captures the rendered page and saves it with the browser session", async () => {
	test.setTimeout(90_000)
	const context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
	})
	try {
		// Serve the fixture at a realistic https URL (no network involved).
		await context.route(`${PAGE_URL}**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: readFileSync(FIXTURE, "utf8"),
			}),
		)

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

		// Point it at this server from its own options page (an extension context that can message
		// the worker). The page offers no API key any more.
		const options = await context.newPage()
		options.on("console", (m) => console.log("[options-page]", m.text()))
		await options.goto(`chrome-extension://${extensionId}/options.html`, { timeout: 20_000 })
		await expect(options.getByLabel("Klipstack address")).toBeVisible()
		await expect(options.getByLabel("API key")).toHaveCount(0)
		await options.evaluate(async (appUrl) => chrome.storage.sync.set({ appUrl }), APP_URL)

		// Open the article, then ask the worker to save that tab.
		const article = await context.newPage()
		await article.goto(PAGE_URL, { timeout: 20_000 })
		await expect(article.getByText("There are two types of schedule")).toBeVisible()
		const tabs = await options.evaluate((url) => chrome.tabs.query({ url }), PAGE_URL)
		console.log("[ext] tabs", JSON.stringify(tabs))

		const result = await test.step("save-tab", () =>
			options.evaluate(async (url) => {
				const [tab] = await chrome.tabs.query({ url })
				if (!tab?.id) throw new Error("tab not found")
				const outcome = chrome.runtime.sendMessage<{
					ok: boolean
					status: number
					id?: string
					error?: string
				}>({ type: "save-tab", tabId: tab.id })
				const timeout = new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("save-tab timed out")), 30_000),
				)
				return Promise.race([outcome, timeout])
			}, PAGE_URL))
		console.log("[ext] save result", JSON.stringify(result))
		expect(result).toMatchObject({ ok: true, status: 202 })

		// The server extracted from the captured DOM (nothing was fetched from fixture.test).
		await page.goto(`${APP_URL}/library`)
		const link = page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" })
		await expect(link).toBeVisible({ timeout: 60_000 })
		await link.click()
		await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
		const saved = await page.request.get(`${APP_URL}/api/search?q=maker`)
		expect(((await saved.json()) as { items: Array<{ id: string }> }).items[0]?.id).toBe(result.id)
	} finally {
		await context.close()
	}
})
