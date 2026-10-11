import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, documents, editionItems, editions, eq, highlights } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration, waitForSidebarPrefetch } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
// Without apostrophes: extraction may turn them curly.
const QUOTE_1 = "There are two types of schedule"
const QUOTE_2 = "Find an open slot in your schedule, book them"
const NOTE = "Why a single meeting can ruin a whole afternoon."

/**
 * An article with a note and two highlights, highlighted a week ago, and marked for the next
 * edition.
 */
async function readLastWeek(page: Page): Promise<string> {
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await expect
		.poll(
			async () => (await db.query.documents.findFirst({ where: eq(documents.id, id) }))?.status,
			{ timeout: 60_000 },
		)
		.toBe("ready")
	for (const [exact, note] of [
		[QUOTE_1, "The key distinction."],
		[QUOTE_2, null],
	] as const) {
		const created = await page.request.post(`/documents/${id}/highlights`, {
			data: { intent: "create", exact, note },
		})
		expect(created.status()).toBe(201)
	}
	expect((await page.request.post(`/documents/${id}/note`, { data: { note: NOTE } })).ok()).toBe(
		true,
	)
	// Seven days back is the same weekday of the week before, whatever the time zone.
	const weekAgo = new Date(Date.now() - 7 * 86_400_000)
	await db.update(highlights).set({ createdAt: weekAgo }).where(eq(highlights.documentId, id))
	const marked = await page.request.post(`/documents/${id}/state`, {
		form: { intent: "shortlist" },
	})
	expect(marked.ok()).toBe(true)
	return id
}

/** Waits for the editor's action (a choice, a publish) to come back. */
const editorAction = (page: Page, editionId: string) =>
	page.waitForResponse(
		(r) => r.request().method() === "POST" && r.url().includes(`/editions/${editionId}.data`),
	)

test("editions: pick, publish, update, unpublish, and nobody else's", async ({ page, browser }) => {
	test.setTimeout(180_000)
	// A hydration mismatch (dates the browser formats unlike the server) is an uncaught error.
	const errors: string[] = []
	const watch = (p: Page) => {
		p.on("pageerror", (error) => errors.push(error.message))
		p.on("console", (message) => {
			if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text())
		})
	}
	watch(page)
	await signupUser(page, "Editor")
	const documentId = await readLastWeek(page)

	// The article waits for the next edition. One button makes a draft that starts with it.
	await page.goto("/editions")
	await waitForHydration(page)
	await expect(page.getByTestId("editions-shortlist")).toContainText(
		"Maker's Schedule, Manager's Schedule",
	)
	// One mark, and no edition yet: not reason enough for the sidebar to nudge.
	await expect(page.getByTestId("editions-nav-dot")).toHaveCount(0)
	await expect(page.getByTestId("editions-nudge")).toHaveCount(0)
	await page.getByRole("button", { name: "Start the edition with it" }).click()
	await expect(page).toHaveURL(/\/editions\/[0-9a-f-]{36}$/)
	const editionId = page.url().split("/").pop()!
	await waitForHydration(page)
	// The sidebar still says where you are: in Editions.
	await expect(
		page.getByRole("navigation").getByRole("link", { name: /^Editions/ }),
	).toHaveAttribute("aria-current", "page")
	// No title: the field suggests one, and the page will show the date instead.
	const title = page.getByLabel("Title", { exact: true })
	await expect(title).toHaveValue("")
	await expect(title).toHaveAttribute("placeholder", "What I've read lately")
	await expect(title).toHaveAccessibleDescription(/the page shows the date as its title/)
	const pane = page.getByRole("complementary", { name: "Preview" })
	const DATE = /^[A-Z][a-z]+ \d{1,2}, \d{4}$/
	await expect(pane.getByRole("heading", { level: 1 })).toHaveText(DATE)

	// In it already. Removed, it leaves the shortlist too; undo brings both back.
	const item = page.getByTestId("edition-item")
	await expect(item).toHaveCount(1)
	await item.getByRole("button", { name: "Remove" }).click()
	await expect(item).toHaveCount(0)
	const toast = page.getByRole("status").filter({ hasText: "Removed, and unmarked" })
	await expect(toast).toBeVisible()
	await expect
		.poll(
			async () =>
				(await db.query.documents.findFirst({ where: eq(documents.id, documentId) }))
					?.shortlistedAt,
		)
		.toBeNull()
	await toast.getByRole("button", { name: "Undo" }).click()
	await expect(item).toHaveCount(1)
	await expect
		.poll(
			async () =>
				(await db.query.documents.findFirst({ where: eq(documents.id, documentId) }))
					?.shortlistedAt,
		)
		.not.toBeNull()

	// The picker lists it under the next edition, with what it holds, as added.
	await page.getByRole("button", { name: "Add articles" }).click()
	const marked = page.getByTestId("edition-shortlist")
	await expect(marked.getByRole("option").filter({ hasText: "2 highlights" })).toContainText(
		"Added",
	)
	await page.keyboard.press("Escape")
	await expect(marked).toBeHidden()

	// Include the note and both quotes.
	for (const name of ["Include my note", QUOTE_1, QUOTE_2]) {
		const box = item.getByRole("checkbox", { name })
		await Promise.all([editorAction(page, editionId), box.check()])
		await expect(box).toBeChecked()
	}
	await expect(item).toContainText(/\d+ \/ \d+ words quoted/)
	// Beside the editor (a desktop window is wide enough), the preview follows what was saved.
	await expect(pane.locator("blockquote")).toHaveCount(2)
	await expect(pane).toContainText(QUOTE_1)

	// Publish: the link appears.
	await Promise.all([
		editorAction(page, editionId),
		page.getByRole("button", { name: "Publish", exact: true }).click(),
	])
	const link = page.getByTestId("edition-public-link")
	await expect(link).toBeVisible()
	// Shared now: off the shortlist.
	await expect
		.poll(
			async () =>
				(await db.query.documents.findFirst({ where: eq(documents.id, documentId) }))
					?.shortlistedAt,
		)
		.toBeNull()
	const publicPath = new URL((await link.getAttribute("href"))!).pathname
	// Without a title, the address ends in the day it was first published.
	expect(publicPath).toMatch(/^\/e\/[0-9A-Za-z]{12}\/\d{4}-\d{2}-\d{2}$/)
	await expect(page.getByTestId("edition-status")).toContainText(/Published \w+ \d{1,2}, \d{4}/)

	// Signed out, the page shows what was chosen, and links to the original.
	const visitor = await (await browser.newContext()).newPage()
	watch(visitor)
	const res = await visitor.goto(publicPath)
	expect(res?.status()).toBe(200)
	expect(res?.headers()["x-robots-tag"]).toBe("noindex")
	expect(res?.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin")
	const editionDate = (await pane.getByRole("heading", { level: 1 }).textContent())!
	await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(editionDate)
	await expect(visitor).toHaveTitle(`${editionDate} · Editor`)
	await expect(visitor.getByText(NOTE)).toBeVisible()
	await expect(visitor.locator("blockquote")).toHaveCount(2)
	await expect(visitor.locator("blockquote").first()).toContainText(QUOTE_1)
	await expect(visitor.getByText("The key distinction.")).toBeVisible()
	const original = visitor.getByRole("heading", { level: 2 }).getByRole("link")
	await expect(original).toHaveAttribute("href", FIXTURE_URL)
	await expect(original).toHaveAttribute("rel", "nofollow ugc noopener")
	// Its link preview's picture is its own, drawn by the server: a 1200×630 PNG.
	const cardUrl = await visitor.locator('meta[property="og:image"]').getAttribute("content")
	expect(cardUrl).toMatch(/\/e\/[0-9A-Za-z]{12}\/og\.png\?v=[0-9a-z]+$/)
	const card = await visitor.request.get(cardUrl!)
	expect(card.status()).toBe(200)
	expect(card.headers()["content-type"]).toBe("image/png")
	const png = await card.body()
	expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])

	// An intro typed after publishing stays off the public page until Update.
	const INTRO = "Two schedules, one week."
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/editions/${editionId}/save`) && r.ok()),
		page.getByLabel("Introduction").fill(INTRO),
	])
	// Words linked in the editor with ⌘K (all of them: one key selects them on every platform).
	const intro = page.getByLabel("Introduction")
	await intro.press("ControlOrMeta+a")
	await intro.press("ControlOrMeta+k")
	await page.getByLabel("Link address").fill("example.com/week")
	// The link saves too; Update must not go out before it, or the page has changes again after.
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/editions/${editionId}/save`) && r.ok()),
		page.getByLabel("Link address").press("Enter"),
	])
	await expect(intro.getByRole("link", { name: INTRO })).toHaveAttribute(
		"href",
		"https://example.com/week",
	)
	// ⌘K was the editor's, not the command palette's.
	await expect(page.getByRole("dialog")).toHaveCount(0)
	await expect(page.getByTestId("edition-status")).toContainText("Unpublished changes")
	await visitor.reload()
	await expect(visitor.getByText(INTRO)).toHaveCount(0)
	await Promise.all([
		editorAction(page, editionId),
		page.getByRole("button", { name: "Update" }).click(),
	])
	await expect(page.getByTestId("edition-status")).not.toContainText("Unpublished changes")
	await visitor.reload()
	await expect(visitor.locator("main header")).toContainText(INTRO)
	await expect(visitor.getByRole("link", { name: INTRO })).toHaveAttribute(
		"href",
		"https://example.com/week",
	)
	// Updated the day it came out: the date in the title says enough, without "Updated <date>".
	await expect(visitor.locator("main header")).not.toContainText("Updated")
	// The only article is the one being read: the bar beside it is as tall as it is.
	const marker = visitor.getByTestId("edition-marker")
	await expect(marker).toHaveCSS("opacity", "1")
	const article = await visitor.locator("[data-edition-item]").boundingBox()
	await expect
		.poll(async () => Math.round((await marker.boundingBox())?.height ?? 0))
		.toBe(Math.round(article!.height))

	// Unpublished, the link says the page is gone. Published again, it is back at the same address.
	page.once("dialog", (dialog) => void dialog.accept())
	await Promise.all([
		editorAction(page, editionId),
		page.getByRole("button", { name: "Unpublish" }).click(),
	])
	await expect(page.getByTestId("edition-status")).toContainText("Unpublished")
	expect((await visitor.goto(publicPath))?.status()).toBe(410)
	expect((await visitor.request.get(cardUrl!)).status()).toBe(410)
	await Promise.all([
		editorAction(page, editionId),
		page.getByRole("button", { name: "Publish again" }).click(),
	])
	await expect(page.getByTestId("edition-public-link")).toBeVisible()
	expect((await visitor.goto(publicPath))?.status()).toBe(200)

	// Another user finds nothing: not the editor, not the preview, not the actions.
	const stranger = await (await browser.newContext()).newPage()
	await signupUser(stranger, "Stranger")
	// Requests with the stranger's session: statuses are the point, and a page load would prefetch.
	expect((await stranger.request.get(`/editions/${editionId}`)).status()).toBe(404)
	expect((await stranger.request.get(`/editions/${editionId}/preview`)).status()).toBe(404)
	const add = { intent: "add-item", documentId }
	expect((await stranger.request.post(`/editions/${editionId}/save`, { data: add })).status()).toBe(
		404,
	)
	expect(
		(
			await stranger.request.post(`/editions/${editionId}`, { data: { intent: "delete" } })
		).status(),
	).toBe(404)
	// The owner's edition is untouched.
	await page.reload()
	await expect(page.getByTestId("edition-item")).toHaveCount(1)
	await waitForHydration(page)
	expect(errors).toEqual([])
	// Contexts made here outlive the test in the shared browser, and slow the tests after it.
	await visitor.context().close()
	await stranger.context().close()
})

test("every account has editions, with no feature to turn on", async ({ page }) => {
	await signupUser(page, "Any Reader")
	await page.goto("/home")
	// Leaving Home before its sidebar prefetch ends reloads it, in Firefox and WebKit.
	await waitForSidebarPrefetch(page)
	await expect(page.getByRole("link", { name: /^Editions/ })).toBeVisible()
	expect((await page.goto("/editions"))?.status()).toBe(200)
})

test("three marked articles nudge for a new edition, until Not now", async ({ page }) => {
	const email = await signupUser(page, "Nudged")
	const owner = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) })
	for (const title of ["One", "Two", "Three"]) {
		const id = await insertArticle(owner!.id, title, `<p>${title}.</p>`)
		await db.update(documents).set({ shortlistedAt: new Date() }).where(eq(documents.id, id))
	}
	await page.goto("/library")
	await waitForHydration(page)
	const dot = page.getByTestId("editions-nav-dot").first()
	await expect(dot).toHaveAttribute("aria-label", "Your next edition is waiting")
	// The dot leads to why.
	await page
		.getByRole("link", { name: /^Editions/ })
		.first()
		.click()
	await expect(page).toHaveURL(/\/editions$/)
	await waitForHydration(page)
	const nudge = page.getByTestId("editions-nudge")
	await expect(nudge).toContainText("3 articles are marked for the next one.")
	await page.getByTestId("editions-desk").getByRole("button", { name: "Not now" }).click()
	await expect(nudge).toHaveCount(0)
	await expect(page.getByTestId("editions-nav-dot")).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Start the edition with these 3" })).toBeVisible()
})

test("with a draft started, marking adds to it, and a week on the page asks to publish it", async ({
	page,
}) => {
	const email = await signupUser(page, "Drafter")
	const owner = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) })
	const [first, second] = [
		await insertArticle(owner!.id, "First read", "<p>First.</p>"),
		await insertArticle(owner!.id, "Second read", "<p>Second.</p>"),
	]
	await db.update(documents).set({ shortlistedAt: new Date() }).where(eq(documents.id, first))
	await page.goto("/editions")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Start the edition with it" }).click()
	await expect(page).toHaveURL(/\/editions\/[0-9a-f-]{36}$/)
	const draftId = page.url().split("/").pop()!

	// Back on the page: the draft, not the marks again, and no way to start a second one.
	await page.goto("/editions")
	await waitForHydration(page)
	const desk = page.getByTestId("editions-desk")
	await expect(desk).toContainText("Draft")
	await expect(desk).toContainText("Started today")
	await expect(desk.getByTestId("editions-desk-items")).toHaveText(/First read/)
	await expect(page.getByTestId("editions-shortlist")).toHaveCount(0)
	await expect(page.getByRole("button", { name: /^Start/ })).toHaveCount(0)
	await expect(page.getByTestId("editions-nav-dot")).toHaveCount(0)

	// Marked while reading: into the draft.
	const marked = await page.request.post(`/documents/${second}/state`, {
		form: { intent: "shortlist" },
	})
	expect(marked.ok()).toBe(true)
	await page.reload()
	await waitForHydration(page)
	await expect(desk.getByTestId("editions-desk-items").getByRole("listitem")).toHaveText([
		/First read/,
		/Second read/,
	])
	await expect(desk.getByTestId("editions-desk-status")).toHaveText("Ready to publish")

	// Unmarked while reading: out of the draft, and Undo puts it back.
	await page.goto(`/read/${second}`)
	await waitForHydration(page)
	await page.keyboard.press("n")
	const toast = page.getByRole("status").filter({ hasText: "Removed from your next edition" })
	await expect(toast).toBeVisible()
	expect(
		await db.select().from(editionItems).where(eq(editionItems.editionId, draftId)),
	).toHaveLength(1)
	await Promise.all([
		page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/documents/bulk") && r.ok()),
		toast.getByRole("button", { name: "Undo" }).click(),
	])
	await page.goto("/editions")
	await waitForHydration(page)
	await expect(desk.getByTestId("editions-desk-items").getByRole("listitem")).toHaveText([
		/First read/,
		/Second read/,
	])

	// A week after it was started: the dot, and the desk asks to publish it.
	await db
		.update(editions)
		.set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
		.where(eq(editions.id, draftId))
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByTestId("editions-nav-dot").first()).toHaveAttribute(
		"aria-label",
		"Your next edition is waiting",
	)
	await expect(desk.getByTestId("editions-desk-status")).toHaveText(
		"You started it 8 days ago. Ready to publish it?",
	)
	await expect(desk.getByRole("link", { name: "Review and publish" })).toHaveAttribute(
		"href",
		`/editions/${draftId}`,
	)
	await desk.getByRole("button", { name: "Not now" }).click()
	await expect(desk.getByTestId("editions-desk-status")).toHaveText("Ready to publish")
	await expect(page.getByTestId("editions-nav-dot")).toHaveCount(0)
})

test("a note written at the end of an article goes into the next edition, in the author's voice", async ({
	page,
	browser,
}) => {
	test.setTimeout(150_000)
	await signupUser(page, "Ana Writer")
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	const stored = () => db.query.documents.findFirst({ where: eq(documents.id, id) })
	await expect.poll(async () => (await stored())?.status, { timeout: 60_000 }).toBe("ready")
	// A private note too, which the edition leaves out.
	await page.request.post(`/documents/${id}/note`, { data: { note: "Only for me." } })

	// At the end: no note to write until the article is marked.
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
	const end = page.getByTestId("reader-end")
	await expect(end).toBeAttached()
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
	const field = end.getByTestId("reader-end-edition-note")
	await expect(field).toHaveCount(0)
	await end.getByRole("button", { name: "Share in next edition" }).click()
	// What marking opened below the window scrolls into view, and says there is nothing to submit.
	await expect(field).toBeInViewport({ ratio: 1 })
	await expect(field).toContainText("Added to your next edition")
	await expect(field).toContainText("Saves as you type")
	const WHY = "One meeting can cost a maker a whole afternoon."
	const editor = field.getByRole("textbox", { name: "A note for your readers" })
	await editor.click()
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/edition-note`) && r.ok()),
		page.keyboard.type(WHY),
	])
	await expect.poll(async () => (await stored())?.editionNote).toBe(WHY)
	await expect(field).toContainText("Saved")
	if (process.env.SHOT_DIR)
		await end.screenshot({ path: `${process.env.SHOT_DIR}/reader-end-edition-note.png` })
	// Done leaves the article, as the back button does; ⌘↵ in the note does the same.
	await expect(field.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/library")
	await editor.press("ControlOrMeta+Enter")
	await expect(page).toHaveURL(/\/library$/)
	await waitForSidebarPrefetch(page)

	// Waiting for the edition, with what was written for it.
	await page.goto("/editions")
	await waitForHydration(page)
	await expect(page.getByTestId("shortlist-note")).toHaveText(WHY)

	// The new edition starts with it included, in the preview in its author's voice.
	await page.getByRole("button", { name: "Start the edition with it" }).click()
	await expect(page).toHaveURL(/\/editions\/[0-9a-f-]{36}$/)
	const editionId = page.url().split("/").pop()!
	await waitForHydration(page)
	const item = page.getByTestId("edition-item")
	await expect(item.getByRole("checkbox", { name: "Include my note" })).toBeChecked()
	const pane = page.getByRole("complementary", { name: "Preview" })
	await expect(pane.getByTestId("edition-item-note")).toContainText(WHY)
	await expect(pane).not.toContainText("Only for me.")
	if (process.env.SHOT_DIR)
		await pane.screenshot({ path: `${process.env.SHOT_DIR}/edition-preview-note.png` })

	await Promise.all([
		editorAction(page, editionId),
		page.getByRole("button", { name: "Publish", exact: true }).click(),
	])
	const link = page.getByTestId("edition-public-link")
	await expect(link).toBeVisible()
	const visitor = await (await browser.newContext()).newPage()
	await visitor.goto(new URL((await link.getAttribute("href"))!).pathname)
	const note = visitor.getByTestId("edition-item-note")
	await expect(note).toContainText(WHY)
	await expect(visitor.getByText("Only for me.")).toHaveCount(0)
})
