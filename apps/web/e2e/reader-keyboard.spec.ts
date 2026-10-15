import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PASSAGE = "There are two types of schedule"

async function open(page: Page, features: "ai"[] = []) {
	await signupUser(page, "Paragraphs", { features })
	const res = await page.request.post("/api/documents", {
		data: {
			url: "https://paulgraham.com/makersschedule.html",
			html: readFileSync(FIXTURE, "utf8"),
		},
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(PASSAGE, { timeout: 60_000 })
	await waitForHydration(page)
	return id
}

/** The marked paragraph's text, from the highlight that paints it; null when none is. */
const marked = (page: Page) =>
	page.evaluate(() => {
		const range = CSS.highlights.get("klip-reading")?.values().next().value as Range | undefined
		return range ? range.toString() : null
	})

/** Where the marked paragraph is from the one marked at the last call: 1 after it, -1 before it. */
const order = (page: Page) =>
	page.evaluate(() => {
		const range = CSS.highlights.get("klip-reading")?.values().next().value as Range | undefined
		const w = window as unknown as { prevMarked?: Range }
		const prev = w.prevMarked
		if (range) w.prevMarked = range.cloneRange()
		if (!range || !prev) return 0
		return range.compareBoundaryPoints(Range.START_TO_START, prev)
	})

/** The marked paragraph's box on screen. */
const markedBox = (page: Page) =>
	page.evaluate(() => {
		const range = CSS.highlights.get("klip-reading")?.values().next().value as Range | undefined
		const rect = range?.getBoundingClientRect()
		return rect ? { x: rect.x, y: rect.y, top: rect.top, bottom: rect.bottom } : null
	})

test("j and k step through the paragraphs with a marker; Escape leaves", async ({ page }) => {
	test.setTimeout(90_000)
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page)
	const marker = page.getByTestId("reading-marker")
	expect(await marked(page)).toBeNull()
	await expect(marker).toHaveCount(0)

	// The first j marks the first paragraph on screen: "July 2009", alone before a blank line.
	await page.keyboard.press("j")
	await expect(marker).toBeVisible()
	expect(await marked(page)).toBe("July 2009")
	await order(page)

	// j: the next paragraph of the same <p>, split by <br><br>; k: back.
	await page.keyboard.press("j")
	await expect.poll(() => marked(page)).toMatch(/^One reason programmers dislike meetings.*more\.$/)
	expect(await order(page)).toBe(1)
	await page.keyboard.press("j")
	await expect.poll(() => marked(page)).toMatch(/^There are two types of schedule/)
	expect(await order(page)).toBe(1)
	await page.keyboard.press("k")
	expect(await order(page)).toBe(-1)
	await page.keyboard.press("k")
	expect(await marked(page)).toBe("July 2009")

	// The marker sits in the gutter, beside the paragraph it marks.
	await page.keyboard.press("j")
	await expect
		.poll(async () => {
			const box = await markedBox(page)
			const bar = await marker.boundingBox()
			return Boolean(box && bar && Math.abs(bar.y - box.y) < 2 && bar.x < box.x)
		})
		.toBe(true)

	// Far down the article, j goes on from where the page is, not from the old paragraph.
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
	await page.keyboard.press("j")
	await expect
		.poll(async () => {
			const box = await markedBox(page)
			return Boolean(box && box.bottom > 0 && box.top < 800)
		})
		.toBe(true)
	expect(await marked(page)).not.toMatch(/^One reason/)

	await page.keyboard.press("Escape")
	expect(await marked(page)).toBeNull()
	await expect(marker).toHaveCount(0)
})

test("with single-key shortcuts off, j does nothing", async ({ page }) => {
	await open(page)
	await page.request.post("/prefs", { form: { shortcuts: "off" } })
	await page.reload()
	await waitForHydration(page)
	await page.keyboard.press("j")
	await expect(page.getByTestId("reading-marker")).toHaveCount(0)
	expect(await marked(page)).toBeNull()
})
