import { aiThreads, db, documentVersions, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const LONG = Array.from(
	{ length: 30 },
	(_, i) =>
		`<p>Paragraph ${i + 1}. ${"Makers need long stretches of time to get into the work. ".repeat(4)}</p>`,
).join("")
/** Paragraphs of every kind: a heading, two in one <p> split by a blank line, a quote, a list. */
const HTML = `<h2>Two schedules</h2>
<p>July 2009<br><br>One reason programmers dislike meetings. Meetings cost them more.</p>
<p>There are two types of schedule.</p>
<blockquote><p>A quoted line.</p></blockquote>
<ul><li>First item</li><li>Second item</li></ul>
${LONG}`

async function open(page: Page, features: "ai"[] = []) {
	const email = await signupUser(page, "Paragraphs", { features })
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const id = await insertArticle(owner!.id, "Paragraphs", HTML)
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("Two schedules")
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

	// The first j marks the first paragraph on screen: the heading.
	await page.keyboard.press("j")
	await expect(marker).toBeVisible()
	expect(await marked(page)).toBe("Two schedules")
	await order(page)

	// j: each paragraph in turn, the two halves of one <p> split by a blank line, the quote, each
	// item of the list; k: back.
	const expected = [
		"July 2009",
		"One reason programmers dislike meetings. Meetings cost them more.",
		"There are two types of schedule.",
		"A quoted line.",
		"First item",
		"Second item",
	]
	for (const text of expected) {
		await page.keyboard.press("j")
		await expect.poll(() => marked(page)).toBe(text)
		expect(await order(page)).toBe(1)
	}
	for (const text of expected.toReversed().slice(1)) {
		await page.keyboard.press("k")
		await expect.poll(() => marked(page)).toBe(text)
		expect(await order(page)).toBe(-1)
	}

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
	expect(await marked(page)).toMatch(/^Paragraph \d+\./)

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

test("Enter asks about the marked paragraph; nothing is asked before the question", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	const id = await open(page, ["ai"])
	// The version's text, as extraction keeps it: what the AI looks the passage up in.
	const text = await page.evaluate(() => {
		const walker = document.createTreeWalker(document.querySelector(".reader-content")!, 4)
		let all = ""
		for (let node = walker.nextNode(); node; node = walker.nextNode()) all += (node as Text).data
		return all
	})
	await db.update(documentVersions).set({ text }).where(eq(documentVersions.documentId, id))
	for (let i = 0; i < 3; i++) await page.keyboard.press("j")
	await expect.poll(() => marked(page)).toMatch(/^One reason programmers/)
	await page.keyboard.press("Enter")

	const card = page.getByTestId("ai-card")
	const question = card.getByRole("textbox", { name: "Ask about this passage…" })
	await expect(question).toBeFocused()
	await expect(question).toHaveValue("")
	const threads = () => db.select().from(aiThreads).where(eq(aiThreads.documentId, id))
	expect(await threads()).toHaveLength(0)

	await question.fill("Why more?")
	await question.press("Enter")
	await expect(card.getByText("Why more?")).toBeVisible()
	await expect
		.poll(async () => (await threads()).map((t) => t.exact))
		.toEqual(["One reason programmers dislike meetings. Meetings cost them more."])
})

test("without AI, Enter on a paragraph asks nothing", async ({ page }) => {
	await open(page)
	await page.keyboard.press("j")
	await page.keyboard.press("Enter")
	await expect(page.getByTestId("ai-card")).toHaveCount(0)
	expect(await marked(page)).toBe("Two schedules")
})
