import { readFileSync } from "node:fs"
import { join } from "node:path"
import { db, documents, documentVersions, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
const QUOTE = "There are two types of schedule"

async function signupAndSave(page: Page): Promise<string> {
	await signupUser(page, "Marker", { verified: false })
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(QUOTE, { timeout: 60_000 })
	return id
}

/** Select `text` inside the article the way a user would (single text node). */
async function selectText(page: Page, text: string) {
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
			if (i >= 0) {
				const sel = window.getSelection() as Selection
				sel.removeAllRanges()
				const range = document.createRange()
				range.setStart(node, i)
				range.setEnd(node, i + needle.length)
				sel.addRange(range)
				return
			}
		}
		throw new Error(`text not found: ${needle}`)
	}, text)
}

/** Select from the start of `from` to the end of `to`, across whatever lies between them. */
async function selectBetween(page: Page, from: string, to: string) {
	await waitForHydration(page)
	await page.evaluate(
		([from, to]) => {
			const root = document.querySelector(".reader-content") as HTMLElement
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
			let start: Text | null = null
			for (
				let node = walker.nextNode() as Text | null;
				node;
				node = walker.nextNode() as Text | null
			) {
				if (!start) {
					const i = node.data.indexOf(from)
					if (i < 0) continue
					start = node
					var startAt = i
					continue
				}
				const j = node.data.indexOf(to)
				if (j < 0) continue
				const sel = window.getSelection() as Selection
				sel.removeAllRanges()
				const range = document.createRange()
				range.setStart(start, startAt!)
				range.setEnd(node, j + to.length)
				sel.addRange(range)
				return
			}
			throw new Error(`text not found: ${from} … ${to}`)
		},
		[from, to] as const,
	)
}

/** The middle of a few letters into `text`, where a click lands inside its highlight. */
function pointInText(page: Page, text: string) {
	return page.evaluate((needle) => {
		const root = document.querySelector(".reader-content") as HTMLElement
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
		for (
			let node = walker.nextNode() as Text | null;
			node;
			node = walker.nextNode() as Text | null
		) {
			const i = node.data.indexOf(needle)
			if (i >= 0) {
				const r = document.createRange()
				r.setStart(node, i + 3)
				r.setEnd(node, i + 8)
				const b = r.getBoundingClientRect()
				return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
			}
		}
		throw new Error("not found")
	}, text)
}

const highlightCount = (page: Page) => page.evaluate(() => CSS.highlights.get("klip-hl")?.size ?? 0)

const highlightSaved = (page: Page) =>
	page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST")

/** Select text, then choose Highlight in the selection's toolbar; resolves once it is saved. */
async function highlight(page: Page, select: () => Promise<void>) {
	await select()
	const toolbar = page.getByRole("dialog", { name: "Selected text" })
	await Promise.all([
		highlightSaved(page),
		toolbar.getByRole("button", { name: "Highlight" }).click(),
	])
}

test("highlight → persists → note → sidebar → highlights page → delete", async ({ page }) => {
	test.setTimeout(120_000)
	const id = await signupAndSave(page)

	// One word is a lookup: no toolbar. Two words offer one; nothing is highlighted on its own.
	const selected = page.getByRole("dialog", { name: "Selected text" })
	await selectText(page, "schedule")
	await page.waitForTimeout(1500)
	await expect(selected).toHaveCount(0)
	await selectText(page, QUOTE)
	await expect(selected).toBeVisible()
	await page.waitForTimeout(500)
	expect(await highlightCount(page)).toBe(0)
	// Copy from the selection's toolbar copies the text and closes it.
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
	await selected.getByRole("button", { name: "Copy text" }).click()
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(QUOTE)
	await expect(selected).toBeHidden()
	// Escape drops the selection and its toolbar.
	await selectText(page, QUOTE)
	await expect(selected).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(selected).toBeHidden()
	expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true)

	// Highlight: the highlight's own toolbar opens.
	await highlight(page, () => selectText(page, QUOTE))
	await expect.poll(() => highlightCount(page)).toBe(1)
	const created = page.getByRole("dialog", { name: "Edit highlight" })
	await expect(created).toBeVisible()
	await expect(selected).toBeHidden()
	// The selection is gone now: ⌘C copies the highlight's text instead, and so does the popover.
	await page.evaluate(() => navigator.clipboard.writeText(""))
	await page.keyboard.press("ControlOrMeta+c")
	await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible()
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(QUOTE)
	await page.evaluate(() => navigator.clipboard.writeText(""))
	await created.getByRole("button", { name: "Copy text" }).click()
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(QUOTE)
	await page.keyboard.press("Escape")
	await expect(created).toBeHidden()

	await page.reload()
	await expect(page.locator(".reader-content")).toContainText(QUOTE)
	await expect.poll(() => highlightCount(page)).toBe(1)

	// click inside the highlight → popover → add a note
	const point = await pointInText(page, QUOTE)
	await page.mouse.click(point.x, point.y)
	const popover = page.getByRole("dialog", { name: "Edit highlight" })
	await expect(popover).toBeVisible()
	// The highlight in focus stands out: a line around it.
	await expect(page.locator(".hl-outline")).not.toHaveCount(0)
	await expect(popover.getByRole("textbox")).toHaveCount(0)
	await popover.getByRole("button", { name: "Add note" }).click()
	await expect(popover).toBeHidden()
	const editor = page.getByRole("dialog", { name: "Highlight note" })
	await expect(editor).toHaveAttribute("data-placement", "margin")
	// The editor's chunk loads on demand: it is ready to type once it has the keyboard.
	await expect(editor.getByRole("textbox")).toBeFocused()
	await page.keyboard.type("Makers need long blocks.")
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		editor.getByRole("button", { name: "Save" }).click(),
	])
	await expect(editor).toBeHidden()

	// the note sits in the margin, level with the highlight's first line
	const margin = page.getByRole("region", { name: "Highlight notes" })
	const marginNote = margin.getByRole("button", { name: "Makers need long blocks." })
	await expect(marginNote).toBeVisible()
	const noteBox = await marginNote.boundingBox()
	expect(Math.abs((noteBox?.y ?? 0) - (point.y - 12))).toBeLessThan(20)

	// clicking the note edits it in place; Cancel keeps the saved text
	await marginNote.click()
	await expect(editor).toHaveAttribute("data-placement", "margin")
	await expect(editor.getByRole("textbox")).toBeFocused()
	await page.keyboard.type(" Draft.")
	await editor.getByRole("button", { name: "Cancel" }).click()
	await expect(marginNote).toBeVisible()

	// no room for the margin: the note opens in a floating editor
	await page.setViewportSize({ width: 1000, height: 720 })
	await expect(margin).toHaveCount(0)
	const narrow = await pointInText(page, QUOTE)
	await page.mouse.click(narrow.x, narrow.y)
	await popover.getByRole("button", { name: "Edit note" }).click()
	await expect(editor).toHaveAttribute("data-placement", "floating")
	await expect(editor.getByRole("textbox")).toHaveText("Makers need long blocks.")
	await expect(editor.getByRole("textbox")).toBeFocused()
	await page.keyboard.press("Escape")
	await page.setViewportSize({ width: 1280, height: 720 })
	await expect(marginNote).toBeVisible()

	// delete from the popover is immediate, with undo in a toast that names the note going with it
	await page.mouse.click(point.x, point.y)
	await expect(popover).toBeVisible()
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		popover.getByRole("button", { name: "Delete highlight" }).click(),
	])
	await expect.poll(() => highlightCount(page)).toBe(0)
	const undoToast = page.getByRole("status").filter({ hasText: "Highlight and its note removed" })
	await expect(undoToast).toBeVisible()
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		undoToast.getByRole("button", { name: "Undo" }).click(),
	])
	await expect.poll(() => highlightCount(page)).toBe(1)

	// sidebar lists it with the note
	await page.getByTestId("toggle-sidebar").click()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar).toContainText(QUOTE)
	await expect(sidebar).toContainText("Makers need long blocks.")

	// keyboard: the sidebar takes focus on open; j/k move, Enter jumps and keeps it open, Escape closes
	const LATER = "each day cut into one hour intervals"
	const second = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: LATER, color: 1 },
	})
	expect(second.status()).toBe(201)
	await page.reload()
	// Any stored color shows in the one color.
	await expect.poll(() => highlightCount(page)).toBe(2)
	await page.keyboard.press("h")
	const first = sidebar.getByRole("button", { name: QUOTE })
	const later = sidebar.getByRole("button", { name: LATER })
	await expect(sidebar).toBeFocused()
	await page.keyboard.press("ArrowDown")
	await expect(first).toBeFocused()
	await page.keyboard.press("j")
	await expect(later).toBeFocused()
	await page.keyboard.press("k")
	await expect(first).toBeFocused()
	await page.keyboard.press("ArrowDown")
	await page.keyboard.press("Enter")
	await expect(page.getByRole("button", { name: "Adjust highlight start" })).toBeFocused()
	await expect(sidebar).toBeVisible()
	await page.keyboard.press("Escape")
	await sidebar.focus()
	await page.keyboard.press("Escape")
	await expect(sidebar).toHaveCount(0)

	// API: creating by quote alone works; an ambiguous quote is rejected with 409
	const byQuote = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: "Maker's Schedule", color: 2 },
	})
	expect([201, 409]).toContain(byQuote.status())
	const ambiguous = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: "the" },
	})
	expect(ambiguous.status()).toBe(409)
	const missing = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: "zebra unicorn rainbow" },
	})
	expect(missing.status()).toBe(422)

	// highlights page shows the quote and note; the whole card opens the highlight in the reader
	await page.goto("/highlights")
	await expect(page.getByText(QUOTE)).toBeVisible()
	await expect(page.getByText("Makers need long blocks.")).toBeVisible()
	await page.getByRole("listitem").filter({ hasText: "Makers need long blocks." }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${id}#h=`))

	// search covers quotes and notes only
	await page.goto("/highlights?q=long%20blocks")
	await expect(page.getByText("Makers need long blocks.")).toBeVisible()
	await page.goto("/highlights?q=types%20of%20schedule")
	await expect(page.getByText(QUOTE)).toBeVisible()
	await page.goto("/highlights?q=zzzznotthere")
	await expect(page.getByText("No highlights match that search.")).toBeVisible()
	await page.goto("/highlights")
	// Hydrated, the delete stays on the page; before, it would post the form and leave.
	await waitForHydration(page)
	const noted = page.getByRole("listitem").filter({ hasText: "Makers need long blocks." })
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		noted.getByRole("button", { name: "Delete highlight" }).click(),
	])
	await expect(page.getByText("Makers need long blocks.")).toHaveCount(0)
	await expect(page.getByText(QUOTE)).toHaveCount(0)
})

test("the highlight popover scrolls with its highlight", async ({ page }) => {
	// Up to a minute for the extraction it highlights in.
	test.setTimeout(90_000)
	await signupAndSave(page)
	await highlight(page, () => selectText(page, QUOTE))
	const popover = page.getByRole("dialog", { name: "Edit highlight" })
	await expect(popover).toBeVisible()
	const gap = () =>
		page.evaluate(() => {
			const range = [...(CSS.highlights.get("klip-hl") ?? [])][0] as Range
			const toolbar = document.querySelector('[role="dialog"][data-placement="floating"]')
			return Math.round(
				(toolbar as Element).getBoundingClientRect().top - range.getBoundingClientRect().top,
			)
		})
	const before = await gap()

	// Scrolling re-renders the reader (reading progress): the popover must not follow the screen.
	const box = (await page.locator(".reader-content").boundingBox())!
	await page.mouse.move(box.x + box.width / 2, box.y + 200)
	await page.mouse.wheel(0, 400)
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
	await expect(page.getByTestId("reading-progress")).not.toHaveAttribute("style", /scaleX\(0\)/)
	expect(await gap()).toBe(before)
})

test("a copied highlight reads as the page shows it: paragraphs apart, wrapped lines joined", async ({
	page,
}) => {
	// Up to a minute for the extraction whose paragraphs it copies.
	test.setTimeout(90_000)
	await signupAndSave(page)
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
	// The source wraps its lines and separates paragraphs with two <br>s; the stored text keeps
	// all of that as it is.
	await highlight(page, () =>
		selectBetween(page, "There are two types of schedule", "practical problem to meet"),
	)
	await expect(page.getByRole("dialog", { name: "Edit highlight" })).toBeVisible()
	await page.keyboard.press("ControlOrMeta+c")
	await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible()
	const text = await page.evaluate(() => navigator.clipboard.readText())
	expect(text.split("\n\n")).toEqual([
		"There are two types of schedule, which I'll call the manager's schedule and the maker's " +
			"schedule. The manager's schedule is for bosses. It's embodied in the traditional " +
			"appointment book, with each day cut into one hour intervals. You can block off several " +
			"hours for a single task if you need to, but by default you change what you're doing " +
			"every hour.",
		"When you use time that way, it's merely a practical problem to meet",
	])
})

test("the reader's own changes do not load the article again", async ({ page }) => {
	const email = await signupUser(page, "Reloads")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const text = `${QUOTE}, which I call the manager's schedule and the maker's schedule.`
	// Extracted, with its images done, and opened before: nothing on the server is left to change it.
	const id = await insertArticle(owner!.id, "Reloads", `<p>${text}</p>`)
	await db.update(documentVersions).set({ text }).where(eq(documentVersions.documentId, id))
	await db.update(documents).set({ firstOpenedAt: new Date() }).where(eq(documents.id, id))
	await page.goto(`/read/${id}`)
	await waitForHydration(page)

	// From here on, any load of the reader's data resends the whole article.
	const reloads: string[] = []
	page.on("request", (r) => {
		const url = new URL(r.url())
		const routes = url.searchParams.get("_routes")
		if (url.pathname === `/read/${id}.data` && (routes ?? "routes/read").includes("routes/read"))
			reloads.push(r.url())
	})
	const saved = (path: string) =>
		page.waitForResponse((r) => r.url().includes(path) && r.request().method() === "POST")
	const bar = page.getByRole("banner")
	await Promise.all([
		saved("/state"),
		bar.getByRole("button", { name: "Star", exact: true }).click(),
	])
	await expect(bar.getByRole("button", { name: "Unstar", exact: true })).toBeVisible()
	await bar.getByRole("button", { name: "More actions" }).click()
	await Promise.all([saved("/state"), page.getByRole("menuitem", { name: "Archive" }).click()])
	await bar.getByRole("button", { name: "More actions" }).click()
	await expect(page.getByRole("menuitem", { name: "Move to library" })).toBeVisible()
	await page.keyboard.press("Escape")
	await highlight(page, () => selectText(page, QUOTE))
	await expect.poll(() => highlightCount(page)).toBe(1)
	const toolbar = page.getByRole("dialog", { name: "Edit highlight" })
	await Promise.all([
		saved("/highlights"),
		toolbar.getByRole("button", { name: "Delete highlight" }).click(),
	])
	await expect.poll(() => highlightCount(page)).toBe(0)
	expect(reloads).toEqual([])

	// Every change is on the server all the same.
	await page.reload()
	// The server's page shows the state before it can open a menu.
	await waitForHydration(page)
	await expect(bar.getByRole("button", { name: "Unstar", exact: true })).toBeVisible()
	await bar.getByRole("button", { name: "More actions" }).click()
	await expect(page.getByRole("menuitem", { name: "Move to library" })).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(page.locator(".reader-content")).toContainText(QUOTE)
	expect(await highlightCount(page)).toBe(0)
})

test("a highlight the server refuses goes away again", async ({ page }) => {
	const email = await signupUser(page, "Refused highlight")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(
		owner!.id,
		"Refused",
		"<p>Alpha bravo charlie delta echo foxtrot.</p>",
	)
	await page.goto(`/read/${id}`)
	// The server's copy of the text changes under the page: the passage is no longer there.
	await db
		.update(documentVersions)
		.set({ text: "Something else entirely." })
		.where(eq(documentVersions.documentId, id))
	await highlight(page, () => selectText(page, "charlie delta"))
	await expect(page.getByText("That text is not in the article.")).toBeVisible()
	await expect.poll(() => highlightCount(page)).toBe(0)
})

test("an article captured again stays readable, and takes highlights once the new copy lands", async ({
	page,
}) => {
	const email = await signupUser(page, "Recaptured")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(
		owner!.id,
		"Recaptured",
		"<p>Alpha bravo charlie delta echo foxtrot.</p>",
	)
	await db.update(documents).set({ status: "processing" }).where(eq(documents.id, id))
	const posts: string[] = []
	page.on("request", (r) => {
		if (r.url().includes("/highlights") && r.method() === "POST") posts.push(r.url())
	})
	// The selection waits out a debounce: fast-forward it instead of sleeping.
	await page.clock.install()
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText("charlie delta")
	await expect(
		page.getByRole("status").filter({ hasText: "A new copy of this page" }),
	).toBeVisible()
	await selectText(page, "charlie delta")
	await page.clock.runFor(1_000)
	await expect(page.getByRole("dialog", { name: "Selected text" })).toHaveCount(0)
	expect(posts).toEqual([])

	await db.update(documents).set({ status: "ready" }).where(eq(documents.id, id))
	await page.reload()
	await expect(page.getByRole("status").filter({ hasText: "A new copy of this page" })).toHaveCount(
		0,
	)
	await highlight(page, async () => {
		await selectText(page, "charlie delta")
		await page.clock.runFor(1_000)
	})
})
