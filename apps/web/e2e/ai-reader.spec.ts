import { readFileSync } from "node:fs"
import { join } from "node:path"
import { aiThreads, db, documents, eq, usageCounts, user } from "@klipstack/db"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const PASSAGE = "There are two types of schedule"
const SHOTS = process.env.AI_SHOTS

async function open(page: Page, features: "ai"[] = ["ai"]) {
	await signupUser(page, "Reader", { features })
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

/** Selects `text` in the article, as a reader would, and lets go of the mouse. */
async function select(page: Page, text: string) {
	await waitForHydration(page)
	await page.evaluate((needle) => {
		const root = document.querySelector(".reader-content") as HTMLElement
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
			const selection = window.getSelection() as Selection
			selection.removeAllRanges()
			selection.addRange(range)
			return
		}
		throw new Error(`text not found: ${needle}`)
	}, text)
}

/** The card's place in the margin: invisible until it is laid out. */
const marginSlot = (card: Locator) => card.locator("xpath=ancestor::*[@data-note-id][1]")
const selectionToolbar = (page: Page) => page.getByRole("dialog", { name: "Selected text" })
const shot = (page: Page, name: string) =>
	SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve()

test("Explain answers in the margin with a citation; follow-ups, reload and delete", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	await open(page)
	await select(page, PASSAGE)
	await shot(page, "1-toolbar")
	await selectionToolbar(page).getByRole("button", { name: "Explain" }).click()

	const card = page.getByTestId("ai-card")
	await expect(card).toHaveAttribute("data-placement", "margin")
	await expect(card).toContainText("A fixed answer for tests.")
	await expect(card).toContainText("Answer 1.")
	// Placed in the margin once it has its saved id, not left invisible at the top.
	await expect(marginSlot(card)).not.toHaveCSS("opacity", "0")
	await shot(page, "2-answer")
	// The citation chip flashes its passage.
	await card.getByRole("button", { name: "Passage 1 of the article" }).click()
	await expect.poll(() => page.evaluate(() => CSS.highlights.has("klip-cited"))).toBe(true)
	expect(await page.evaluate(() => CSS.highlights.get("klip-ai")?.size)).toBe(1)

	await card.getByRole("textbox", { name: "Ask a follow-up…" }).fill("And managers?")
	await card.getByRole("textbox", { name: "Ask a follow-up…" }).press("Enter")
	await expect(card).toContainText("And managers?")
	await expect(card).toContainText("Answer 2.")
	// Saved: the actions come back when the answer is stored, not while it is written.
	await expect(card.getByRole("button", { name: "Copy" })).toBeVisible()
	await shot(page, "3-follow-up")

	// Retry answers the follow-up again, in place: the question shows once.
	await card.getByRole("button", { name: "Answer again" }).click()
	await expect(card.getByRole("button", { name: "Copy" })).toBeVisible()
	await expect(card.getByText("And managers?")).toHaveCount(1)
	await expect(card.getByText(/Answer 2\./)).toHaveCount(1)

	// Kept: after a reload the thread is a collapsed card in the margin, and opens with both answers.
	await page.reload()
	await waitForHydration(page)
	const margin = page.getByRole("region", { name: "Highlight notes" })
	await margin.getByRole("button", { name: /Explain/ }).click()
	await expect(card).toContainText("Answer 2.")
	await expect(card.getByText("And managers?")).toHaveCount(1)
	await shot(page, "4-reloaded")
	// A press outside collapses it.
	await page.mouse.click(1300, 450)
	await expect(card).toHaveCount(0)
	await margin.getByRole("button", { name: /Explain/ }).click()
	await expect(card).toContainText("Answer 2.")

	await card.getByRole("button", { name: "Delete" }).click()
	await expect(card).toHaveCount(0)
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(margin.getByRole("button", { name: /Explain/ })).toBeVisible()
})

test("a follow-up's answer stays in view in a card too short for the thread", async ({ page }) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 420 })
	await open(page)
	await select(page, PASSAGE)
	await selectionToolbar(page).getByRole("button", { name: "Explain" }).click()
	const card = page.getByTestId("ai-card")
	await expect(card.getByRole("button", { name: "Copy" })).toBeVisible()
	for (const question of ["And managers?", "And writers?", "And painters?", "And editors?"]) {
		await card.getByRole("textbox", { name: "Ask a follow-up…" }).fill(question)
		await card.getByRole("textbox", { name: "Ask a follow-up…" }).press("Enter")
		await expect(card.getByRole("button", { name: "Copy" })).toBeVisible()
	}
	const turns = card.locator("[aria-live]")
	expect(await turns.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200)
	expect(
		await turns.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
	).toBeLessThan(2)
})

test("one word can be defined, not highlighted; typing with a selection asks", async ({ page }) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	await open(page)
	await select(page, "schedule")
	const highlight = selectionToolbar(page).getByRole("button", { name: "Highlight" })
	await expect(highlight).toBeDisabled()
	// It looks it: dimmed, not just inert.
	await expect(highlight).toHaveCSS("opacity", "0.4")
	await selectionToolbar(page).getByRole("button", { name: "Define" }).click()
	const card = page.getByTestId("ai-card")
	await expect(card).toContainText("Answer 1.")
	await card.getByRole("button", { name: "Collapse" }).click()

	await select(page, PASSAGE)
	await expect(selectionToolbar(page)).toBeVisible()
	await page.keyboard.type("Why two?")
	const question = card.getByRole("textbox", { name: "Ask about this passage…" })
	await expect(question).toHaveValue("Why two?")
	// A question of the reader's own: no suggestions under it.
	await expect(card.getByRole("button", { name: "Give me an example" })).toHaveCount(0)
	await shot(page, "5-ask")
	await question.press("Enter")
	await expect(card).toContainText("Why two?")
	await expect(card).toContainText("Answer 1.")
})

test("Ask far down the article opens its field where the reader is", async ({ page }) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	await open(page)
	// The passage in the middle of the window, then selected there.
	await select(page, "they understand the cost")
	await page.evaluate(() => {
		const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
		if (rect) window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: "instant" })
		window.getSelection()?.removeAllRanges()
	})
	const scrolled = await page.evaluate(() => window.scrollY)
	expect(scrolled).toBeGreaterThan(1000)
	await select(page, "they understand the cost")
	await page.mouse.up()
	await selectionToolbar(page).getByRole("button", { name: "Ask" }).click()
	const question = page
		.getByTestId("ai-card")
		.getByRole("textbox", { name: "Ask about this passage…" })
	await expect(question).toBeFocused()
	// Focusing the field doesn't jump to where the card sat before the margin placed it.
	expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrolled)).toBeLessThan(50)
	await expect(question).toBeInViewport()

	// Without a question in mind, a suggestion asks itself in one press.
	const card = page.getByTestId("ai-card")
	await expect(card.getByRole("button")).toContainText([
		"Give me an example",
		"Why does it matter?",
		"What is the evidence?",
	])
	await card.getByRole("button", { name: "Why does it matter?" }).click()
	await expect(card).toContainText("Why does it matter?")
	await expect(card).toContainText("Answer 1.")
	await expect(card.getByRole("button", { name: "What is the evidence?" })).toHaveCount(0)
})

test("without a margin the card floats under the passage; without the feature, no AI", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 900, height: 800 })
	await open(page)
	await select(page, PASSAGE)
	await selectionToolbar(page).getByRole("button", { name: "Explain" }).click()
	const card = page.getByTestId("ai-card")
	await expect(card).toHaveAttribute("data-placement", "floating")
	await expect(card).toContainText("Answer 1.")
	await shot(page, "6-floating")
	await page.keyboard.press("Escape")
	await expect(card).toHaveCount(0)
	// The underlined passage opens it again.
	const box = await page.evaluate(() => {
		const range = [...(CSS.highlights.get("klip-ai") as Highlight)][0] as Range
		const r = range.getClientRects()[0]!
		return { x: r.left + 10, y: r.top + r.height / 2 }
	})
	await page.mouse.click(box.x, box.y)
	await expect(card).toContainText("Answer 1.")
})

test("the brief: asked for, a cited gist, claims, caveats and parts above the text, kept for the next visit", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	await open(page)
	const asked: string[] = []
	page.on("request", (r) => {
		if (r.method() === "POST" && r.url().endsWith("/ai")) asked.push(r.postData() ?? "")
	})
	// Nothing is written until the reader asks. It sits above the text, not in the margin.
	await expect(page.getByTestId("brief")).toContainText("Sum up this article")
	await expect(
		page.getByRole("region", { name: "Highlight notes" }).getByTestId("brief"),
	).toHaveCount(0)
	expect(asked).toEqual([])
	await page.getByRole("button", { name: /Sum up this article/ }).click()
	const brief = page.getByRole("region", { name: "Brief" })
	await expect(brief.getByRole("heading")).toHaveText(["Key claims", "Keep in mind", "Parts"])
	await expect(brief.getByRole("list")).toHaveCount(3)
	await expect(brief.getByRole("listitem")).toHaveCount(5)
	await expect(brief).toContainText("The first claim of a fixed brief for tests.")
	const [box, text] = await Promise.all([
		brief.boundingBox(),
		page.locator(".reader-content").boundingBox(),
	])
	expect(box!.y + box!.height).toBeLessThanOrEqual(text!.y)
	await brief.getByRole("button", { name: "Passage 1 of the article" }).click()
	await expect.poll(() => page.evaluate(() => CSS.highlights.has("klip-cited"))).toBe(true)
	await shot(page, "6-brief")

	// Kept: after a reload it is one line, and opens without asking again. Collapse shows once the
	// server has kept it; the bullets show while it is still being written.
	await expect(brief.getByRole("button", { name: "Collapse" })).toBeVisible()
	await page.reload()
	await waitForHydration(page)
	asked.length = 0
	await expect(page.getByTestId("brief")).toHaveText(
		/The gist of a fixed brief for tests\. Why it matters\.$/,
	)
	await page.getByTestId("brief").click()
	await expect(brief.getByRole("listitem")).toHaveCount(5)
	expect(asked).toEqual([])
	await brief.getByRole("button", { name: "Collapse" }).click()
	await expect(brief).toHaveCount(0)
})

test("the chat: questions about the whole article in the sidebar, kept, and cleared", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	await open(page)
	// Its own button opens the sidebar on the chat, in one click.
	await page.getByRole("button", { name: "Chat about this article" }).click()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true")
	const chat = sidebar.getByTestId("chat")
	await expect(chat).toContainText("Ask anything about this article")
	const field = chat.getByRole("textbox", { name: "Ask about this article…" })
	await expect(field).toBeFocused()
	await field.fill("What is it about?")
	await field.press("Enter")
	await expect(chat).toContainText("What is it about?")
	await expect(chat).toContainText("Answer 1.")
	await chat.getByRole("button", { name: "Passage 1 of the article" }).click()
	await expect.poll(() => page.evaluate(() => CSS.highlights.has("klip-cited"))).toBe(true)
	// The citation is a number on a stroke of highlighter ink.
	await expect(chat.getByRole("button", { name: "Passage 1 of the article" })).toHaveCSS(
		"background-image",
		/gradient/,
	)
	// The flash fades, then leaves the passage as it was: it is not a highlight. Watched in the page,
	// frame by frame, as the fading step is short.
	expect(
		await page.evaluate(
			() =>
				new Promise<boolean>((resolve) => {
					const started = performance.now()
					const look = () => {
						if (CSS.highlights.has("klip-cited-fading")) resolve(true)
						else if (performance.now() - started > 5000) resolve(false)
						else requestAnimationFrame(look)
					}
					look()
				}),
		),
	).toBe(true)
	await expect
		.poll(() =>
			page.evaluate(
				() => CSS.highlights.has("klip-cited") || CSS.highlights.has("klip-cited-fading"),
			),
		)
		.toBe(false)
	await chat.getByRole("textbox", { name: "Ask about this article…" }).fill("And managers?")
	await chat.getByRole("textbox", { name: "Ask about this article…" }).press("Enter")
	await expect(chat).toContainText("Answer 2.")
	await expect(chat.getByRole("button", { name: "Copy answer" })).toBeVisible()
	// Not a card: nothing in the margin, nothing underlined.
	await expect(
		page.getByRole("region", { name: "Highlight notes" }).getByRole("button"),
	).toHaveCount(0)
	expect(await page.evaluate(() => CSS.highlights.get("klip-ai")?.size ?? 0)).toBe(0)
	await shot(page, "7-chat")

	// Escape on the chat closes the sidebar, from its question field too. Each key opens its tab,
	// and closes the sidebar when that tab is showing.
	await page.keyboard.press("Escape")
	await expect(sidebar).toHaveCount(0)
	await page.keyboard.press("c")
	await expect(sidebar.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true")
	// The question field has the keyboard, so `h` would be typed there: Escape closes first.
	await page.keyboard.press("Escape")
	await page.keyboard.press("h")
	await expect(sidebar.getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true")
	await page.keyboard.press("h")
	await expect(sidebar).toHaveCount(0)

	await page.reload()
	await waitForHydration(page)
	await page.keyboard.press("c")
	await expect(chat).toContainText("And managers?")
	await expect(chat).toContainText("Answer 2.")
	await chat.getByRole("button", { name: "Clear chat" }).click()
	await expect(chat).toContainText("Ask anything about this article")
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(chat).toContainText("Answer 2.")
})

test("without the feature, the toolbar has no AI", async ({ page }) => {
	const email = await signupUser(page, "Reader", { features: [] })
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	// The toolbar is all it looks at: the article need not be extracted.
	const id = await insertArticle(owner!.id, "No AI", `<p>${PASSAGE}, and more.</p>`)
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
	await select(page, PASSAGE)
	await expect(selectionToolbar(page).getByRole("button", { name: "Highlight" })).toBeVisible()
	await expect(selectionToolbar(page).getByRole("button", { name: "Explain" })).toHaveCount(0)
	await expect(page.getByTestId("brief")).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Chat about this article" })).toHaveCount(0)
	await page.keyboard.press("h")
	await expect(page.getByRole("tab", { name: "Ask" })).toHaveCount(0)
})

/** Sets the article's owner's AI questions this month, as if they had asked them. */
async function askedThisMonth(documentId: string, count: number) {
	const [doc] = await db
		.select({ userId: documents.userId })
		.from(documents)
		.where(eq(documents.id, documentId))
	const month = `${new Date().toISOString().slice(0, 7)}-01`
	await db
		.insert(usageCounts)
		.values({ userId: doc!.userId, metric: "ai", month, count })
		.onConflictDoUpdate({
			target: [usageCounts.userId, usageCounts.metric, usageCounts.month],
			set: { count },
		})
	return doc!.userId
}

/** The 1st of next month, as the reader writes it. */
function nextMonth() {
	const now = new Date()
	return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
	)
}

test("with few questions left the card counts them down, and the last one says when it starts over", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	const id = await open(page)
	// 98 of 100: none of it shows until a question is asked.
	await askedThisMonth(id, 98)
	await page.reload()
	// Ask says it before anything is asked: the page loads where the account stands.
	await select(page, PASSAGE)
	await selectionToolbar(page).getByRole("button", { name: "Ask" }).click()
	await expect(page.getByTestId("questions-left")).toHaveText("2 questions left this month")
	await page.keyboard.press("Escape")
	await expect(page.getByTestId("ai-card")).toHaveCount(0)
	await select(page, PASSAGE)
	await selectionToolbar(page).getByRole("button", { name: "Explain" }).click()
	const card = page.getByTestId("ai-card")
	await expect(card).toContainText("Answer 1.")
	await expect(card.getByTestId("questions-left")).toHaveText("1 question left this month")
	await shot(page, "few-left")

	await card.getByRole("textbox").fill("And the last one?")
	await card.getByRole("textbox").press("Enter")
	await expect(card).toContainText("Answer 2.")
	// None left: no field for another, no Retry, and the day it starts over.
	await expect(card).toContainText(`It starts over on ${nextMonth()}.`)
	await expect(card.getByRole("textbox")).toHaveCount(0)
	await expect(card.getByRole("button", { name: "Answer again" })).toHaveCount(0)
	await expect(card.getByTestId("questions-left")).toHaveCount(0)
	await card.getByText(/starts over/).scrollIntoViewIfNeeded()
	await shot(page, "none-left")
})

test("at the cap the AI buttons are dimmed, and pressing one says why without asking", async ({
	page,
}) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	const id = await open(page)
	const userId = await askedThisMonth(id, 100)
	await page.reload()
	await waitForHydration(page)

	const brief = page.getByTestId("brief")
	await expect(brief).toHaveClass(/opacity-50/)
	await select(page, PASSAGE)
	const explain = selectionToolbar(page).getByRole("button", { name: "Explain" })
	await expect(explain).toHaveAttribute("data-none-left", "true")
	await shot(page, "dimmed-toolbar")
	await explain.click()
	const card = page.getByTestId("ai-card")
	await expect(card).toContainText(`It starts over on ${nextMonth()}.`)
	await expect(card.getByRole("textbox")).toHaveCount(0)

	// Ask opens to the same reason, not a field for a question that would be refused.
	await select(page, "they understand the cost")
	await selectionToolbar(page).getByRole("button", { name: "Ask" }).click()
	await expect(page.getByTestId("ai-card").filter({ hasText: "starts over" })).toBeVisible()
	await expect(page.getByTestId("ai-card").getByRole("textbox")).toHaveCount(0)

	await brief.click()
	await expect(brief).toContainText(`It starts over on ${nextMonth()}.`)
	await expect(brief.getByRole("button", { name: "Answer again" })).toHaveCount(0)

	// The chat takes no question either, and says why.
	await page.keyboard.press("Escape")
	await page.getByRole("button", { name: "Chat about this article" }).click()
	const chat = page.getByTestId("chat")
	await expect(chat).toContainText(`It starts over on ${nextMonth()}.`)
	await expect(chat.getByRole("textbox")).toHaveCount(0)

	// Nothing reached the server: no thread, the count where it was, and no refusal counted.
	expect(await db.select().from(aiThreads).where(eq(aiThreads.userId, userId))).toHaveLength(0)
	const counts = await db
		.select({ metric: usageCounts.metric, count: usageCounts.count })
		.from(usageCounts)
		.where(eq(usageCounts.userId, userId))
	expect(counts.find((c) => c.metric === "ai")?.count).toBe(100)
	expect(counts.find((c) => c.metric === "refused")).toBeUndefined()
})

test("a question the server refuses at the cap turns the page to none left", async ({ page }) => {
	test.setTimeout(120_000)
	await page.setViewportSize({ width: 1440, height: 900 })
	const id = await open(page)
	// Another tab used the last one: this page still thinks there are some.
	await askedThisMonth(id, 100)
	await select(page, PASSAGE)
	await selectionToolbar(page).getByRole("button", { name: "Explain" }).click()
	const card = page.getByTestId("ai-card")
	await expect(card).toContainText(`It starts over on ${nextMonth()}.`)
	await expect(card.getByRole("button", { name: "Answer again" })).toHaveCount(0)
	await expect(page.getByTestId("brief")).toHaveClass(/opacity-50/)
	await page.keyboard.press("Escape")
	await select(page, "they understand the cost")
	await expect(selectionToolbar(page).getByRole("button", { name: "Explain" })).toHaveAttribute(
		"data-none-left",
		"true",
	)
})
