import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EXTENSION_CLIENT_ID } from "@klipstack/api-contract/auth"
import { and, db, documents, eq, oauthConsent, user } from "@klipstack/db"
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test"
import { createInviteCode, uniqueEmail, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PAGE_URL = "https://fixture.test/makers.html"
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5180}`

// A build saves to one server, fixed when it is built: this spec builds its own, for this server.
const OUT_DIR = join(import.meta.dirname, "../../extension/dist/e2e")
const EXTENSION_DIR = join(OUT_DIR, "chrome-mv3")
// Safari's way of saving (its own sign-in, then the API), built for Chromium: Safari can't run here.
const TOKEN_OUT_DIR = join(OUT_DIR, "token")
const TOKEN_EXTENSION_DIR = join(TOKEN_OUT_DIR, "chrome-mv3")

test.beforeAll(() => {
	execFileSync("pnpm", ["--filter", "@klipstack/extension", "exec", "wxt", "build"], {
		env: { ...process.env, WXT_APP_URL: APP_URL, WXT_OUT_DIR: OUT_DIR },
	})
	execFileSync("pnpm", ["--filter", "@klipstack/extension", "exec", "wxt", "build"], {
		env: { ...process.env, WXT_APP_URL: APP_URL, WXT_OUT_DIR: TOKEN_OUT_DIR, WXT_TOKEN_AUTH: "1" },
	})
})

/** A browser with the extension (the build in `dir`), signed up to Klipstack. */
async function signedInBrowser(dir = EXTENSION_DIR) {
	const context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		args: [
			`--disable-extensions-except=${dir}`,
			`--load-extension=${dir}`,
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
	const email = uniqueEmail("ext")
	await page.getByLabel("Email").fill(email)
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

	return { context, page, extensionId, email }
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

test("extension signs in on its own where the browser keeps the session from it, then saves", async () => {
	test.setTimeout(90_000)
	const { context, extensionId, email } = await signedInBrowser(TOKEN_EXTENSION_DIR)
	// An app connects only to an account with a verified email.
	await db.update(user).set({ emailVerified: true }).where(eq(user.email, email))
	try {
		await context.route(`${PAGE_URL}**`, (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: readFileSync(FIXTURE, "utf8"),
			}),
		)
		const article = await context.newPage()
		await article.goto(PAGE_URL, { timeout: 20_000 })

		// Not connected yet: the click opens the server's consent in a new tab.
		const consentTab = context.waitForEvent("page")
		await clickButton(context, extensionId, article)
		const consent = await consentTab
		await expect(consent.getByText("Klipstack for Safari wants to access")).toBeVisible({
			timeout: 20_000,
		})
		await expect(consent.getByText("clicked the Klipstack button in Safari")).toBeVisible()
		await waitForHydration(consent)
		await consent.getByRole("button", { name: "Allow" }).click()

		// The extension reads the code from the tab, closes it, and saves the page it was asked to.
		await expect.poll(() => consent.isClosed(), { timeout: 20_000 }).toBe(true)
		await expect(article.getByText("Saved to Klipstack")).toBeVisible({ timeout: 30_000 })
		const href = await article.getByRole("link", { name: "Open" }).getAttribute("href")
		const id = new RegExp(`^${APP_URL}/read/([0-9a-f-]{36})$`).exec(href ?? "")?.[1]
		expect(id, href ?? "").toBeTruthy()
		const [saved] = await db
			.select({ userId: documents.userId, source: documents.captureSource })
			.from(documents)
			.where(eq(documents.id, id!))
		expect(saved?.source).toBe("extension")
		const consents = await db
			.select({ id: oauthConsent.id })
			.from(oauthConsent)
			.where(
				and(eq(oauthConsent.userId, saved!.userId), eq(oauthConsent.clientId, EXTENSION_CLIENT_ID)),
			)
		expect(consents).toHaveLength(1)

		// Connected: the next click saves at once, with no new tab.
		await article.reload()
		let opened = false
		context.once("page", () => {
			opened = true
		})
		await clickButton(context, extensionId, article)
		await expect(article.getByText("Saved to Klipstack")).toBeVisible({ timeout: 30_000 })
		expect(opened).toBe(false)
	} finally {
		await context.close()
	}
})
