import { db, documents, documentVersions, eq, highlights, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const filler = "A sentence that fills the page with reading. ".repeat(40)
// No whitespace between paragraphs: a highlight's offsets count the text nodes' characters only.
const PARAGRAPHS = [
	`Marker one opens it. ${filler}`,
	...Array.from({ length: 5 }, () => filler),
	`${filler} Marker two sits in the middle.`,
	...Array.from({ length: 2 }, () => filler),
	`Marker five waits to be marked. ${filler}`,
	...Array.from({ length: 2 }, () => filler),
	`${filler} Marker three and Marker four close it.`,
]
const HTML = PARAGRAPHS.map((p) => `<p>${p}</p>`).join("")
const TEXT = PARAGRAPHS.join("")

/** Selects `text` in the article, as a reader's drag would. */
async function selectText(page: Page, text: string) {
	await page.evaluate((needle) => {
		const root = document.querySelector(".reader-content")!
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
		for (
			let node = walker.nextNode() as Text | null;
			node;
			node = walker.nextNode() as Text | null
		) {
			const i = node.data.indexOf(needle)
			if (i < 0) continue
			const range = document.createRange()
			range.setStart(node, i)
			range.setEnd(node, i + needle.length)
			window.getSelection()!.removeAllRanges()
			window.getSelection()!.addRange(range)
			return
		}
		throw new Error(`text not found: ${needle}`)
	}, text)
}

/** Signs up and saves the article: its id and its owner's. */
async function save(page: Page) {
	const email = await signupUser(page, "Mapper")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(owner!.id, "Mapped", HTML)
	// Its text, as extraction keeps it: a highlight made in the reader is checked against it.
	const doc = await db.query.documents.findFirst({ where: eq(documents.id, id) })
	await db
		.update(documentVersions)
		.set({ text: TEXT })
		.where(eq(documentVersions.id, doc!.currentVersionId!))
	return { id, userId: owner!.id }
}

async function highlight(
	userId: string,
	documentId: string,
	exact: string,
	color: number,
	note?: string,
) {
	const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) })
	const start = TEXT.indexOf(exact)
	await db.insert(highlights).values({
		userId,
		documentId,
		versionId: doc!.currentVersionId!,
		startOffset: start,
		endOffset: start + exact.length,
		exact,
		color,
		note,
	})
}

async function open(page: Page, id: string) {
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
}

/** Where an element's middle is on the map, as a fraction of its height. */
async function along(page: Page, mark: ReturnType<Page["getByTestId"]>) {
	const map = (await page.getByTestId("highlight-map").boundingBox())!
	const box = (await mark.boundingBox())!
	return (box.y + box.height / 2 - map.y) / map.height
}

test("highlight map: a tick in each highlight's colour where it sits, and a click goes there", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	const { id, userId } = await save(page)
	await highlight(userId, id, "Marker one", 0)
	await highlight(userId, id, "Marker two", 2, "The middle of it.")
	// Side by side: one mark, both colours.
	await highlight(userId, id, "Marker three", 1)
	await highlight(userId, id, "Marker four", 3, "Close by.")
	await open(page, id)

	const map = page.getByRole("navigation", { name: "Where your highlights are" })
	const marks = map.getByTestId("highlight-map-mark")
	await expect(marks).toHaveCount(3)
	await expect(marks.nth(0)).toHaveAccessibleName("Marker one")
	await expect(marks.nth(1)).toHaveAccessibleName("Marker two")
	await expect(marks.nth(2)).toHaveAccessibleName("2 highlights close together")

	// In each highlight's colour, at its place in the text: first, middle, last of 14 paragraphs.
	const colors = (n: number) =>
		marks
			.nth(n)
			.locator("[data-hl]")
			.evaluateAll((els) => els.map((el) => el.dataset.hl))
	expect(await colors(0)).toEqual(["yellow"])
	expect(await colors(1)).toEqual(["blue"])
	expect(await colors(2)).toEqual(["green", "pink"])
	expect(await along(page, marks.nth(0))).toBeLessThan(0.1)
	const middle = await along(page, marks.nth(1))
	expect(middle).toBeGreaterThan(0.45)
	expect(middle).toBeLessThan(0.6)
	expect(await along(page, marks.nth(2))).toBeGreaterThan(0.9)
	// The one with a note has the note's dot.
	await expect(marks.nth(1).locator("span[aria-hidden]")).toHaveCount(1)
	await expect(marks.nth(0).locator("span[aria-hidden]")).toHaveCount(0)
	await expect(marks.nth(2).locator("span[aria-hidden]")).toHaveCount(1)

	// The notes in the margin keep clear of it, or go when there is no room for both.
	const margin = page.getByRole("region", { name: "Highlight notes" })
	const marginRight = () => margin.evaluate((el) => el.getBoundingClientRect().right)
	expect(await marginRight()).toBeLessThan((await map.boundingBox())!.x)
	// 244px beside the 672px article: room for a note (232px), not for a note and the map (264px).
	await page.setViewportSize({ width: 1160, height: 900 })
	await expect(margin).toHaveCount(0)
	await expect(map).toBeVisible()
	await page.setViewportSize({ width: 1440, height: 900 })
	await expect(margin).toHaveCount(1)

	const two = page.locator(".reader-content p", { hasText: "Marker two" })
	await expect(two).not.toBeInViewport()
	await marks.nth(1).click()
	await expect(two).toBeInViewport()

	// A highlight made while reading gets its mark.
	await page.getByText("Marker five").scrollIntoViewIfNeeded()
	await selectText(page, "Marker five")
	const saved = page.waitForResponse(
		(r) => r.url().includes("/highlights") && r.request().method() === "POST" && r.ok(),
	)
	await page
		.getByRole("dialog", { name: "Selected text" })
		.getByRole("button", { name: "Highlight" })
		.click()
	await saved
	await expect(marks).toHaveCount(4)
	await expect(marks.nth(2)).toHaveAccessibleName("Marker five")

	// The open sidebar takes the page's right edge: the map moves to the sidebar's edge.
	await page.getByTestId("toggle-sidebar").click()
	const sidebar = (await page.getByRole("complementary").boundingBox())!
	const moved = (await map.boundingBox())!
	expect(moved.x + moved.width).toBeLessThan(sidebar.x)
	// With no room left beside the text (40px in a 704px column),
	// there is no map over it.
	await page.setViewportSize({ width: 1024, height: 900 })
	await expect(map).toBeHidden()
	await page.getByTestId("toggle-sidebar").click()
	await expect(map).toBeVisible()

	// Not on a phone's width: the sidebar's list does this there.
	await page.setViewportSize({ width: 390, height: 844 })
	await expect(map).toBeHidden()
})

test("highlight map: where the reader left off, and back there in a click; none with neither", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	const { id } = await save(page)
	await open(page, id)
	// Nothing to show: no highlights, nowhere left off.
	await expect(page.getByTestId("reader-end")).toBeAttached()
	await expect(page.getByTestId("highlight-map")).toHaveCount(0)

	await db.update(documents).set({ readingPosition: 0.5 }).where(eq(documents.id, id))
	await open(page, id)
	const ribbon = page.getByRole("button", { name: "Where you left off last time" })
	await expect(ribbon).toBeVisible()
	// The article opens where it was left off; the ribbon sits at that place in the text.
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
	const resumed = await page.evaluate(() => window.scrollY)
	const at = await along(page, ribbon)
	expect(at).toBeGreaterThan(0.4)
	expect(at).toBeLessThan(0.6)

	await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
	await ribbon.click()
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(resumed - 2)
	expect(Math.abs((await page.evaluate(() => window.scrollY)) - resumed)).toBeLessThanOrEqual(2)
})
