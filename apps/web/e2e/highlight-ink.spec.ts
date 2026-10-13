import { randomUUID } from "node:crypto"
import { db, documents, documentVersions, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import sharp from "sharp"
import { paintedHighlights, signupUser, waitForHydration } from "./helpers"

/**
 * Highlights are painted as marker ink: one stroke per line over the text (HighlightInk), blended
 * into it. These check the strokes where they show: their place against the text, their color on
 * screen, the darker ink where two cross, and that they follow the text when it reflows.
 */

const html = `<p>Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu. Then the alphabet once more: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima.</p><p>Second paragraph with <strong>bold words</strong> and <code>inline code</code> in it, and a plain ending.</p>`
const text = html.replace(/<[^>]*>/g, "")
let docId: string

const YELLOW = 0
const BLUE = 2
const PINK = 3

async function setup(page: Page) {
	const email = await signupUser(page, "Ink", { verified: false })
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner!.id,
			sourceUrl: "https://example.com/ink",
			urlHash: randomUUID(),
			title: "Ink fixture",
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
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, docId))
}

async function seed(page: Page, from: string, to: string, color: number) {
	const start = text.indexOf(from)
	const end = text.indexOf(to, start) + to.length
	const res = await page.request.post(`/documents/${docId}/highlights`, {
		data: { intent: "create", start, end, exact: text.slice(start, end), color },
	})
	expect(res.status()).toBe(201)
}

async function open(page: Page, count: number) {
	await page.goto(`/read/${docId}`)
	await waitForHydration(page)
	await expect.poll(async () => (await paintedHighlights(page)).length).toBe(count)
}

interface Box {
	left: number
	top: number
	right: number
	bottom: number
}

/** Each painted highlight's strokes on screen, and the lines of its text. */
function inkAndText(page: Page) {
	return page.evaluate(() => {
		const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
		return [...document.querySelectorAll<HTMLElement>(".hl-inks > [data-hl]")].map((group) => {
			const range = [...(CSS.highlights.get(`klip-hl-${group.dataset.hl}`) ?? [])][
				Number(group.dataset.index)
			] as Range
			// Untilted, the stroke's own box: the tilt is a fraction of a degree.
			const strokes = [...group.querySelectorAll<HTMLElement>(".hl-ink")].map((s) => {
				const parent = s.offsetParent!.getBoundingClientRect()
				return {
					left: parent.left + s.offsetLeft,
					top: parent.top + s.offsetTop,
					right: parent.left + s.offsetLeft + s.offsetWidth,
					bottom: parent.top + s.offsetTop + s.offsetHeight,
				}
			})
			const lines: Box[] = []
			for (const r of range.getClientRects()) {
				if (r.width < 1) continue
				const mid = (r.top + r.bottom) / 2
				const line = lines.find((l) => mid > l.top && mid < l.bottom)
				if (line) {
					line.left = Math.min(line.left, r.left)
					line.right = Math.max(line.right, r.right)
					line.top = Math.min(line.top, r.top)
					line.bottom = Math.max(line.bottom, r.bottom)
				} else lines.push(box(r))
			}
			return { color: group.dataset.hl!, text: range.toString(), strokes, lines }
		})
	})
}

/** Every stroke covers its line of text, low in it: the tops of tall letters stand above it. */
function expectStrokesOnLines(painted: Awaited<ReturnType<typeof inkAndText>>) {
	for (const { strokes, lines } of painted) {
		expect(strokes).toHaveLength(lines.length)
		strokes.forEach((stroke, i) => {
			const line = lines[i]!
			const height = line.bottom - line.top
			expect(stroke.bottom - stroke.top).toBeCloseTo(height * 0.8, 0)
			expect(stroke.top).toBeGreaterThan(line.top + height * 0.1)
			expect(stroke.bottom).toBeGreaterThan(line.bottom - height * 0.1)
			expect(stroke.bottom).toBeLessThan(line.bottom + height * 0.1)
			expect(stroke.left).toBeLessThan(line.left)
			expect(stroke.right).toBeGreaterThan(line.right)
			expect(stroke.left).toBeGreaterThan(line.left - height)
			expect(stroke.right).toBeLessThan(line.right + height)
		})
	}
}

/** The middle of the space after `word` (no glyph there), at the height of its stroke. */
function spaceAfter(page: Page, word: string, nth = 0) {
	return page.evaluate(
		([word, nth]) => {
			const root = document.querySelector(".reader-content")!
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
			let seen = 0
			while (walker.nextNode()) {
				const node = walker.currentNode as Text
				let i = node.data.indexOf(`${word} `)
				while (i >= 0) {
					if (seen++ === nth) {
						const range = document.createRange()
						range.setStart(node, i + word.length)
						range.setEnd(node, i + word.length + 1)
						const r = range.getBoundingClientRect()
						// Low in the line, where the stroke is and no letter reaches down to.
						return { x: r.left + r.width / 2, y: r.top + r.height * 0.75 }
					}
					i = node.data.indexOf(`${word} `, i + 1)
				}
			}
			throw new Error(`not found: ${word}`)
		},
		[word, nth] as const,
	)
}

/** The color on screen at a point of the page, as 0–255 RGB. */
async function pixel(page: Page, at: { x: number; y: number }) {
	const shot = await page.screenshot({
		clip: { x: Math.round(at.x) - 1, y: Math.round(at.y) - 1, width: 3, height: 3 },
	})
	const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true })
	const center =
		(info.width * Math.floor(info.height / 2) + Math.floor(info.width / 2)) * info.channels
	return { r: data[center]!, g: data[center + 1]!, b: data[center + 2]! }
}
const lightness = (c: { r: number; g: number; b: number }) => (c.r + c.g + c.b) / 3

test.beforeEach(async ({ page }) => {
	await setup(page)
})

test("a stroke over each line, low in the text, in the highlight's color, darker where two cross", async ({
	page,
}) => {
	await seed(page, "Alpha", "Then", PINK)
	await seed(page, "yankee", "india", YELLOW)
	await seed(page, "bold", "code", BLUE)
	await page.setViewportSize({ width: 700, height: 900 })
	await open(page, 3)

	const painted = await inkAndText(page)
	expect(painted.map((p) => p.color).sort()).toEqual(["blue", "pink", "yellow"])
	// The long pink one runs over several lines; a stroke on each.
	expect(painted.find((p) => p.color === "pink")!.strokes.length).toBeGreaterThan(1)
	expectStrokesOnLines(painted)

	// On screen: the page between words, the pink ink, the yellow ink, and both where they cross.
	const paper = await pixel(page, await spaceAfter(page, "plain"))
	const pink = await pixel(page, await spaceAfter(page, "bravo"))
	const yellow = await pixel(page, await spaceAfter(page, "alpha"))
	const both = await pixel(page, await spaceAfter(page, "zulu."))
	expect(lightness(paper)).toBeGreaterThan(240)
	expect(pink.r - pink.g).toBeGreaterThan(20)
	expect(yellow.r - yellow.b).toBeGreaterThan(60)
	expect(lightness(both)).toBeLessThan(Math.min(lightness(pink), lightness(yellow)) - 10)

	// The ink lies over the text but takes no pointer: a click reaches the words under it.
	const word = await spaceAfter(page, "charlie")
	expect(
		await page.evaluate(
			({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".reader-content"),
			word,
		),
	).toBe(true)
	await page.mouse.click(word.x, word.y)
	await expect(page.getByRole("dialog", { name: "Edit highlight" })).toBeVisible()
	// It stands out: an outline around each of its strokes, the others fade.
	await expect(page.locator('[data-hl="pink"] > .hl-outline')).toHaveCount(
		painted.find((p) => p.color === "pink")!.strokes.length,
	)
	await expect(page.locator('.hl-inks > [data-hl="blue"]')).toHaveCSS("opacity", "0.3")
	await expect(page.locator('.hl-inks > [data-hl="pink"]')).toHaveCSS("opacity", "1")
})

test("the strokes follow the text when it reflows: a narrower window, a larger font", async ({
	page,
}) => {
	await seed(page, "charlie", "lima.", PINK)
	await seed(page, "Second", "ending", YELLOW)
	await page.setViewportSize({ width: 1000, height: 900 })
	await open(page, 2)
	const pink = async () => (await inkAndText(page)).find((p) => p.color === "pink")!
	const wide = await pink()
	expectStrokesOnLines([wide])

	await page.setViewportSize({ width: 420, height: 900 })
	await expect.poll(async () => (await pink()).strokes.length).toBeGreaterThan(wide.strokes.length)
	expectStrokesOnLines(await inkAndText(page))

	const height = async () => {
		const stroke = (await pink()).strokes[0]!
		return stroke.bottom - stroke.top
	}
	const before = await height()
	await page.locator(".reader-content").evaluate((el) => {
		el.style.fontSize = "30px"
	})
	await expect.poll(height).toBeGreaterThan(before * 1.4)
	expectStrokesOnLines(await inkAndText(page))
})

test("dark mode: the ink lightens the page, not the letters", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" })
	await seed(page, "Alpha", "Then", PINK)
	await open(page, 1)
	const paper = await pixel(page, await spaceAfter(page, "plain"))
	const ink = await pixel(page, await spaceAfter(page, "bravo"))
	expect(lightness(paper)).toBeLessThan(50)
	expect(lightness(ink)).toBeGreaterThan(lightness(paper) + 30)
	expect(ink.r - ink.g).toBeGreaterThan(15)
	// Light text stays lighter than its ink: readable.
	expect(lightness(ink)).toBeLessThan(140)
})

test("a new highlight is drawn in once; with reduced motion, it just appears", async ({ page }) => {
	await seed(page, "Second", "words", YELLOW)
	await open(page, 1)
	// Already there: no drawing in.
	await expect(page.locator(".hl-ink[data-fresh]")).toHaveCount(0)

	const create = async () => {
		await page.evaluate(() => {
			const node = document.querySelector(".reader-content p")!.firstChild as Text
			const at = node.data.indexOf("golf hotel")
			const range = document.createRange()
			range.setStart(node, at)
			range.setEnd(node, at + "golf hotel india".length)
			getSelection()!.removeAllRanges()
			getSelection()!.addRange(range)
		})
		const toolbar = page.getByRole("dialog", { name: "Selected text" })
		await Promise.all([
			page.waitForResponse(
				(r) => r.url().includes("/highlights") && r.request().method() === "POST",
			),
			toolbar.getByRole("button", { name: "Highlight" }).click(),
		])
	}
	await create()
	await expect.poll(async () => (await paintedHighlights(page)).length).toBe(2)
	const fresh = page.locator(".hl-ink[data-fresh]")
	await expect(fresh).toHaveCount(1)
	expect(await fresh.evaluate((el) => getComputedStyle(el).animationName)).toBe("ink-in")
	// Drawn in for a moment only: a reflow later does not draw it again.
	await expect(fresh).toHaveCount(0, { timeout: 5000 })

	await page.emulateMedia({ reducedMotion: "reduce" })
	await page
		.getByRole("dialog", { name: "Edit highlight" })
		.getByRole("button", { name: "Delete highlight" })
		.click()
	await expect.poll(async () => (await paintedHighlights(page)).length).toBe(1)
	await create()
	await expect(fresh).toHaveCount(1)
	expect(await fresh.evaluate((el) => getComputedStyle(el).animationName)).toBe("none")
})
