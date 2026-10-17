import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { caretToEnd, signupUser, waitForHydration } from "./helpers"

const pages = join(import.meta.dirname, "../../../packages/extract/test/fixtures/pages")
const MAKERS = {
	file: join(pages, "paulgraham-makers.html"),
	url: "https://paulgraham.com/makersschedule.html",
	quote: "There are two types of schedule",
}
const JOEL = {
	file: join(pages, "joelonsoftware-joel-test.html"),
	url: "https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/",
	title: "The Joel Test: 12 Steps to Better Code",
	quote: "source control",
}

async function signup(page: Page) {
	await signupUser(page, "Linker", { verified: false })
}

async function save(page: Page, fixture: { file: string; url: string }): Promise<string> {
	const res = await page.request.post("/api/documents", {
		data: { url: fixture.url, html: readFileSync(fixture.file, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	return id
}

/** The sidebar stays open across a chip's client-side navigation: only toggle it when it is shut. */
async function openSidebar(page: Page) {
	const toggle = page.getByTestId("toggle-sidebar")
	if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click()
	await expect(page.getByRole("complementary", { name: "Notes and highlights" })).toBeVisible()
}

async function open(page: Page, id: string, quote: string) {
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(quote, { timeout: 60_000 })
	await waitForHydration(page)
}

test("note links: chips read, navigate, backlink and export", async ({ page }) => {
	test.setTimeout(180_000)
	await signup(page)
	const makers = await save(page, MAKERS)
	const joel = await save(page, JOEL)
	await open(page, joel, JOEL.quote)

	// `[[` in the article note: the menu opens, Enter picks, a chip lands in the text.
	await open(page, makers, MAKERS.quote)
	await openSidebar(page)
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	const note = sidebar.getByLabel("Your note", { exact: true })
	await note.click()
	await page.keyboard.type("Compare with ")
	await page.keyboard.type("[[Joel")
	const menu = page.getByTestId("note-link-menu")
	await expect(menu.getByTestId("note-link-option").first()).toContainText(JOEL.title)
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/documents/${makers}/note`) && r.ok()),
		page.keyboard.press("Enter"),
	])
	await expect(menu).toHaveCount(0)
	await expect(note.getByTestId("doc-chip")).toHaveText(JOEL.title)

	// A link in a highlight's note too.
	const hl = await page.request.post(`/documents/${makers}/highlights`, {
		data: {
			intent: "create",
			exact: MAKERS.quote,
			note: `Like [${JOEL.title}](/read/${joel}) says.`,
		},
	})
	expect(hl.status()).toBe(201)

	await page.reload()
	await waitForHydration(page)
	await openSidebar(page)
	// The article note keeps its chip. The highlight's note shows the title as plain text: the row
	// itself is the only thing to click, and it goes to the highlight.
	await expect(sidebar.getByTestId("doc-chip")).toHaveCount(1)
	await expect(sidebar.getByTestId("doc-chip")).toHaveText(JOEL.title)
	const asText = sidebar.getByTestId("doc-link-text")
	await expect(asText).toHaveText(JOEL.title)
	await expect(asText).toHaveAttribute("data-status", "ok")
	await expect(sidebar.getByRole("link", { name: JOEL.title })).toHaveCount(0)

	// In the Notebook the highlight's note link is a real link, and it opens its article. (The
	// article's own note is there too, in its editor: its chip is the editor's.)
	await page.goto("/notebook")
	await waitForHydration(page)
	const pageChip = page.getByTestId("quote-card").getByTestId("doc-chip").first()
	await expect(pageChip).toHaveText(JOEL.title)
	await pageChip.click()
	await expect(page).toHaveURL(new RegExp(`/read/${joel}$`))
	await expect(page.locator(".reader-content")).toContainText(JOEL.quote, { timeout: 60_000 })
	await waitForHydration(page)
	await openSidebar(page)
	const backlinks = page.getByTestId("backlinks")
	await expect(backlinks.getByRole("heading", { name: "Linked from your notes" })).toBeVisible()
	// Both notes link here, and the highlight's row shows its quote.
	await expect(backlinks.getByRole("listitem")).toHaveCount(2)
	await expect(backlinks).toContainText(MAKERS.quote)
	await backlinks.getByRole("link").first().click()
	await expect(page).toHaveURL(new RegExp(`/read/${makers}`))
})

test("note links: trashing an article says how many notes link to it", async ({ page }) => {
	test.setTimeout(180_000)
	await signup(page)
	const makers = await save(page, MAKERS)
	const joel = await save(page, JOEL)
	await open(page, makers, MAKERS.quote)
	const hl = await page.request.post(`/documents/${makers}/highlights`, {
		data: {
			intent: "create",
			exact: MAKERS.quote,
			note: `See [${JOEL.title}](/read/${joel}).`,
		},
	})
	expect(hl.status()).toBe(201)

	await page.goto("/library")
	await waitForHydration(page)
	const card = page.locator("li", { hasText: JOEL.title }).first()
	await card.getByRole("button", { name: "More actions" }).click()
	await page.getByRole("menuitem", { name: "Delete" }).click()
	const toast = page.getByRole("status")
	await expect(toast).toHaveText(/Deleted · a note links here/)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/delete-backlink-toast.png` })

	// Undo brings it back, links and all.
	await toast.getByRole("button", { name: "Undo" }).click()
	await expect(page.locator("li", { hasText: JOEL.title }).first()).toBeVisible()

	// An article nothing links to just says "Deleted".
	const plain = page.locator("li", { hasText: "Maker" }).first()
	await plain.getByRole("button", { name: "More actions" }).click()
	await page.getByRole("menuitem", { name: "Delete" }).click()
	await expect(page.getByRole("status")).toHaveText(/^Deleted/)
	await expect(page.getByRole("status")).not.toContainText("links here")
})

test("note links: a link to a trashed article is struck through", async ({ page }) => {
	test.setTimeout(180_000)
	await signup(page)
	const makers = await save(page, MAKERS)
	const joel = await save(page, JOEL)
	await open(page, makers, MAKERS.quote)
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	const hl = await page.request.post(`/documents/${makers}/highlights`, {
		data: {
			intent: "create",
			exact: MAKERS.quote,
			note: `Gone: [${JOEL.title}](/read/${joel}) and [Nobody](/read/00000000-0000-0000-0000-000000000000)`,
		},
	})
	expect(hl.status()).toBe(201)
	await page.request.post(`/documents/${joel}/state`, { form: { intent: "delete" } })

	await page.reload()
	await waitForHydration(page)
	await openSidebar(page)
	// In the sidebar the highlight's note shows its links as text, still marked by their state.
	const links = sidebar.getByTestId("doc-link-text")
	await expect(links.nth(0)).toHaveAttribute("data-status", "trash")
	await expect(links.nth(1)).toHaveAttribute("data-status", "missing")
})

test("note links: the margin editor links, and Escape leaves the typed text alone", async ({
	page,
}) => {
	test.setTimeout(180_000)
	await signup(page)
	const makers = await save(page, MAKERS)
	const joel = await save(page, JOEL)
	await open(page, joel, JOEL.quote)
	const hl = await page.request.post(`/documents/${makers}/highlights`, {
		data: { intent: "create", exact: MAKERS.quote, note: "Makers need long blocks." },
	})
	expect(hl.status()).toBe(201)
	await open(page, makers, MAKERS.quote)

	// The margin note opens its editor in place; `[[` links from there.
	const margin = page.getByRole("region", { name: "Highlight notes" })
	const marginNote = margin.getByRole("button", { name: "Makers need long blocks." })
	await expect(marginNote).toBeVisible()
	await marginNote.click()
	const editor = page.getByRole("dialog", { name: "Highlight note" })
	await expect(editor).toHaveAttribute("data-placement", "margin")
	await expect(editor.getByRole("textbox")).toBeFocused()
	await page.keyboard.type(" See [[Joel")
	const menu = page.getByTestId("note-link-menu")
	await expect(menu.getByTestId("note-link-option").first()).toContainText(JOEL.title)
	await page.keyboard.press("Enter")
	await expect(editor.getByTestId("doc-chip")).toHaveText(JOEL.title)
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/highlights") && r.request().method() === "POST"),
		editor.getByRole("button", { name: "Save" }).click(),
	])
	await expect(margin.getByTestId("doc-chip")).toHaveText(JOEL.title)

	// The Notebook shows the same chip.
	await page.goto("/notebook")
	await waitForHydration(page)
	await expect(page.getByTestId("quote-card").getByTestId("doc-chip").first()).toHaveText(
		JOEL.title,
	)

	// Escape closes the menu and leaves `[[abc` as plain text, which survives a reload.
	await open(page, makers, MAKERS.quote)
	await openSidebar(page)
	const note = page
		.getByRole("complementary", { name: "Notes and highlights" })
		.getByLabel("Your note", { exact: true })
	await note.fill("")
	await note.click()
	// Watch for the save before typing: the note autosaves on a debounce, so on a slow run it has
	// already gone out by the time we blur, and a wait tied to the blur would never see one.
	const saved = page.waitForResponse((r) => r.url().endsWith(`/documents/${makers}/note`) && r.ok())
	await page.keyboard.type("[[abc")
	await expect(menu).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(menu).toHaveCount(0)
	await note.blur()
	await saved
	await page.reload()
	await waitForHydration(page)
	await openSidebar(page)
	await expect(note).toHaveText("[[abc")
	await expect(note.getByTestId("doc-chip")).toHaveCount(0)
})

test("note links: @ and the Link article button open the same menu", async ({ page }) => {
	test.setTimeout(180_000)
	await signup(page)
	const makers = await save(page, MAKERS)
	const joel = await save(page, JOEL)
	await open(page, joel, JOEL.quote)
	await open(page, makers, MAKERS.quote)
	await openSidebar(page)
	const note = page
		.getByRole("complementary", { name: "Notes and highlights" })
		.getByLabel("Your note", { exact: true })
	const menu = page.getByTestId("note-link-menu")

	// `@` costs one keyboard layer on a phone, where `[` costs two.
	await note.click()
	await page.keyboard.type("also @Joel")
	await expect(menu.getByTestId("note-link-option").first()).toContainText(JOEL.title)
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith(`/documents/${makers}/note`) && r.ok()),
		page.keyboard.press("Enter"),
	])
	await expect(note.getByTestId("doc-chip")).toHaveText(JOEL.title)
	expect(joel).toBeTruthy()

	// The button types the trigger for you, and leaves the caret in the note. To its end first: a
	// click in the middle of the note can land on the link, which selects it instead of a caret.
	await note.click()
	await caretToEnd(page)
	await page.getByTestId("link-article").click()
	await expect(menu).toBeVisible()
	await expect(menu.getByText("Recent")).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(menu).toHaveCount(0)
})

test("content links: articles that link to each other are connected, whichever came first", async ({
	page,
}) => {
	test.setTimeout(180_000)
	await signup(page)
	const paragraph =
		"This paragraph exists so the extractor keeps the article. It says nothing of interest, but it is long enough to count as content, and it repeats that idea a few more times for good measure. "
	const html = `<!DOCTYPE html><html><head><title>Linky</title></head><body><article><h1>Linky</h1>
		<p>${paragraph}</p><p>Read <a href="${MAKERS.url}?utm_source=linky">the makers essay</a> first.</p>
		<p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`
	const res = await page.request.post("/api/documents", {
		data: { url: "https://example.com/linky", html },
	})
	const { id: linky } = ((await res.json()) as { article: { id: string } }).article

	// Nothing to connect to yet: the article it links to is not in the library.
	await open(page, linky, "the makers essay")
	await openSidebar(page)
	await expect(page.getByTestId("content-links-to")).toHaveCount(0)

	// Saved afterwards, it is connected both ways, and the note links section stays out of it.
	const makers = await save(page, MAKERS)
	await open(page, makers, MAKERS.quote)
	await openSidebar(page)
	await expect(page.getByTestId("backlinks")).toHaveCount(0)
	const linkedFrom = page.getByTestId("content-links-from")
	await expect(linkedFrom.getByRole("heading", { name: "Linked from articles" })).toBeVisible()
	await linkedFrom.getByRole("link", { name: "Linky" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${linky}$`))
	await expect(page.locator(".reader-content")).toContainText("the makers essay")
	await openSidebar(page)
	const linksTo = page.getByTestId("content-links-to")
	await expect(linksTo.getByRole("heading", { name: "Links to saved articles" })).toBeVisible()
	await expect(linksTo.getByRole("listitem")).toHaveCount(1)

	// In the trash, the article at the other end connects nothing.
	await page.request.post(`/documents/${makers}/state`, { form: { intent: "delete" } })
	await page.reload()
	await expect(page.locator(".reader-content")).toContainText("the makers essay")
	await openSidebar(page)
	await expect(page.getByTestId("content-links-to")).toHaveCount(0)
})

test("a shared note's links lead to the linked articles' originals", async ({ page }) => {
	test.setTimeout(120_000)
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
	await signup(page)
	const makers = await save(page, MAKERS)
	const joel = await save(page, JOEL)
	await open(page, joel, JOEL.quote)
	await open(page, makers, MAKERS.quote)
	const hl = await page.request.post(`/documents/${makers}/highlights`, {
		data: {
			intent: "create",
			exact: MAKERS.quote,
			note: `Like [${JOEL.title}](/read/${joel}) says.`,
		},
	})
	expect(hl.status()).toBe(201)

	await page.goto("/notebook?view=stream")
	await waitForHydration(page)
	const card = page.getByTestId("quote-card").filter({ hasText: MAKERS.quote })
	await card.hover()
	await card.getByRole("button", { name: "Share" }).click()
	const share = page.getByRole("dialog", { name: "Share highlight" })
	await share.getByRole("button", { name: "Copy text" }).click()
	await expect(share).toBeHidden()
	// As saved: without its trailing slash.
	const joelUrl = JOEL.url.replace(/\/$/, "")
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain(`\n\nLike [${JOEL.title}](${joelUrl}) says.\n\n`)
	const html = await page.evaluate(async () => {
		const [item] = await navigator.clipboard.read()
		return item ? (await item.getType("text/html")).text() : ""
	})
	expect(html).toContain(`<p>Like <a href="${joelUrl}">${JOEL.title}</a> says.</p>`)
	expect(html).not.toContain("/read/")
})
