import { db, documents, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const TARGET = "https://example.com/preview?article=42#details"
const preview = {
	title: "A better way to read the web",
	description:
		"Save the ideas that matter, follow their sources, and make room for thoughtful reading.",
	author: "Alex Reader",
	siteName: "The Reading Room",
	imageUrl: "/icons/icon-512.png",
}

async function openReader(page: Page) {
	const email = await signupUser(page, "Link Preview")
	const paragraph =
		"Reading a page often leads to another interesting source worth keeping. ".repeat(12)
	const html = `<!doctype html><html><head><title>Following the links</title></head><body><article>
		<h1>Following the links</h1><p>${paragraph}</p>
		<p>Start with <a href="${TARGET}">this essay</a>, then try
		<a href="https://example.com/unavailable">an unavailable page</a> or
		<a href="https://example.com/broken-image">a page with a broken image</a>.</p>
		<p>${paragraph}</p><p>${paragraph}</p>
	</article></body></html>`
	const saved = await page.request.post("/api/documents", {
		data: { url: "https://example.com/preview-source", html },
	})
	expect(saved.status()).toBe(202)
	const {
		article: { id },
	} = await saved.json()
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("this essay", { timeout: 60_000 })
	await waitForHydration(page)
	return { email, id }
}

/**
 * Fake timers that move only when the test says so. Installed alone, the clock still flows, and
 * the card's hover delay could pass while the test waits for something else.
 */
async function stopTime(page: Page) {
	await page.clock.install()
	await page.clock.pauseAt(Date.now() + 1000)
}

async function expectWithinViewport(page: Page) {
	// Resizing the viewport dispatches resize/observer callbacks on the next frame.
	await expect(async () => {
		const box = await page.getByRole("dialog", { name: "Link", exact: true }).boundingBox()
		const viewport = page.viewportSize()!
		expect(box).not.toBeNull()
		expect(box!.x).toBeGreaterThanOrEqual(0)
		expect(box!.y).toBeGreaterThanOrEqual(0)
		expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
		expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
	}).toPass({ timeout: 5000 })
}

for (const mobile of [false, true]) {
	test.describe(mobile ? "touch link card" : "desktop link card", () => {
		test.use(mobile ? { viewport: { width: 390, height: 700 }, hasTouch: true } : {})

		test("loads metadata, copies the original URL, and keeps actions available on failure", async ({
			page,
			context,
		}, testInfo) => {
			test.setTimeout(90_000)
			await context.grantPermissions(["clipboard-read", "clipboard-write"])
			let release!: () => void
			const ready = new Promise<void>((resolve) => {
				release = resolve
			})
			await page.route("**/api/link-preview?**", async (route) => {
				const url = new URL(route.request().url()).searchParams.get("url")
				if (url === TARGET) await ready
				await route.fulfill({
					json: {
						preview: url?.endsWith("unavailable")
							? null
							: {
									...preview,
									imageUrl: url?.endsWith("broken-image")
										? "/missing-preview-image.jpg"
										: preview.imageUrl,
								},
					},
				})
			})
			const { email, id } = await openReader(page)
			await page.locator(".reader-content a", { hasText: "this essay" }).click()
			const card = page.getByRole("dialog", { name: "Link", exact: true })
			await expect(card.getByText("Loading preview…")).toBeVisible()
			await expect(card.getByRole("button", { name: "Save to Klipstack" })).toBeEnabled()
			await expect(card.getByRole("link", { name: "Open original" })).toHaveAttribute(
				"href",
				TARGET,
			)
			await card.getByRole("button", { name: "Copy original URL" }).click()
			await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(TARGET)
			await expect(page.getByRole("status").filter({ hasText: "URL copied" })).toBeVisible()
			release()
			await expect(card.getByRole("heading", { name: preview.title })).toBeVisible()
			await expect(card.getByText(preview.description)).toBeVisible()
			await expect(card.getByText(preview.author)).toBeVisible()
			await expect(card.getByText(preview.siteName)).toBeVisible()
			await expect(card.locator("img")).toBeVisible()
			await expect
				.poll(() => card.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
				.toBeGreaterThan(0)
			await expect(card.getByText("Loading preview…")).toHaveCount(0)
			await expect(card).toHaveAttribute("data-placement", mobile ? "bottom" : "floating")
			await expectWithinViewport(page)
			await expect(card.getByText(/min read/)).toHaveCount(0)
			await page.screenshot({ path: testInfo.outputPath("link-card.png") })

			// Opening the card never saves the target or navigates away from the reader.
			await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
			const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
			const saved = await db
				.select({ id: documents.id })
				.from(documents)
				.where(eq(documents.userId, owner!.id))
			expect(saved).toEqual([{ id }])

			await page.keyboard.press("Escape")
			await expect(card).toHaveCount(0)
			await page.locator(".reader-content a", { hasText: "an unavailable page" }).click()
			await expect(card.getByText("Loading preview…")).toHaveCount(0)
			await expect(card.getByRole("heading", { name: "an unavailable page" })).toBeVisible()
			await expect(card.getByRole("button", { name: "Copy original URL" })).toBeEnabled()
			await expect(card.getByRole("button", { name: "Save to Klipstack" })).toBeEnabled()
			await expect(card.locator("img")).toHaveCount(0)
			await page.evaluate(() => {
				navigator.clipboard.writeText = async () => {
					throw new Error("Clipboard denied")
				}
			})
			await card.getByRole("button", { name: "Copy original URL" }).click()
			await expect(
				page.getByRole("status").filter({ hasText: "Could not copy the URL" }),
			).toBeVisible()
			await card.getByRole("button", { name: "Close" }).click()

			await page.locator(".reader-content a", { hasText: "a page with a broken image" }).click()
			await expect(card.getByRole("heading", { name: preview.title })).toBeVisible()
			await expect(card.locator("img")).toHaveCount(0)
			await page.setViewportSize({ width: 320, height: 360 })
			await expectWithinViewport(page)
			await expect(card.getByRole("button", { name: "Copy original URL" })).toBeInViewport()
			await page.screenshot({ path: testInfo.outputPath("small-link-card.png") })
			await card.getByRole("button", { name: "Close" }).click()
		})
	})
}

test("requires a session and refuses private preview destinations without saving them", async ({
	page,
}) => {
	const endpoint = `/api/link-preview?${new URLSearchParams({ url: "http://127.0.0.1:5433/secret" })}`
	expect((await page.request.get(endpoint)).status()).toBe(401)
	await signupUser(page, "Preview Access")
	const response = await page.request.get(endpoint)
	expect(response.status()).toBe(200)
	expect(await response.json()).toEqual({ preview: null })
	expect(response.headers()["cache-control"]).toContain("no-store")
})

test("closing a loading card prevents stale metadata from reaching the next link", async ({
	page,
}) => {
	test.setTimeout(90_000)
	let release!: () => void
	let started!: () => void
	const ready = new Promise<void>((resolve) => {
		release = resolve
	})
	const requested = new Promise<void>((resolve) => {
		started = resolve
	})
	await page.route("**/api/link-preview?**", async (route) => {
		if (new URL(route.request().url()).searchParams.get("url") === TARGET) {
			started()
			await ready
			await route.fulfill({ json: { preview } })
		} else {
			await route.fulfill({ status: 503, json: { preview: null } })
		}
	})
	await openReader(page)
	await page.locator(".reader-content a", { hasText: "this essay" }).click()
	await requested
	const card = page.getByRole("dialog", { name: "Link", exact: true })
	await expect(card.getByRole("button", { name: "Close" })).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(page.locator(".reader-content a", { hasText: "this essay" })).toBeFocused()
	await page.locator(".reader-content a", { hasText: "an unavailable page" }).click()
	release()
	await expect(card.getByText("Loading preview…")).toHaveCount(0)
	await expect(card.getByRole("heading", { name: "an unavailable page" })).toBeVisible()
	await expect(card.getByRole("heading", { name: preview.title })).toHaveCount(0)
	await expect(card.getByRole("button", { name: "Save to Klipstack" })).toBeEnabled()
})

test("hover starts one shared request and the card clearly shows metadata and image loading", async ({
	page,
}, testInfo) => {
	test.setTimeout(90_000)
	let releasePreview!: () => void
	let releaseImage!: () => void
	const previewReady = new Promise<void>((resolve) => {
		releasePreview = resolve
	})
	const imageReady = new Promise<void>((resolve) => {
		releaseImage = resolve
	})
	let requests = 0
	await page.route("**/api/link-preview?**", async (route) => {
		requests++
		await previewReady
		await route.fulfill({ json: { preview: { ...preview, imageUrl: "/hover-preview-image.png" } } })
	})
	await page.route("**/hover-preview-image.png", async (route) => {
		await imageReady
		await route.fulfill({ path: new URL("../public/icons/icon-512.png", import.meta.url).pathname })
	})
	await openReader(page)
	await stopTime(page)
	const link = page.locator(".reader-content a", { hasText: "this essay" })
	expect(requests).toBe(0)
	await link.hover()
	await page.clock.runFor(200)
	await expect.poll(() => requests).toBe(1)
	const card = page.getByRole("dialog", { name: "Link", exact: true })
	await expect(card).toHaveCount(0)
	await link.click()
	await expect(card.getByRole("status").filter({ hasText: "Loading preview…" })).toBeVisible()
	await expect(card.getByRole("button", { name: "Save to Klipstack" })).toBeEnabled()
	await page.screenshot({ path: testInfo.outputPath("loading-preview.png") })
	expect(requests).toBe(1)
	releasePreview()
	await expect(card.getByRole("heading", { name: preview.title })).toBeVisible()
	await expect(card.getByText("Loading preview…")).toHaveCount(0)
	await expect(card.getByRole("status").filter({ hasText: "Loading image…" })).toBeVisible()
	await expect(card.getByRole("button", { name: "Copy original URL" })).toBeEnabled()
	releaseImage()
	await expect(card.locator("img")).toBeVisible()
	await expect(card.getByText("Loading image…")).toHaveCount(0)
	await page.keyboard.press("Escape")
	await link.click()
	await expect(card.getByRole("heading", { name: preview.title })).toBeVisible()
	await expect(card.getByText("Loading preview…")).toHaveCount(0)
	expect(requests).toBe(1)
})

test("brief mouse passes and touch do not prefetch; keyboard focus does", async ({ page }) => {
	test.setTimeout(90_000)
	let requests = 0
	await page.route("**/api/link-preview?**", async (route) => {
		requests++
		await route.fulfill({ json: { preview } })
	})
	await openReader(page)
	await page.clock.install()
	const link = page.locator(".reader-content a", { hasText: "this essay" })
	await link.dispatchEvent("pointerover", { pointerType: "mouse", buttons: 0 })
	await link.dispatchEvent("pointerout", { pointerType: "mouse", relatedTarget: null })
	await page.clock.runFor(200)
	expect(requests).toBe(0)
	await link.dispatchEvent("pointerover", { pointerType: "touch", buttons: 0 })
	await page.clock.runFor(200)
	expect(requests).toBe(0)
	await page.keyboard.press("Tab")
	await link.focus()
	await expect.poll(() => requests).toBe(1)
	await expect(page.getByRole("dialog", { name: "Link", exact: true })).toHaveCount(0)
	await link.press("Enter")
	await expect(page.getByRole("heading", { name: preview.title })).toBeVisible()
	expect(requests).toBe(1)
})

test("resting the mouse on a link opens its card, which stays while the pointer is near", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await page.route("**/api/link-preview?**", (route) => route.fulfill({ json: { preview } }))
	await openReader(page)
	await stopTime(page)
	const link = page.locator(".reader-content a", { hasText: "this essay" })
	const card = page.getByRole("dialog", { name: "Link", exact: true })
	const away = () => page.mouse.move(5, 5)

	// A pass on the way elsewhere opens nothing.
	await link.hover()
	await page.clock.runFor(200)
	await away()
	await page.clock.runFor(2000)
	await expect(card).toHaveCount(0)

	// Resting on it does, without taking the focus from the reading.
	await link.hover()
	await page.clock.runFor(350)
	await expect(card).toBeVisible()
	await expect(card.getByRole("heading", { name: preview.title })).toBeVisible()
	await expect(card.getByRole("button", { name: "Close" })).not.toBeFocused()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/link-hover-card.png` })

	// Crossing to the card keeps it, however long the pointer stays there.
	const box = (await card.boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.clock.runFor(3000)
	await expect(card).toBeVisible()

	// Leaving both: it waits a moment, in case the pointer comes back, then goes.
	await away()
	await page.clock.runFor(500)
	await expect(card).toBeVisible()
	await page.clock.runFor(600)
	await expect(card).toHaveCount(0)
})

test("a click opens the card at once and pins it, and so does a click inside a hovered one", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await page.route("**/api/link-preview?**", (route) => route.fulfill({ json: { preview } }))
	await openReader(page)
	await stopTime(page)
	const card = page.getByRole("dialog", { name: "Link", exact: true })
	const away = () => page.mouse.move(5, 5)

	// Clicked before the hover would have opened it: it opens now, takes the focus, and stays.
	const link = page.locator(".reader-content a", { hasText: "this essay" })
	await link.hover()
	await link.click()
	await expect(card).toBeVisible()
	await expect(card.getByRole("button", { name: "Close" })).toBeFocused()
	await away()
	await page.clock.runFor(3000)
	await expect(card).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(card).toHaveCount(0)

	// Opened by the mouse, then clicked inside: it stays too.
	await page.locator(".reader-content a", { hasText: "an unavailable page" }).hover()
	await page.clock.runFor(350)
	await expect(card).toBeVisible()
	await card.getByRole("heading").click()
	await away()
	await page.clock.runFor(3000)
	await expect(card).toBeVisible()
})
