import {
	aiBriefs,
	aiMessages,
	aiThreads,
	db,
	documentVersions,
	eq,
	highlights,
	user,
} from "@klipstack/db"
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

/** The article's text, as extraction keeps it (every text node, in order): offsets count in it. */
const TEXT = HTML.replace(/<[^>]+>/g, "")

async function open(page: Page, features: "ai"[] = [], seed?: (ids: Ids) => Promise<void>) {
	const email = await signupUser(page, "Paragraphs", { features })
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const id = await insertArticle(owner!.id, "Paragraphs", HTML)
	const [version] = await db
		.update(documentVersions)
		.set({ text: TEXT })
		.where(eq(documentVersions.documentId, id))
		.returning({ id: documentVersions.id })
	await seed?.({ userId: owner!.id, documentId: id, versionId: version!.id })
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("Two schedules")
	await waitForHydration(page)
	return id
}

interface Ids {
	userId: string
	documentId: string
	versionId: string
}

/** Where a passage is in the article's text. */
function at(exact: string) {
	const start = TEXT.indexOf(exact)
	if (start < 0) throw new Error(`not in the article: ${exact}`)
	return { exact, startOffset: start, endOffset: start + exact.length }
}

async function seedThread(ids: Ids, exact: string, answer: string) {
	const [thread] = await db
		.insert(aiThreads)
		.values({ ...ids, ...at(exact), action: "explain" })
		.returning({ id: aiThreads.id })
	await db.insert(aiMessages).values([
		{ threadId: thread!.id, role: "user", text: "" },
		{ threadId: thread!.id, role: "assistant", text: answer },
	])
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

test("] and [ go from answer to note in the article's order, and mark their paragraph", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	await open(page, ["ai"], async (ids) => {
		await seedThread(ids, "There are two types of schedule.", "First answer.")
		await seedThread(ids, "Paragraph 12.", "Second answer.")
		await db.insert(highlights).values([
			{ ...ids, ...at("Paragraph 5."), note: "A note on five." },
			// No note: not a stop.
			{ ...ids, ...at("Paragraph 8.") },
		])
	})
	const openCard = page.getByRole("dialog", { name: "Explain" })
	const active = () =>
		page.evaluate(() => {
			const range = CSS.highlights.get("klip-active")?.values().next().value as Range | undefined
			return range?.toString() ?? null
		})

	await page.keyboard.press("]")
	await expect(openCard).toContainText("First answer.")
	await expect.poll(() => marked(page)).toBe("There are two types of schedule.")

	await page.keyboard.press("]")
	await expect(openCard).toHaveCount(0)
	await expect.poll(() => active()).toBe("Paragraph 5.")
	await expect.poll(() => marked(page)).toMatch(/^Paragraph 5\./)

	await page.keyboard.press("]")
	await expect(openCard).toContainText("Second answer.")
	await expect.poll(() => marked(page)).toMatch(/^Paragraph 12\./)
	// The last one: ] stays.
	await page.keyboard.press("]")
	await expect(openCard).toContainText("Second answer.")

	await page.keyboard.press("[")
	await expect.poll(() => active()).toBe("Paragraph 5.")
	await expect.poll(() => marked(page)).toMatch(/^Paragraph 5\./)
	// Where [ takes Option or AltGr to type.
	await page.keyboard.press("Alt+[")
	await expect(openCard).toContainText("First answer.")
	await expect.poll(() => marked(page)).toBe("There are two types of schedule.")
})

test("b shows the brief: opens and closes one, or offers to make it without asking", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await page.setViewportSize({ width: 1280, height: 800 })
	const id = await open(page, ["ai"])
	const brief = page.getByTestId("brief")
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
	await page.keyboard.press("b")
	await expect(brief).toBeInViewport()
	await expect(brief).toBeFocused()
	await expect(brief).toContainText("Sum up this article in three points")
	expect(await db.select().from(aiBriefs).where(eq(aiBriefs.documentId, id))).toHaveLength(0)
})

test("b opens and closes a brief already made", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page, ["ai"], async (ids) => {
		await db.insert(aiBriefs).values({ ...ids, text: "- The kept brief.", model: "fake:e2e" })
	})
	const region = page.getByRole("region", { name: "Brief" })
	await expect(region).toHaveCount(0)
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
	await page.keyboard.press("b")
	await expect(region).toContainText("The kept brief.")
	await expect(region).toBeInViewport()
	await page.keyboard.press("b")
	await expect(region).toHaveCount(0)
})

test("f dims all but the marked paragraph; f again or Escape comes back", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page)
	const content = page.locator(".reader-content")
	await page.keyboard.press("f")
	await expect(content).toHaveAttribute("data-reading-focus", "")
	// Marked on the way in: the first paragraph on screen.
	expect(await marked(page)).toBe("Two schedules")
	// Dimmed: a paragraph's text is fainter than the page's.
	const color = (selector: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((el) => getComputedStyle(el).color)
	expect(await color(".reader-content blockquote p")).not.toBe(await color("h1"))
	await page.keyboard.press("j")
	expect(await marked(page)).toBe("July 2009")
	await expect(content).toHaveAttribute("data-reading-focus", "")
	await page.keyboard.press("f")
	await expect(content).not.toHaveAttribute("data-reading-focus")
	expect(await marked(page)).toBe("July 2009")
	await page.keyboard.press("f")
	await page.keyboard.press("Escape")
	await expect(content).not.toHaveAttribute("data-reading-focus")
	expect(await marked(page)).toBeNull()
})

test("Settings lists every shortcut; the AI's only with AI", async ({ page, browser }) => {
	await signupUser(page, "Lister", { features: ["ai"] })
	await page.goto("/settings/shortcuts")
	const reader = page.getByRole("region", { name: "In the reader" })
	await expect(reader.getByRole("row", { name: /Next or previous paragraph/ })).toContainText("JK")
	await expect(reader.getByRole("row", { name: /Ask the AI about the paragraph/ })).toBeVisible()
	await expect(
		page.getByRole("region", { name: "In lists" }).getByRole("row", { name: /^S Star$/ }),
	).toBeVisible()
	await expect(page.getByRole("region", { name: "Everywhere" })).toContainText("⌘K")

	// The switch explains itself. Turned off, the single keys are marked off, the others not.
	const toggle = page.getByRole("checkbox", { name: "Single-key shortcuts" })
	await expect(toggle).toHaveAccessibleDescription(/speech input or a screen reader/)
	const paragraphRow = reader.getByRole("row", { name: /Next or previous paragraph/ })
	const openRow = page.getByRole("region", { name: "In lists" }).getByRole("row", {
		name: /Open the article/,
	})
	await expect(paragraphRow).not.toContainText("Off")
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/prefs") && r.request().method() === "POST"),
		toggle.uncheck(),
	])
	await expect(paragraphRow).toContainText("Off")
	await expect(page.getByRole("row", { name: /Command palette/ })).not.toContainText("Off")
	// Enter still opens; O doesn't.
	await expect(openRow).not.toContainText("Off")
	await expect(openRow.locator("kbd[data-off]")).toHaveText("O")
	// Kept for the next visit.
	await page.reload()
	await waitForHydration(page)
	await expect(paragraphRow).toContainText("Off")
	await toggle.check()
	await expect(paragraphRow).not.toContainText("Off")

	const other = await browser.newPage()
	await signupUser(other, "Lister without AI")
	await other.goto("/settings/shortcuts")
	const without = other.getByRole("region", { name: "In the reader" })
	await expect(without.getByRole("row", { name: /Next or previous paragraph/ })).toBeVisible()
	await expect(without.getByRole("row", { name: /Ask the AI/ })).toHaveCount(0)
	await other.close()
})

test("? lists the reader's shortcuts; so does the button in the top bar", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page)
	const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" })
	await page.keyboard.press("?")
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("region", { name: "In the reader" })).toContainText(
		"Next or previous paragraph",
	)
	await expect(dialog.getByRole("region", { name: "Everywhere" })).toBeVisible()
	await expect(dialog.getByRole("region", { name: "In lists" })).toHaveCount(0)
	// Without AI, no AI keys.
	await expect(dialog).not.toContainText("Ask the AI")
	// The page's keys wait while it is open.
	await page.keyboard.press("j")
	expect(await marked(page)).toBeNull()
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)

	await page.getByRole("button", { name: "Keyboard shortcuts" }).click()
	await expect(dialog).toBeVisible()
	await expect(dialog).not.toContainText("Single-key shortcuts are off")
	await dialog.getByRole("link", { name: "All shortcuts" }).click()
	await expect(page).toHaveURL(/\/settings\/shortcuts$/)
})

test("with single-key shortcuts off, the list says so", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 })
	await open(page)
	await page.request.post("/prefs", { form: { shortcuts: "off" } })
	await page.reload()
	await waitForHydration(page)
	await page.keyboard.press("?")
	const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" })
	await expect(dialog).toHaveCount(0)
	await page.getByRole("button", { name: "Keyboard shortcuts" }).click()
	await expect(dialog).toContainText("Single-key shortcuts are off.")
	await expect(dialog.getByRole("row", { name: /Next or previous paragraph/ })).toContainText("Off")
	await expect(dialog.getByRole("row", { name: /Stop reading by paragraph/ })).not.toContainText(
		"Off",
	)
	await expect(dialog.getByRole("link", { name: "Turn them on" })).toHaveAttribute(
		"href",
		"/settings/shortcuts",
	)
})
