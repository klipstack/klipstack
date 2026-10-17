import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, documents, eq, user } from "@klipstack/db"
import { devices, expect, type Page, test } from "@playwright/test"
import { logout, paintedHighlights, signupUser, waitForHydration } from "./helpers"

// Phone emulation (viewport, touch, UA) in the Chromium we run everywhere; drop the WebKit default.
const { defaultBrowserType: _webkit, ...iphone } = devices["iPhone 13"]
test.use(iphone)

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"

async function signup(page: Page) {
	const email = await signupUser(page, "Phone", { verified: false })
	await page.goto("/home")
	await waitForHydration(page)
	return email
}

async function openFixtureInReader(page: Page) {
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule", {
		timeout: 60_000,
	})
}

test("phone: drawer navigation, save dialog, reader sidebar, standalone manifest", async ({
	page,
}) => {
	test.setTimeout(90_000)
	const email = await signup(page)

	// the login page itself must not scroll on a phone
	await page.goto("/login")
	await expect(page).toHaveURL(/\/home$/) // still signed in: bounced to Home
	await logout(page)
	await page.goto("/login")
	const loginScroll = await page.evaluate(() => ({
		scrollHeight: document.documentElement.scrollHeight,
		clientHeight: document.documentElement.clientHeight,
	}))
	expect(loginScroll.scrollHeight).toBeLessThanOrEqual(loginScroll.clientHeight)
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await waitForHydration(page)

	// desktop sidebar hidden, mobile top bar with menu button
	await expect(page.getByRole("complementary")).toHaveCount(0)
	const menu = page.getByRole("button", { name: "Menu" })
	await expect(menu).toBeVisible()
	await menu.click()
	const drawer = page.getByRole("dialog", { name: "Menu" })
	await expect(drawer).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/mobile-drawer.png` })
	// brand and close button share a row; brand label and nav labels share a column
	const geometry = await drawer.evaluate((d) => {
		// Where its name starts: the first text in it (a nav item's name is in a span of its own).
		const textLeft = (el: Element) => {
			const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()
			const range = document.createRange()
			range.selectNode(text as Node)
			return range.getBoundingClientRect().left
		}
		const brand = [...d.querySelectorAll<HTMLElement>('a[href="/home"]')].find(
			(a) => !a.closest("nav"),
		)!
		// The brand is the logo, an SVG whose name is a path placed by a translate: its start in px.
		const nameLeft = (svg: SVGSVGElement) => {
			const name = svg.querySelector<SVGPathElement>(":scope > path")!
			const box = svg.getBoundingClientRect()
			return (
				box.left + name.transform.baseVal[0]!.matrix.e * (box.width / svg.viewBox.baseVal.width)
			)
		}
		const close = d.querySelector('button[aria-label="Close"]') as HTMLElement
		const centerY = (el: HTMLElement) => el.getBoundingClientRect().top + el.offsetHeight / 2
		return {
			brandY: centerY(brand),
			closeY: centerY(close),
			brandX: nameLeft(brand.querySelector("svg")!),
			navX: [...d.querySelectorAll("nav a")].map(textLeft),
		}
	})
	expect(Math.abs(geometry.brandY - geometry.closeY)).toBeLessThan(2)
	for (const x of geometry.navX) expect(Math.abs(x - geometry.brandX)).toBeLessThan(1)
	await drawer.getByRole("link", { name: "Library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(drawer).toBeHidden()

	// no ⌘K on a phone: the drawer opens the command palette
	await menu.click()
	await drawer.getByRole("button", { name: "Search" }).click()
	await expect(drawer).toBeHidden()
	const palette = page.getByRole("dialog", { name: "Command palette" })
	await expect(palette.locator("[cmdk-input]")).toBeFocused()
	// a full-screen view on phones, with a close button instead of a backdrop to tap
	const viewport = page.viewportSize()
	const box = await palette.locator("[cmdk-root]").boundingBox()
	expect(box).toMatchObject({ x: 0, y: 0, width: viewport?.width, height: viewport?.height })
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/mobile-palette.png` })
	await palette.getByRole("button", { name: "Close" }).click()
	await expect(palette).toHaveCount(0)
	await menu.click()
	await drawer.getByRole("button", { name: "Search" }).click()
	await expect(palette.locator("[cmdk-input]")).toBeFocused()
	await page.keyboard.type("starred")
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/starred$/)
	await expect(palette).toHaveCount(0)

	// Escape closes it too
	await menu.click()
	await expect(drawer).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(drawer).toBeHidden()

	// top bar: the view's name, a search button that opens the search page on this view, save button
	await page.goto("/library")
	await waitForHydration(page)
	const bar = page.locator("header").first()
	await expect(bar.getByRole("heading", { level: 1 })).toHaveText("Library")
	// fields are at least 16px on phones so iOS does not zoom into them
	await menu.click()
	await expect(drawer.getByRole("link", { name: "Library", exact: true })).toHaveText("Library")
	await expect(drawer.getByTestId("unread-badge")).toHaveCount(0)
	await drawer.getByRole("button", { name: "Search" }).click()
	const paletteInput = palette.locator("[cmdk-input]")
	await expect(paletteInput).toBeFocused()
	const paletteFont = await paletteInput.evaluate((el) => getComputedStyle(el).fontSize)
	expect(Number.parseFloat(paletteFont)).toBeGreaterThanOrEqual(16)
	await page.keyboard.type("makers")
	await palette.getByRole("option", { name: "Search articles for “makers”" }).click()
	await expect(page).toHaveURL(/\/search\?q=makers$/)
	// on the search page the bar is the field, with the query in it, editable and clearable
	const field = bar.getByRole("searchbox", { name: "Search" })
	await expect(field).toHaveValue("makers")
	const fieldFont = await field.evaluate((el) => getComputedStyle(el).fontSize)
	expect(Number.parseFloat(fieldFont)).toBeGreaterThanOrEqual(16)
	// the layer that paints the query's colours is set in the same type
	const paint = bar.getByTestId("search-field-paint")
	await expect(paint).toHaveText("makers")
	const type = (el: Element) => {
		const { fontSize, fontFamily, fontWeight, letterSpacing } = getComputedStyle(el)
		return { fontSize, fontFamily, fontWeight, letterSpacing }
	}
	expect(await paint.evaluate(type)).toEqual(await field.evaluate(type))
	await expect(bar.getByRole("heading", { level: 1 })).toHaveCount(0)
	// the view's search button opens it looking at that view, ready for the words
	await page.goto("/starred")
	await waitForHydration(page)
	await bar.getByRole("link", { name: "Search" }).click()
	await expect(page).toHaveURL(/\/search\?q=is%3Astarred%20$/)
	await expect(field).toBeFocused()
	await expect(field).toHaveValue("is:starred ")
	await page.keyboard.type("makers")
	await page.keyboard.press("Enter")
	await expect(page).toHaveURL(/\/search\?q=is%3Astarred\+makers$/)
	await expect(page.getByTestId("search-chip-starred")).toHaveAttribute("aria-current", "true")
	// one ✕, the field's own, to clear it; leaving the search is the back arrow's, and it goes back
	// to the view the search was opened from, search after search
	await expect(bar.getByRole("button", { name: "Close" })).toHaveCount(0)
	await expect(bar.getByRole("link", { name: "Clear search" })).toBeVisible()
	await bar.getByRole("button", { name: "Back" }).click()
	await expect(page).toHaveURL(/\/starred$/)
	// the bar names the library; its tabs say which view this is, and switch to another
	const tabs = page.getByRole("navigation", { name: "Library views" })
	await expect(bar.getByRole("heading", { level: 1 })).toHaveText("Library")
	await expect(tabs.getByRole("link", { name: "Starred" })).toHaveAttribute("aria-current", "page")
	await tabs.getByRole("link", { name: "Archive" }).click()
	await expect(page).toHaveURL(/\/archive$/)
	await expect(tabs.getByRole("link", { name: "Archive" })).toHaveAttribute("aria-current", "page")

	// no horizontal overflow on the library
	await page.goto("/library")
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/mobile-library.png` })
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	)
	expect(overflow).toBeLessThanOrEqual(0)

	// save dialog works with the on-screen keyboard flow
	await waitForHydration(page)
	await page.getByRole("button", { name: "Save link" }).click()
	await expect(page.getByRole("dialog", { name: "Save a link" })).toBeVisible()
	await page.keyboard.press("Escape")

	// reader: notes and highlights sidebar overlays on a phone
	await openFixtureInReader(page)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/mobile-reader.png` })
	await page.getByTestId("toggle-sidebar").click()
	await expect(page.getByRole("complementary", { name: "Notes and highlights" })).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/mobile-reader-sidebar.png` })
	const readerOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	)
	expect(readerOverflow).toBeLessThanOrEqual(0)

	// installed as a PWA it runs without browser chrome
	const manifest = (await (await page.request.get("/manifest.webmanifest")).json()) as {
		display: string
		start_url: string
	}
	expect(manifest.display).toBe("standalone")
	expect(manifest.start_url).toBe("/home")
	const metas = await page.evaluate(() =>
		Array.from(document.querySelectorAll('meta[name$="web-app-capable"]')).map((m) =>
			m.getAttribute("content"),
		),
	)
	expect(metas).toEqual(["yes", "yes"])

	// the list scrolls inside its own box; the page and the top bar stay put
	for (let i = 0; i < 8; i++)
		await page.request.post("/api/documents", { data: { url: `https://example.com/tall/${i}` } })
	await page.goto("/library")
	await waitForHydration(page)
	await expect(page.getByRole("button", { name: "Star" }).first()).toBeVisible()

	// phones show a two-column grid unless told otherwise; the bar switches to the list and back
	const cards = page.locator("ul[data-layout]")
	await expect(cards).toHaveAttribute("data-layout", "auto")
	expect(
		await cards.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
	).toBe(2)
	await bar.getByRole("button", { name: "List view" }).click()
	await expect(cards).toHaveAttribute("data-layout", "list")
	expect(await cards.evaluate((el) => getComputedStyle(el).display)).toBe("flex")
	await bar.getByRole("button", { name: "Grid view" }).click()
	await expect(cards).toHaveAttribute("data-layout", "grid")
	await bar.getByRole("button", { name: "List view" }).click()
	await expect(cards).toHaveAttribute("data-layout", "list")
	const scroller = () => document.querySelector("main")?.parentElement as HTMLElement
	const scrolling = await page.evaluate((getScroller) => {
		const box = new Function(`return (${getScroller})()`)() as HTMLElement
		const bar = document.querySelector("header") as HTMLElement
		const before = bar.getBoundingClientRect().top
		box.scrollTop = 300
		return {
			pageScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
			boxScrolled: box.scrollTop,
			barMoved: bar.getBoundingClientRect().top !== before,
		}
	}, scroller.toString())
	expect(scrolling.pageScrollable).toBe(false)
	expect(scrolling.boxScrolled).toBeGreaterThan(0)
	expect(scrolling.barMoved).toBe(false)

	// pull down at the top to refresh
	const refreshed = page.waitForRequest((r) => r.url().includes("/library.data"))
	await page.evaluate((getScroller) => {
		const box = new Function(`return (${getScroller})()`)() as HTMLElement
		box.scrollTop = 0
		const touch = (type: string, y: number) =>
			box.dispatchEvent(
				new TouchEvent(type, {
					bubbles: true,
					touches:
						type === "touchend"
							? []
							: [new Touch({ identifier: 1, target: box, clientX: 100, clientY: y })],
				}),
			)
		touch("touchstart", 200)
		touch("touchmove", 300)
		touch("touchmove", 400)
		touch("touchend", 400)
	}, scroller.toString())
	await refreshed
	await expect(page.getByTestId("pull-to-refresh")).toHaveAttribute("data-state", "idle", {
		timeout: 10_000,
	})
})

test("phone: the selection's and a new highlight's toolbars are sheets at the bottom of the screen", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await signup(page)
	await openFixtureInReader(page)
	// Selecting text offers Highlight in a sheet at the bottom of the screen on touch devices, clear
	// of the OS selection menu; so is the new highlight's own toolbar.
	await page.evaluate(() => {
		const walker = document.createTreeWalker(
			document.querySelector(".reader-content") as Node,
			NodeFilter.SHOW_TEXT,
		)
		let node = walker.nextNode()
		while (node && !(node.textContent ?? "").includes("two types of schedule"))
			node = walker.nextNode()
		if (!node) throw new Error("text not found")
		const start = (node.textContent ?? "").indexOf("two types")
		const range = document.createRange()
		range.setStart(node, start)
		range.setEnd(node, start + 21)
		const sel = window.getSelection()
		sel?.removeAllRanges()
		sel?.addRange(range)
	})
	const selected = page.getByRole("dialog", { name: "Selected text" })
	await expect(selected).toHaveAttribute("data-placement", "bottom")
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		selected.getByRole("button", { name: "Highlight", exact: true }).tap(),
	])
	const editor = page.getByRole("dialog", { name: "Edit highlight" })
	await expect(editor).toBeVisible()
	await expect(editor).toHaveAttribute("data-placement", "bottom")
	const [editorBox, viewport] = await Promise.all([editor.boundingBox(), page.viewportSize()])
	expect(
		editorBox && viewport && Math.abs(editorBox.y + editorBox.height - viewport.height),
	).toBeLessThan(2)
	// The colors have the first row to themselves, Close level with them; the other buttons share
	// the second.
	const [orange, close, note, share, remove] = await Promise.all([
		editor.getByRole("button", { name: "Orange" }).boundingBox(),
		editor.getByRole("button", { name: "Close" }).boundingBox(),
		editor.getByRole("button", { name: "Add note" }).boundingBox(),
		editor.getByRole("button", { name: "Share", exact: true }).boundingBox(),
		editor.getByRole("button", { name: "Delete" }).boundingBox(),
	])
	expect(close!.y).toBe(orange!.y)
	expect(note!.y).toBeGreaterThanOrEqual(orange!.y + orange!.height)
	expect(share!.y).toBe(note!.y)
	expect(remove!.y).toBe(note!.y)
	await editor.getByRole("button", { name: "Close" }).click()
	await expect(editor).toBeHidden()
})

const JOEL_FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/joelonsoftware-joel-test.html",
)
const JOEL_URL = "https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/"
const JOEL_TITLE = "The Joel Test: 12 Steps to Better Code"
const QUOTE = "There are two types of schedule"

test("phone: a highlight note links to another article from the bottom sheet", async ({ page }) => {
	test.setTimeout(180_000)
	await signup(page)
	await page.request.post("/api/documents", {
		data: { url: JOEL_URL, html: readFileSync(JOEL_FIXTURE, "utf8") },
	})
	await openFixtureInReader(page)
	const id = new URL(page.url()).pathname.split("/").pop() as string
	const hl = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: "There are two types of schedule" },
	})
	expect(hl.status()).toBe(201)
	const { highlight } = (await hl.json()) as { highlight: { id: string } }
	// Open at the highlight: the reader scrolls it into view, so there is something to tap at all.
	// Where it falls on the page depends on font metrics, and off screen nothing can hit it. Only the
	// hash differs from the page already open, so reload: a hash change alone loads no highlights.
	await page.goto(`/read/${id}#h=${highlight.id}`)
	await page.reload()
	await expect(page.locator(".reader-content")).toContainText(QUOTE, { timeout: 60_000 })
	await waitForHydration(page)
	// The highlight has to be painted before a tap can land on it.
	await expect.poll(async () => (await paintedHighlights(page)).length).toBeGreaterThan(0)
	// The reader scrolls to it smoothly: a tap while the page moves stops the scroll, not a click.
	let lastY = -1
	await expect
		.poll(async () => {
			const y = await page.evaluate(() => window.scrollY)
			const still = y === lastY
			lastY = y
			return still
		})
		.toBe(true)

	// No margin on a phone: the note editor is a sheet at the bottom of the screen.
	const point = await page.evaluate((needle) => {
		const root = document.querySelector(".reader-content") as HTMLElement
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
		for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
			const i = n.data.indexOf(needle)
			if (i < 0) continue
			const r = document.createRange()
			r.setStart(n, i + 3)
			r.setEnd(n, i + 8)
			const b = r.getBoundingClientRect()
			return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
		}
		throw new Error("quote not found")
	}, QUOTE)
	expect(point.y).toBeGreaterThan(0)
	await page.touchscreen.tap(point.x, point.y)
	const toolbar = page.getByRole("dialog", { name: "Edit highlight" })
	await expect(toolbar).toBeVisible()
	await toolbar.getByRole("button", { name: "Add note" }).tap()
	const editor = page.getByRole("dialog", { name: "Highlight note" })
	await expect(editor).toHaveAttribute("data-placement", "sheet")
	await expect(editor.getByRole("textbox")).toBeFocused()

	// The point of the button: no reaching for `[` on a phone keyboard.
	await page.keyboard.type("See ")
	await editor.getByTestId("link-article").tap()
	await page.keyboard.type("Joel")
	const menu = page.getByTestId("note-link-menu")
	const option = menu.getByTestId("note-link-option").first()
	await expect(option).toContainText(JOEL_TITLE)
	const menuBox = (await menu.boundingBox()) as { y: number; height: number }
	const viewport = (await page.evaluate(() => window.innerHeight)) as number
	expect(menuBox.y).toBeGreaterThanOrEqual(0)
	expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport)

	await option.tap()
	await expect(editor.getByTestId("doc-chip")).toHaveText(JOEL_TITLE)
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		editor.getByRole("button", { name: "Save" }).tap(),
	])
	await page.getByTestId("toggle-sidebar").tap()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	// In the sidebar the link is text: the row itself is what goes to the highlight.
	await expect(sidebar.getByTestId("doc-link-text")).toHaveText(JOEL_TITLE)
})

test("phone: list rows show a square of the picture beside the description", async ({ page }) => {
	const email = await signup(page)
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing phone test user")
	// An inline image: nothing to fetch.
	const image =
		"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='10'><rect width='16' height='10' fill='teal'/></svg>"
	const article = (n: number, title: string) => ({
		userId: owner.id,
		status: "ready" as const,
		readingMinutes: 5,
		title,
		description: "What the article is about, in a sentence or two.",
		sourceUrl: `https://example.com/${email}/${n}`,
		urlHash: `${email}/${n}`,
		createdAt: new Date(Date.now() - n * 1000),
	})
	await db
		.insert(documents)
		.values([
			{ ...article(1, "Saved with a picture"), leadImageUrl: image },
			article(2, "Saved without a picture"),
		])
	await page.goto("/library")
	await waitForHydration(page)
	const bar = page.locator("header").first()
	await bar.getByRole("button", { name: "List view" }).click()
	await expect(page.locator("ul[data-layout]")).toHaveAttribute("data-layout", "list")

	const rows = page.getByRole("listitem")
	const withPicture = rows.filter({ hasText: "Saved with a picture" })
	const pictures = withPicture.locator("img:visible")
	await expect(pictures).toHaveCount(1)
	const box = await pictures.boundingBox()
	expect(box?.width).toBe(64)
	expect(box?.height).toBe(64)
	// Without one, no placeholder: the row is text only.
	const without = rows.filter({ hasText: "Saved without a picture" })
	await expect(without.locator("img:visible")).toHaveCount(0)
	await expect(without.getByTestId("article-image-placeholder")).toBeHidden()

	// Selecting: still one box per row, where the card's buttons were.
	await bar.getByRole("button", { name: "Select" }).click()
	await expect(withPicture.getByRole("checkbox")).toHaveCount(1)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/phone-list-pictures.png` })
})
