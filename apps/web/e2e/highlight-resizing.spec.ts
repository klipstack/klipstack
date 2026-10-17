import { randomUUID } from "node:crypto"
import { db, documents, documentVersions, eq, highlights, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { paintedHighlights, signupUser, waitForHydration } from "./helpers"

// Network-failure tests must intercept the request itself, outside the offline service worker.
test.use({ serviceWorkers: "block" })

const html = `<p>Alpha bravo <strong>charlie delta</strong> echo <a href="https://example.com/linked">foxtrot golf</a> hotel. India juliet kilo lima november oscar papa quebec romeo sierra tango uniform victor whiskey.</p><p>Second paragraph has é and 👩🏽‍💻 plus repeated words. Alpha bravo charlie delta echo.</p><p dir="rtl">مرحبا بالعالم هذا نص عربي للاختبار وفيه <span dir="ltr">mixed English words</span> ونهاية.</p><pre>${"Long code line ".repeat(30)}</pre>${Array.from({ length: 15 }, (_, i) => `<p>Paragraph ${i}: ${"More readable text for scrolling. ".repeat(12)}</p>`).join("")}`
const text = html.replace(/<[^>]*>/g, "")
let ownerId: string | null = null
let docId: string
let versionId: string
let highlightId: string
const START = text.indexOf("charlie")
const END = text.indexOf(" hotel")

async function signup(page: Page) {
	const email = await signupUser(page, "Resize", { verified: false })
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	ownerId = owner!.id
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner!.id,
			sourceUrl: "https://example.com/resize",
			urlHash: randomUUID(),
			title: "Resize fixture",
			status: "ready",
		})
		.returning()
	docId = doc!.id
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: docId,
			version: 1,
			html,
			text,
			textHash: "test",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning()
	versionId = version!.id
	await db.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, docId))
}
async function seed(page: Page, start = START, end = END, note: string | null = null, color = 3) {
	const res = await page.request.post(`/documents/${docId}/highlights`, {
		data: { intent: "create", start, end, exact: text.slice(start, end), color, note },
	})
	expect(res.status()).toBe(201)
	return (await res.json()).highlight.id as string
}
async function open(page: Page) {
	await page.goto(`/read/${docId}`)
	await waitForHydration(page)
	await expect.poll(async () => (await paintedHighlights(page)).length).toBe(1)
}
/** Use browser layout to drive real mouse events at canonical text offsets. */
async function point(page: Page, offset: number) {
	return page.locator(".reader-content").evaluate((root, value) => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
		let at = 0
		while (walker.nextNode()) {
			const node = walker.currentNode as Text
			if (value >= at && value < at + node.length) {
				const range = document.createRange()
				range.setStart(node, value - at)
				range.collapse(true)
				let rect = range.getClientRects()[0]
				if (!rect?.height) {
					range.setEnd(node, Math.min(node.length, value - at + 1))
					rect = range.getClientRects()[0]
				}
				if (!rect) throw new Error("no text rect")
				const x = rect.x
				range.setEnd(node, Math.min(node.length, value - at + 1))
				const glyph = range.getClientRects()[0] ?? rect
				return { x, y: (glyph.top + glyph.bottom) / 2 }
			}
			at += node.length
		}
		throw new Error("offset outside article")
	}, offset)
}
const handle = (page: Page, endpoint: "start" | "end") =>
	page.getByRole("button", { name: `Adjust highlight ${endpoint}` })
const toolbar = (page: Page) => page.getByRole("dialog", { name: "Edit highlight" })
async function hover(page: Page, at = START + 3) {
	const p = await point(page, at)
	await page.mouse.move(p.x, p.y)
	await expect(handle(page, "start")).toBeVisible()
}
async function down(page: Page, endpoint: "start" | "end") {
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-resize-state", "idle")
	const control = handle(page, endpoint)
	await expect(control).toBeVisible()
	const box = (await control.boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await page.mouse.down()
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute(
		"data-resize-state",
		"pointer",
	)
}
async function moveTo(page: Page, offset: number) {
	const p = await point(page, offset)
	await page.mouse.move(p.x, p.y, { steps: 6 })
}
function response(page: Page) {
	return page.waitForResponse(
		(r) =>
			r.url().includes("/highlights") &&
			r.request().method() === "POST" &&
			r.request().postDataJSON()?.intent === "resize",
	)
}
async function saved() {
	return db.query.highlights.findFirst({ where: eq(highlights.id, highlightId) })
}
/** The painted highlights' text, overlapping ones included. */
const paint = paintedHighlights

test.afterEach(async () => {
	if (ownerId) await db.delete(user).where(eq(user.id, ownerId))
	ownerId = null
})

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 800 })
	await signup(page)
	highlightId = await seed(page)
	await open(page)
})

for (const endpoint of ["start", "end"] as const) {
	test(`${endpoint} handle stays grabbable after hovering its knob`, async ({ page }) => {
		await page.clock.install()
		await hover(page)
		const control = handle(page, endpoint)
		const box = (await control.boundingBox())!
		const x = box.x + box.width / 2
		const y = endpoint === "start" ? box.y + 8 : box.y + box.height - 8
		await page.mouse.move(x, y)
		// Remain on the knob beyond the 150 ms highlight-to-handle hover grace period.
		await page.clock.runFor(300)
		await expect(control).toBeVisible()
		expect(
			await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor, {
				x,
				y,
			}),
		).toBe("col-resize")
		await page.mouse.down()
		await expect(page.locator("[data-resize-handles]")).toHaveAttribute(
			"data-resize-state",
			"pointer",
		)
		// Keep the original grab offset when dragging from the knob outside the text line.
		const target = await point(page, endpoint === "start" ? 0 : text.indexOf(" echo"))
		await page.mouse.move(target.x, target.y + y - (box.y + box.height / 2), { steps: 6 })
		const save = response(page)
		await page.mouse.up()
		expect((await save).status()).toBe(200)
		await expect
			.poll(async () => (await saved())?.exact)
			.toBe(endpoint === "start" ? text.slice(0, END) : "charlie delta")
		await page.mouse.move(0, 0)
		await page.clock.runFor(300)
		await expect(control).toBeHidden()
	})
}

test("hover handles, both endpoints, live paint, one save and persistent identity", async ({
	page,
}) => {
	const before = await saved()
	const requests: unknown[] = []
	page.on("request", (r) => {
		if (r.url().includes("/highlights") && r.method() === "POST") requests.push(r.postDataJSON())
	})
	await hover(page)
	await expect(toolbar(page)).toBeHidden()
	await expect(page.locator(".reader-content")).not.toHaveAttribute("data-focus")
	await down(page, "end")
	await moveTo(page, text.indexOf(" echo"))
	await expect.poll(() => paint(page)).toEqual(["charlie delta"])
	await expect(toolbar(page)).toBeHidden()
	const save = response(page)
	await page.mouse.up()
	expect((await save).status()).toBe(200)
	await expect.poll(async () => (await saved())?.exact).toBe("charlie delta")
	await expect(toolbar(page)).toBeHidden()
	expect(requests).toHaveLength(1)
	await hover(page)
	await down(page, "start")
	await moveTo(page, 0)
	const next = response(page)
	await page.mouse.up()
	await next
	await expect.poll(async () => (await saved())?.exact).toBe("Alpha bravo charlie delta")
	await page.reload()
	await waitForHydration(page)
	await expect.poll(() => paint(page)).toEqual(["Alpha bravo charlie delta"])
	expect(await saved()).toMatchObject({
		id: before!.id,
		createdAt: before!.createdAt,
		color: before!.color,
	})
	expect(requests).toHaveLength(2)
})

test("toolbar mode, overlap and note paint survive shrinking across links and paragraphs", async ({
	page,
}) => {
	await page.request.post(`/documents/${docId}/highlights`, {
		data: { intent: "update", id: highlightId, note: "A retained note" },
	})
	await seed(page, START + 8, END + 7, null, 1)
	await page.reload()
	await waitForHydration(page)
	await hover(page)
	const p = await point(page, START + 2)
	await page.mouse.click(p.x, p.y)
	await expect(toolbar(page)).toBeVisible()
	await down(page, "end")
	const target = text.indexOf(" plus repeated")
	await moveTo(page, target)
	await expect.poll(() => paint(page)).toContain(text.slice(START, target))
	await expect.poll(() => page.evaluate(() => CSS.highlights.get("klip-note")?.size ?? 0)).toBe(0)
	const save = response(page)
	await page.mouse.up()
	await save
	await expect(toolbar(page)).toBeVisible()
	await expect.poll(() => paint(page)).toContain(text.slice(START + 8, END + 7))
	await expect
		.poll(() =>
			page.evaluate(() => [...(CSS.highlights.get("klip-note") ?? [])].map((r) => r.toString())),
		)
		.toEqual([text.slice(START, target)])
	expect(await saved()).toMatchObject({ note: "A retained note" })
	await page.getByTestId("toggle-sidebar").click()
	await expect(page.getByRole("complementary", { name: "Notes and highlights" })).toContainText(
		text.slice(START, target),
	)
})

test("no-op, Escape, pointer cancellation and blur never save or follow links", async ({
	page,
}) => {
	const requests: string[] = []
	page.on("request", (r) => {
		if (r.url().includes("/highlights") && r.method() === "POST") requests.push(r.url())
	})
	await hover(page)
	await down(page, "end")
	await page.mouse.up()
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-resize-state", "idle")
	// Still under the pointer, the handles outlast the 150 ms grace that follows leaving them.
	await page.waitForTimeout(300)
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-resize-state", "idle")
	for (const cancel of ["escape", "pointercancel", "blur"]) {
		await hover(page)
		await down(page, "end")
		await moveTo(page, text.indexOf(" golf"))
		if (cancel === "escape") await page.keyboard.press("Escape")
		else if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")))
		else await handle(page, "end").dispatchEvent("pointercancel")
		await page.mouse.up()
		await expect.poll(() => paint(page)).toEqual([text.slice(START, END)])
		await expect(page).toHaveURL(`/read/${docId}`)
	}
	expect(requests).toHaveLength(0)
	await page.mouse.move(10, 500)
	await expect(handle(page, "start")).toBeHidden()
	await hover(page)
	await page.keyboard.press("Escape")
	await expect(handle(page, "start")).toBeHidden()
	const p = await point(page, START + 4)
	await page.mouse.move(p.x, p.y)
	await expect(handle(page, "start")).toBeHidden()
	await page.mouse.move(10, 500)
	await hover(page)
})

test("keyboard sidebar access, apply, cancel, Tab and reader shortcut guards", async ({ page }) => {
	await page.getByTestId("toggle-sidebar").click()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await sidebar.getByRole("button", { name: text.slice(START, END), exact: true }).press("Enter")
	await expect(handle(page, "start")).toBeFocused()
	await page.keyboard.press("e")
	await page.keyboard.press("Delete")
	await page.keyboard.press("Enter")
	await page.keyboard.press("ArrowRight")
	await page.keyboard.press("Escape")
	await expect.poll(() => paint(page)).toEqual([text.slice(START, END)])
	await page.keyboard.press("Space")
	await page.keyboard.press("ArrowRight")
	await page.keyboard.press("Tab")
	await expect(handle(page, "end")).toBeFocused()
	await expect.poll(() => paint(page)).toEqual([text.slice(START, END)])
	await page.keyboard.press("Enter")
	await page.keyboard.press("ArrowLeft")
	const save = response(page)
	await page.keyboard.press("Enter")
	await save
	await expect.poll(async () => (await saved())?.endOffset).toBe(END - 1)
	await expect(page).toHaveURL(`/read/${docId}`)
	const doc = await db.query.documents.findFirst({ where: eq(documents.id, docId) })
	expect(doc).toMatchObject({ deletedAt: null, archivedAt: null })
})

test("slow save locks mutations; failed save rolls back and retries", async ({ page }) => {
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	let first = true
	await page.route(`**/documents/${docId}/highlights*`, async (route) => {
		if (route.request().postDataJSON()?.intent !== "resize") return route.continue()
		if (first) {
			first = false
			await gate
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({ ok: false, error: { code: "network", message: "Down." } }),
			})
		} else await route.continue()
	})
	await hover(page)
	const p = await point(page, START + 2)
	await page.mouse.click(p.x, p.y)
	await down(page, "end")
	await moveTo(page, text.indexOf(" echo"))
	await page.mouse.up()
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-resize-state", "saving")
	await expect(toolbar(page).getByRole("button", { name: "Delete highlight" })).toBeDisabled()
	await handle(page, "start").press("Enter")
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-resize-state", "saving")
	release()
	await expect(page.getByRole("alert")).toContainText("Could not confirm")
	await expect.poll(() => paint(page)).toEqual([text.slice(START, END)])
	await page.getByRole("button", { name: "Retry", exact: true }).click()
	await expect.poll(async () => (await saved())?.exact).toBe("charlie delta")
	await expect(page.getByRole("alert")).toBeHidden()
})

test("native mouse selection creates a highlight with working resize controls", async ({
	page,
}, testInfo) => {
	const from = await point(page, 0)
	const to = await point(page, START - 1)
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 8 })
	await page.mouse.up()
	// Nothing is highlighted until Highlight is chosen in the selection's toolbar.
	const createdResponse = page.waitForResponse(
		(r) =>
			r.url().includes("/highlights") &&
			r.request().method() === "POST" &&
			r.request().postDataJSON()?.intent === "create",
	)
	await page
		.getByRole("dialog", { name: "Selected text" })
		.getByRole("button", { name: "Highlight", exact: true })
		.click()
	await createdResponse
	await expect(toolbar(page)).toBeVisible()
	await expect(handle(page, "end")).toBeVisible()
	await down(page, "end")
	await moveTo(page, 5)
	const save = response(page)
	await page.mouse.up()
	await save
	await expect.poll(() => paint(page)).toContain("Alpha")
	await expect(toolbar(page)).toBeVisible()
	await page.screenshot({ path: testInfo.outputPath("resize-controls.png") })
})

test("RTL boundaries follow text direction and keyboard movement preserves graphemes", async ({
	page,
}) => {
	await db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, highlightId))
	const rtlStart = text.indexOf("مرحبا")
	const rtlEnd = text.indexOf(" للاختبار")
	highlightId = await seed(page, rtlStart, rtlEnd)
	await open(page)
	await hover(page, rtlStart + 2)
	const a = (await handle(page, "start").boundingBox())!
	const b = (await handle(page, "end").boundingBox())!
	expect(a.x).toBeGreaterThan(b.x)
	await down(page, "start")
	await moveTo(page, rtlStart + 6)
	const save = response(page)
	await page.mouse.up()
	await save
	await expect.poll(async () => (await saved())?.startOffset).toBe(rtlStart + 6)

	await db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, highlightId))
	const start = text.indexOf("é")
	const end = text.indexOf(" plus repeated")
	highlightId = await seed(page, start, end)
	await open(page)
	await hover(page, start + 4)
	await handle(page, "end").focus()
	await page.keyboard.press("Enter")
	await page.keyboard.press("ArrowLeft")
	await expect.poll(() => paint(page)).toEqual([text.slice(start, text.indexOf("👩"))])
	await page.keyboard.press("Escape")
	await handle(page, "start").focus()
	await page.keyboard.press("Enter")
	await page.keyboard.press("ArrowRight")
	await expect.poll(() => paint(page)).toEqual([text.slice(start + 2, end)])
	await page.keyboard.press("Escape")
})

test("geometry follows reflow, nested clipping and page scrolling", async ({ page }) => {
	await hover(page)
	const checkStart = async () => {
		const p = await point(page, START)
		const box = (await handle(page, "start").boundingBox())!
		expect(Math.abs(box.x + box.width / 2 - p.x)).toBeLessThan(2)
		expect(Math.abs(box.y + box.height / 2 - p.y)).toBeLessThan(2)
	}
	const p = await point(page, START + 5)
	await page.mouse.click(p.x, p.y)
	await expect(toolbar(page)).toBeVisible()
	await page.setViewportSize({ width: 820, height: 800 })
	await expect.poll(async () => (await handle(page, "start").boundingBox())?.x).toBeDefined()
	await checkStart()
	await page.locator(".reader-content").evaluate((root) => {
		;(root as HTMLElement).style.fontSize = "24px"
	})
	await expect
		.poll(async () => {
			const p = await point(page, START)
			const box = (await handle(page, "start").boundingBox())!
			return Math.abs(box.y + box.height / 2 - p.y)
		})
		.toBeLessThan(2)
	await page.locator(".reader-content").evaluate(async (root) => {
		const image = new Image(20, 80)
		image.alt = ""
		image.style.cssText = "display:block;width:20px;height:80px"
		root.prepend(image)
		image.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
		await image.decode()
	})
	await expect
		.poll(async () => {
			const p = await point(page, START)
			const box = (await handle(page, "start").boundingBox())!
			return Math.abs(box.y + box.height / 2 - p.y)
		})
		.toBeLessThan(2)
	await page.evaluate(() => window.scrollTo(0, 600))
	await expect(handle(page, "start")).toBeHidden()
	await page.evaluate(() => window.scrollTo(0, 0))
	await expect(handle(page, "start")).toBeVisible()

	await db.update(highlights).set({ deletedAt: new Date() }).where(eq(highlights.id, highlightId))
	const code = text.indexOf("Long code")
	highlightId = await seed(page, code, code + 250)
	await open(page)
	await hover(page, code + 3)
	await expect(handle(page, "start")).toBeVisible()
	await expect(handle(page, "end")).toBeHidden()
	await page.locator("pre").evaluate((el) => {
		el.scrollLeft = el.scrollWidth
	})
	await expect(handle(page, "start")).toBeHidden()
})

test("edge scrolling stops at cancellation and keeps the last valid endpoint outside text", async ({
	page,
}) => {
	await hover(page)
	await down(page, "end")
	await moveTo(page, text.indexOf(" echo"))
	await page.mouse.move(4, 450)
	await expect.poll(() => paint(page)).toEqual(["charlie delta"])
	const root = await page.locator(".reader-content").boundingBox()
	await page.mouse.move(root!.x + root!.width / 2, 785, { steps: 6 })
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(30)
	await page.keyboard.press("Escape")
	await page.mouse.up()
	await expect(page.locator("html")).not.toHaveAttribute("data-highlight-dragging")
	const y = await page.evaluate(() => window.scrollY)
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
	expect(await page.evaluate(() => window.scrollY)).toBe(y)
	await expect.poll(() => paint(page)).toEqual([text.slice(START, END)])
})

/**
 * Loads the article's data again while the mouse stays captured on a handle, as coming back to
 * the tab does. The page's own changes (a star, a highlight) no longer load it.
 */
const refreshData = (page: Page) =>
	Promise.all([
		page.waitForResponse((r) => r.url().includes(`/read/${docId}.data`)),
		page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
	])

test("loader refresh keeps the draft; concurrent anchor changes reject instead of overwriting", async ({
	page,
}) => {
	await hover(page)
	await down(page, "end")
	await moveTo(page, text.indexOf(" echo"))
	await refreshData(page)
	await expect.poll(() => paint(page)).toEqual(["charlie delta"])
	await db
		.update(highlights)
		.set({ startOffset: 0, exact: text.slice(0, END) })
		.where(eq(highlights.id, highlightId))
	const save = response(page)
	await page.mouse.up()
	expect((await save).status()).toBe(409)
	await expect(page.getByRole("alert")).toContainText("changed elsewhere")
	await expect.poll(() => paint(page)).toEqual([text.slice(0, END)])
})

test("a lost success response is reconciled without a second write", async ({ page }) => {
	let attempts = 0
	await page.route(`**/documents/${docId}/highlights*`, async (route) => {
		if (route.request().postDataJSON()?.intent !== "resize") return route.continue()
		attempts++
		await route.fetch()
		await route.abort("failed")
	})
	await hover(page)
	await down(page, "end")
	await moveTo(page, text.indexOf(" echo"))
	await page.mouse.up()
	await expect(page.getByRole("status")).toContainText("Highlight saved: charlie delta")
	await expect(page.getByRole("alert")).toBeHidden()
	await expect.poll(() => paint(page)).toEqual(["charlie delta"])
	expect(attempts).toBe(1)
})

for (const change of ["deletion", "version"] as const) {
	test(`${change} cancels an uncommitted drag and cleans up capture`, async ({ page }) => {
		let resizes = 0
		page.on("request", (r) => {
			if (
				r.url().includes("/highlights") &&
				r.method() === "POST" &&
				r.postDataJSON()?.intent === "resize"
			)
				resizes++
		})
		await hover(page)
		await down(page, "end")
		await moveTo(page, text.indexOf(" echo"))
		if (change === "deletion")
			await db
				.update(highlights)
				.set({ deletedAt: new Date() })
				.where(eq(highlights.id, highlightId))
		else {
			const [version] = await db
				.insert(documentVersions)
				.values({
					documentId: docId,
					version: 2,
					html,
					text,
					textHash: "new",
					extractor: "test",
					extractorVersion: "2",
				})
				.returning()
			await db
				.update(documents)
				.set({ currentVersionId: version!.id })
				.where(eq(documents.id, docId))
		}
		await refreshData(page)
		await expect(page.locator("html")).not.toHaveAttribute("data-highlight-dragging")
		await page.mouse.up()
		await expect(page.locator("[data-resize-handles]")).toHaveCount(0)
		expect(resizes).toBe(0)
		if (change === "version") {
			await hover(page)
			await expect.poll(() => paint(page)).toEqual([text.slice(START, END)])
		}
	})
}

test("smallest overlap owns the handles; touch pointers cannot start a custom drag", async ({
	page,
}) => {
	const smallId = await seed(page, START + 2, START + 7, null, 1)
	await page.reload()
	await waitForHydration(page)
	await expect.poll(() => paint(page)).toContain(text.slice(START + 2, START + 7))
	await hover(page, START + 4)
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-highlight-id", smallId)
	await handle(page, "start").dispatchEvent("pointerdown", {
		pointerType: "touch",
		pointerId: 10,
		button: 0,
	})
	await expect(page.locator("[data-resize-handles]")).toHaveAttribute("data-resize-state", "idle")
	await down(page, "end")
	await moveTo(page, START + 10)
	const save = response(page)
	await page.mouse.up()
	expect((await save).request().postDataJSON().id).toBe(smallId)
	await expect.poll(() => paint(page)).toContain(text.slice(START, END))
})
