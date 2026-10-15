import { db, documents, eq, highlights, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const filler = "A sentence that fills the page with reading. ".repeat(40)
// No whitespace between paragraphs: a highlight's offsets count the text nodes' characters only.
const PARAGRAPHS = [
	`Marker one opens it. ${filler}`,
	...Array.from({ length: 5 }, () => filler),
	`${filler} Marker two sits in the middle.`,
	...Array.from({ length: 5 }, () => filler),
	`${filler} Marker three and Marker four close it.`,
]
const HTML = PARAGRAPHS.map((p) => `<p>${p}</p>`).join("")
const TEXT = PARAGRAPHS.join("")

/** Signs up and saves the article: its id and its owner's. */
async function save(page: Page) {
	const email = await signupUser(page, "Mapper")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(owner!.id, "Mapped", HTML)
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
	await highlight(userId, id, "Marker four", 3)
	await open(page, id)

	const map = page.getByRole("navigation", { name: "Where your highlights are" })
	const marks = map.getByTestId("highlight-map-mark")
	await expect(marks).toHaveCount(3)
	await expect(marks.nth(0)).toHaveAccessibleName("Marker one")
	await expect(marks.nth(1)).toHaveAccessibleName("Marker two")
	await expect(marks.nth(2)).toHaveAccessibleName("2 highlights close together")

	// In each highlight's colour, at its place in the text: first, middle, last of 13 paragraphs.
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

	const two = page.locator(".reader-content p", { hasText: "Marker two" })
	await expect(two).not.toBeInViewport()
	await marks.nth(1).click()
	await expect(two).toBeInViewport()

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
