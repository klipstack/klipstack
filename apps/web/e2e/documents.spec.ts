import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
	and,
	db,
	documents,
	documentTopics,
	eq,
	readingCompletions,
	topics,
	user,
} from "@klipstack/db"
import { expect, type Locator, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"

/** Secondary card actions sit behind the first card's "…" menu. */
/** The answer to one article change: reading progress posts to the same address meanwhile. */
function stateSaved(page: Page, intent: string) {
	return page.waitForResponse(
		(r) =>
			r.url().includes("/state") &&
			r.request().method() === "POST" &&
			new URLSearchParams(r.request().postData() ?? "").get("intent") === intent,
	)
}

async function openMenuAnd(page: Page, item: string) {
	await page.getByRole("button", { name: "More actions" }).first().click()
	await page.getByRole("menuitem", { name: item }).click()
}

async function signup(page: Page) {
	await signupUser(page, "Reader", { verified: false })
	// The scenarios here start from the library.
	await page.goto("/library")
}

test("shared links need confirmation and cross-origin POST cannot save", async ({
	page,
	baseURL,
}) => {
	const email = await signupUser(page, "Share confirmation")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const url = `https://example.com/shared-${Date.now()}`
	const saved = () =>
		db
			.select()
			.from(documents)
			.where(and(eq(documents.userId, owner!.id), eq(documents.sourceUrl, url)))
	await page.route("https://untrusted.example/", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<a href="${baseURL}/add?url=${encodeURIComponent(url)}">Shared link</a>`,
		}),
	)
	await page.goto("https://untrusted.example/")
	await page.getByRole("link", { name: "Shared link" }).click()
	await expect(page.getByLabel("URL", { exact: true })).toHaveValue(url)
	expect(await saved()).toHaveLength(0)
	const csrf = await page.request.post("/add", {
		headers: { origin: "https://untrusted.example" },
		form: { url },
	})
	expect([400, 403]).toContain(csrf.status())
	expect(await saved()).toHaveLength(0)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Save", exact: true }).click()
	await expect(page).toHaveURL(/\/read\//)
	expect(await saved()).toHaveLength(1)
})

test("save via API with captured html → extracted → readable → archive", async ({ page }) => {
	test.setTimeout(90_000)
	await signup(page)

	const html = readFileSync(FIXTURE, "utf8")
	const res = await page.request.post("/api/documents", { data: { url: FIXTURE_URL, html } })
	expect(res.status()).toBe(202)
	const body = ((await res.json()) as { article: { id: string; status: string } }).article
	expect(body.status).toBe("queued")

	await page.goto("/library")
	const link = page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" })
	await expect(link).toBeVisible({ timeout: 60_000 })
	await link.click()
	await expect(page).toHaveURL(new RegExp(`/read/${body.id}$`))
	await expect(
		page.getByRole("heading", { level: 1, name: "Maker's Schedule, Manager's Schedule" }),
	).toBeVisible()
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")

	// rename: the reader, the tab title and the library all follow
	await page.getByRole("button", { name: "Edit title" }).click()
	await page.getByLabel("Title").fill("Makers vs managers")
	await Promise.all([
		stateSaved(page, "rename"),
		page.getByRole("button", { name: "Save", exact: true }).click(),
	])
	await expect(page.getByRole("heading", { level: 1, name: "Makers vs managers" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Edit title" })).toBeVisible()
	await expect(page).toHaveTitle(/Makers vs managers/)

	// progress bar under the header follows the scroll; reopening resumes there
	const bar = page.getByTestId("reading-progress")
	const scaleOf = async () => bar.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)
	expect(await scaleOf()).toBeLessThan(0.3)
	await page.evaluate(() => {
		const el = document.documentElement
		window.scrollTo(0, (el.scrollHeight - el.clientHeight) * 0.5)
	})
	await page.waitForResponse(
		(r) =>
			r.url().includes("/state") &&
			r.request().method() === "POST" &&
			(r.request().postData() ?? "").includes("progress"),
	)
	await expect.poll(scaleOf).toBeGreaterThan(0.4)
	// A bookmark ribbon: its notched end hangs where the band ends, and never widens the page.
	const right = async (el: Locator) => {
		const b = (await el.boundingBox())!
		return Math.round(b.x + b.width)
	}
	const end = page.getByTestId("reading-progress-end").locator("div")
	await expect.poll(async () => Math.abs((await right(end)) - (await right(bar)))).toBeLessThan(2)
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
	await page.goto(`/read/${body.id}`)
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
	await waitForHydration(page)

	// scrolling back up before leaving is remembered too (position, not just max progress).
	// The save reloads nothing: the article would come down again with every scroll save.
	const reloads: string[] = []
	page.on("request", (r) => {
		if (r.method() === "GET" && r.url().includes(".data")) reloads.push(r.url())
	})
	await page.evaluate(() => {
		const el = document.documentElement
		window.scrollTo(0, (el.scrollHeight - el.clientHeight) * 0.1)
	})
	await page.waitForResponse(
		(r) =>
			r.url().includes("/state") &&
			r.request().method() === "POST" &&
			(r.request().postData() ?? "").includes("progress"),
	)
	// React Router starts a revalidation as soon as the action answers; give it time to show.
	await page.waitForTimeout(500)
	expect(reloads.filter((url) => url.includes("/read/"))).toEqual([])
	await page.goto(`/read/${body.id}`)
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	await waitForHydration(page)
	const resumed = await page.evaluate(() => {
		const el = document.documentElement
		return window.scrollY / (el.scrollHeight - el.clientHeight)
	})
	expect(resumed).toBeLessThan(0.3)
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toHaveCount(0)

	// saving the same URL again is idempotent
	const again = await page.request.post("/api/documents", {
		data: { url: `${FIXTURE_URL}?utm_source=test` },
	})
	expect(again.status()).toBe(200)
	expect(((await again.json()) as { article: { id: string } }).article.id).toBe(body.id)

	// finishing from the reader archives it and goes back to the list it was opened from
	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Makers vs managers" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${body.id}$`))
	// The address changes before the reader is on screen: scroll it, not the list.
	await expect(page.locator(".reader-content")).toBeVisible()
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
	const finish = page.getByRole("button", { name: "Mark as finished" })
	await finish.click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toHaveCount(0)
	const completionHistory = () =>
		db.select().from(readingCompletions).where(eq(readingCompletions.documentId, body.id))
	const finishedHistory = await completionHistory()
	expect(finishedHistory).toHaveLength(1)
	await page.goto("/archive")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Makers vs managers" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${body.id}$`))
	await page.getByRole("button", { name: "More actions" }).click()
	await Promise.all([
		stateSaved(page, "unarchive"),
		page.getByRole("menuitem", { name: "Move to library" }).click(),
	])
	expect(await completionHistory()).toEqual(finishedHistory)
	await page.goto("/library")
	await waitForHydration(page)
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toBeVisible()
	await page.getByRole("link", { name: "Makers vs managers" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${body.id}$`))
	await waitForHydration(page)

	// archive from the reader, then it shows in the archive view only
	await page.getByRole("button", { name: "More actions" }).click()
	await Promise.all([
		stateSaved(page, "archive"),
		page.getByRole("menuitem", { name: "Archive" }).click(),
	])
	await page.goto("/library")
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toHaveCount(0)
	await page.goto("/archive")
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toBeVisible()

	// star it, see it under starred
	await waitForHydration(page)
	await Promise.all([
		stateSaved(page, "star"),
		page.getByRole("button", { name: "Star" }).first().click(),
	])
	await page.goto("/starred")
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toBeVisible()

	// delete shows an undo toast instead of a confirm dialog; undo brings it back
	await waitForHydration(page)
	await Promise.all([stateSaved(page, "delete"), openMenuAnd(page, "Delete")])
	const toast = page.getByRole("status").filter({ hasText: "Deleted" })
	await expect(toast).toBeVisible()
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toHaveCount(0)
	await Promise.all([
		stateSaved(page, "restore"),
		toast.getByRole("button", { name: "Undo" }).click(),
	])
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toBeVisible()

	// deleting from the reader returns to its list instead of reloading the deleted article
	await page.getByRole("link", { name: "Makers vs managers" }).click()
	// The list's cards have the same menu: act only once the reader is on screen.
	await expect(page.getByRole("heading", { level: 1, name: "Makers vs managers" })).toBeVisible()
	await Promise.all([stateSaved(page, "delete"), openMenuAnd(page, "Delete")])
	await expect(page).toHaveURL(/\/starred$/)
	await expect(page.getByText("This article does not exist or was deleted.")).toHaveCount(0)
	const readerToast = page.getByRole("status").filter({ hasText: "Deleted" })
	await Promise.all([
		stateSaved(page, "restore"),
		readerToast.getByRole("button", { name: "Undo" }).click(),
	])
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toBeVisible()

	// the trash: deleted articles wait there; restore, or delete forever with a second tap
	await page.goto("/starred")
	await waitForHydration(page)
	await Promise.all([stateSaved(page, "delete"), openMenuAnd(page, "Delete")])
	await page.goto("/trash")
	await waitForHydration(page)
	await expect(page.getByText("Makers vs managers")).toBeVisible()
	await Promise.all([
		stateSaved(page, "restore"),
		page.getByRole("button", { name: "Restore" }).click(),
	])
	await expect(page.getByText("Makers vs managers")).toHaveCount(0)
	await page.goto("/archive")
	await waitForHydration(page)
	await expect(page.getByRole("link", { name: "Makers vs managers" })).toBeVisible()
	await Promise.all([stateSaved(page, "delete"), openMenuAnd(page, "Delete")])
	await page.goto("/trash")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Delete forever" }).click()
	await Promise.all([
		stateSaved(page, "purge"),
		page.getByRole("button", { name: "Tap again to delete forever" }).click(),
	])
	await expect(page.getByText("Makers vs managers")).toHaveCount(0)
	await expect(page.getByRole("heading", { name: "Trash is empty" })).toBeVisible()
	const gone = await page.request.get(`/read/${body.id}`)
	expect(gone.status()).toBe(404)
	expect(await completionHistory()).toEqual([])
})

test("an open library sees saves from elsewhere and their extraction finishing (live updates)", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await signup(page)
	await waitForHydration(page)
	// no navigation from here on: only server-sent events can change the page
	const navigations: string[] = []
	page.on("framenavigated", (f) => {
		if (f === page.mainFrame()) navigations.push(f.url())
	})
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	expect(res.status()).toBe(202)
	await expect(page.getByText("Maker's Schedule, Manager's Schedule")).toBeVisible({
		timeout: 60_000,
	})
	await expect(
		page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" }),
	).toBeVisible({ timeout: 60_000 })
	expect(navigations).toEqual([])
	// Reading state stays on the article; the Library link has no unread count.
	const badge = page.getByRole("complementary").getByTestId("unread-badge")
	await expect(badge).toHaveCount(0)
	await expect(
		page.getByRole("complementary").getByRole("link", { name: "Library", exact: true }),
	).toHaveText("Library")
	await expect(page.getByTestId("unread-dot")).toHaveCount(1)
	// opened and left right away, it is still new
	const article = page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" })
	await article.click()
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(badge).toHaveCount(0)
	await expect(page.getByTestId("unread-dot")).toHaveCount(1)
	// scrolled a screen down, it is not
	await article.click()
	await expect(page.locator(".reader-content")).toContainText("There are two types of schedule")
	await Promise.all([
		page.waitForResponse(async (r) => {
			const body = r.request().postData() ?? ""
			return r.url().includes("/state") && body.includes("intent=open")
		}),
		page.mouse.wheel(0, (page.viewportSize()?.height ?? 720) * 1.5),
	])
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(badge).toHaveCount(0)
	await expect(page.getByTestId("unread-dot")).toHaveCount(0)
	// and back to unread, which also resets progress
	await Promise.all([stateSaved(page, "unread"), openMenuAnd(page, "Mark as unread")])
	await expect(page.getByTestId("unread-dot")).toHaveCount(1)
	await expect(badge).toHaveCount(0)
	await page.getByRole("button", { name: "More actions" }).first().click()
	await expect(page.getByRole("menuitem", { name: "Mark as unread" })).toHaveCount(0)
	await page.keyboard.press("Escape")
	// right-click on the article opens its menu where the pointer is
	const box = await article.boundingBox()
	await article.click({ button: "right", position: { x: 10, y: 5 } })
	const menu = page.getByRole("menu")
	await expect(menu.getByRole("menuitem", { name: "Copy original link" })).toBeVisible()
	const menuBox = await menu.boundingBox()
	expect(Math.abs((menuBox?.x ?? 0) - ((box?.x ?? 0) + 10))).toBeLessThan(2)
	await page.keyboard.press("Escape")
	await expect(menu).toHaveCount(0)
})

test("invalid and unsupported links are rejected with a message", async ({ page }) => {
	await signup(page)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Save link" }).click()
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	await dialog.getByLabel("Link").fill("https://x.com/someone")
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	await expect(
		page
			.getByRole("dialog", { name: "Save a link" })
			.getByText("Only single posts from X can be saved, not profiles or feeds."),
	).toBeVisible()

	const res = await page.request.post("/api/documents", { data: { url: "ftp://nope" } })
	expect(res.status()).toBe(422)
})

test("saving a link keeps you on the page you saved it from", async ({ page }) => {
	await signup(page)
	for (const path of ["/home", "/library"]) {
		await page.goto(path)
		await waitForHydration(page)
		await page.getByRole("button", { name: "Save link" }).click()
		const dialog = page.getByRole("dialog", { name: "Save a link" })
		await dialog.getByLabel("Link").fill(`https://example.com/saved-from${path}`)
		await dialog.getByRole("button", { name: "Save", exact: true }).click()
		await expect(dialog).toBeHidden()
		await expect(page.getByText("Saved to your library.")).toBeVisible()
		await expect(page).toHaveURL(new RegExp(`${path}$`))
	}
	// Both are in the library, which shows the second one without being left. (Whatever their
	// extraction does: a failed article is a card too, just not a link.)
	await expect(page.locator("main").getByRole("listitem")).toHaveCount(2)
})

test("private hosts are refused by the fetcher and surface as a failure", async ({ page }) => {
	test.setTimeout(60_000)
	await signup(page)
	await waitForHydration(page)
	await page.getByRole("button", { name: "Save link" }).click()
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	await dialog.getByLabel("Link").fill("http://127.0.0.1:5433/secret")
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	await expect(page.getByText("That address is not allowed.")).toBeVisible({ timeout: 30_000 })
})

test("links inside an article: save them, or open the ones already saved", async ({ page }) => {
	test.setTimeout(120_000)
	await signup(page)
	await waitForHydration(page)
	const first = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id: firstId } = ((await first.json()) as { article: { id: string } }).article
	const paragraph =
		"This paragraph exists so the extractor keeps the article. It says nothing of interest, but it is long enough to count as content, and it repeats that idea a few more times for good measure. "
	const html = `<!DOCTYPE html><html><head><title>Linky</title></head><body><article><h1>Linky</h1>
		<p>${paragraph}</p><p>Read <a href="${FIXTURE_URL}">the makers essay</a> first.</p>
		<p>${paragraph}</p><p>Then <a href="https://example.com/from-link">another one</a> later.</p>
		<p>${paragraph}</p><p>${paragraph}</p></article></body></html>`
	const second = await page.request.post("/api/documents", {
		data: { url: "https://example.com/linky", html },
	})
	const { id } = ((await second.json()) as { article: { id: string } }).article
	await page.goto("/library")
	await expect(page.getByRole("link", { name: "Linky" })).toBeVisible({ timeout: 60_000 })
	await page.getByRole("link", { name: "Linky" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
	await waitForHydration(page)

	// the link to an article already in the library is marked and opens it here
	const savedLink = page.locator(".reader-content a", { hasText: "the makers essay" })
	await expect(savedLink).toHaveAttribute("data-saved-id", firstId)
	await savedLink.click()
	const dialog = page.getByRole("dialog", { name: "Link" })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("button", { name: "Save to Klipstack" })).toHaveCount(0)
	await expect(dialog.getByRole("link", { name: "Open original" })).toHaveAttribute(
		"target",
		"_blank",
	)
	await dialog.getByRole("link", { name: "Open in Klipstack" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${firstId}$`))
	await page.goBack()
	await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
	await waitForHydration(page)

	// an unknown link offers to save it; the toast opens the new article
	await page.locator(".reader-content a", { hasText: "another one" }).click()
	await expect(dialog).toBeVisible()
	await Promise.all([
		page.waitForResponse(
			(r) => r.url().includes("/api/documents") && r.request().method() === "POST",
		),
		dialog.getByRole("button", { name: "Save to Klipstack" }).click(),
	])
	const toast = page.getByRole("status").filter({ hasText: "Saved" })
	await expect(toast).toBeVisible()
	await expect(page.locator(".reader-content a", { hasText: "another one" })).toHaveAttribute(
		"data-saved-id",
		/.+/,
	)
	await toast.getByRole("link", { name: "Open" }).click()
	await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/)
	await expect(page).not.toHaveURL(new RegExp(`/read/${id}$`))
})

test("restoring a page saved again since keeps it in the trash and offers the saved one", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await signupUser(page, "Restorer")
	const url = `https://example.com/restore-${Date.now()}`
	const html = `<!doctype html><html><head><title>Saved twice</title></head><body><article><h1>Saved twice</h1><p>${"A page saved more than once. ".repeat(20)}</p></article></body></html>`
	const save = async () => {
		const res = await page.request.post("/api/documents", { data: { url, html } })
		expect(res.status()).toBe(202)
		return ((await res.json()) as { article: { id: string } }).article.id
	}
	const stateResponse = (id: string) =>
		page.waitForResponse(
			(r) => r.url().includes(`/documents/${id}/state`) && r.request().method() === "POST",
		)
	const conflictToast = page.getByRole("status").filter({ hasText: "already in your library" })

	// Trashed, then the same page saved again: Restore says why it cannot, and links the new one.
	const first = await save()
	expect(
		(await page.request.post(`/documents/${first}/state`, { form: { intent: "delete" } })).ok(),
	).toBe(true)
	const second = await save()
	await page.goto("/trash")
	await waitForHydration(page)
	await Promise.all([
		stateResponse(first),
		page.getByRole("button", { name: "Restore", exact: true }).click(),
	])
	await expect(conflictToast).toBeVisible()
	await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeVisible()
	await conflictToast.getByRole("link", { name: "Open it" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${second}$`))

	// Undo of a delete, after the page was saved again in between.
	await page.goto("/library")
	await waitForHydration(page)
	await Promise.all([stateResponse(second), openMenuAnd(page, "Delete")])
	const deleted = page.getByRole("status").filter({ hasText: "Deleted" })
	await expect(deleted).toBeVisible()
	const third = await save()
	await Promise.all([stateResponse(second), deleted.getByRole("button", { name: "Undo" }).click()])
	await expect(conflictToast).toBeVisible()
	await expect(conflictToast.getByRole("link", { name: "Open it" })).toHaveAttribute(
		"href",
		`/read/${third}`,
	)

	// Switching the language (without reloading) does not bring the warning back.
	await conflictToast.getByRole("button", { name: "Close" }).click()
	await expect(conflictToast).toHaveCount(0)
	await page.getByRole("button", { name: /^Account:/ }).click()
	await page.getByRole("menuitem", { name: "Settings" }).click()
	await expect(page).toHaveURL(/\/settings\/account$/)
	await page.getByLabel("Language").selectOption("es")
	await page.getByRole("button", { name: "Save", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible()
	await page.waitForTimeout(1_000)
	await expect(
		page.getByRole("status").filter({ hasText: "ya está en tu biblioteca" }),
	).toHaveCount(0)
	await page.getByLabel("Idioma").selectOption("en")
	await page.getByRole("button", { name: "Guardar", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()

	// The action answers 409 with the article already saved, never a server error.
	const refused = await page.request.post(`/documents/${first}/state`, {
		form: { intent: "restore" },
	})
	expect(refused.status()).toBe(409)
	expect(await refused.json()).toMatchObject({
		ok: false,
		error: { code: "already_saved", details: { articleId: third } },
	})
	await page.goto("/trash")
	await expect(page.getByRole("button", { name: "Restore", exact: true })).toHaveCount(2)
})

/** The fixture, saved and ready; `stored` reads its row. */
async function savedFixture(page: Page) {
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	const stored = () => db.query.documents.findFirst({ where: eq(documents.id, id) })
	await expect.poll(async () => (await stored())?.status, { timeout: 60_000 }).toBe("ready")
	return { id, stored }
}

/**
 * Reading time and where the reader left off, so that reaching the end counts after
 * `secondsToFinish`: a minute's article opened at 90% takes 2 seconds.
 */
async function readSoFar(id: string, readingMinutes: number, readingPosition = 0.9) {
	await db
		.update(documents)
		.set({ readingMinutes, readingPosition, readingProgress: readingPosition })
		.where(eq(documents.id, id))
}

async function toTheEnd(page: Page) {
	// After the article is on the page: a scroll before it lands goes nowhere.
	const end = page.getByTestId("reader-end")
	await expect(end).toBeAttached()
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
	await expect(end).toBeInViewport()
	return end
}

test("leaving at the end of an article finishes it, with an undo", async ({ page }) => {
	test.setTimeout(90_000)
	await signup(page)
	const { id, stored } = await savedFixture(page)
	await readSoFar(id, 1)
	const title = "Maker's Schedule, Manager's Schedule"
	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("link", { name: title }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
	await waitForHydration(page)
	const end = await toTheEnd(page)
	await expect(end).toHaveAttribute("data-state", "finishing")
	await expect(end).toContainText("Finished")
	await expect(end).toContainText("It goes to your archive when you leave.")
	// The heading and what leaving does share one line.
	const status = end.getByTestId("reader-end-status")
	// The heading is stamped "Read", as the card will be; screen readers hear "Finished" once.
	await expect(status).toHaveText(
		"FinishedRead It goes to your archive when you leave. Keep in Library",
	)
	const endStamp = status.getByTestId("read-stamp")
	await expect(endStamp).toBeVisible()
	await expect(endStamp).toHaveAttribute("aria-hidden", "true")
	await expect(endStamp.locator(".sr-only")).toHaveCount(0)
	expect((await status.boundingBox())!.height).toBeLessThan(40)

	// Star it and mark it for the next edition, by their names.
	await end.getByRole("button", { name: "Star", exact: true }).click()
	await expect(end.getByRole("button", { name: "Starred" })).toHaveAttribute("aria-pressed", "true")
	await end.getByRole("button", { name: "Share in next edition" }).click()
	await expect(end.getByRole("button", { name: "In next edition" })).toHaveAttribute(
		"aria-pressed",
		"true",
	)
	await expect.poll(async () => (await stored())?.shortlistedAt).not.toBeNull()
	expect((await stored())?.archivedAt).toBeNull()
	if (process.env.SHOT_DIR) await end.screenshot({ path: `${process.env.SHOT_DIR}/reader-end.png` })

	// Back to the library: finished, archived, gone from the list, with an undo.
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	const toast = page.getByRole("status").filter({ hasText: "Finished and archived" })
	await expect(toast).toBeVisible()
	const row = await stored()
	expect(row?.archivedAt).not.toBeNull()
	expect(row?.readAt).not.toBeNull()
	await expect(page.getByRole("link", { name: title })).toHaveCount(0)
	await toast.getByRole("button", { name: "Undo" }).click()
	await expect(page.getByRole("link", { name: title })).toBeVisible()
	const undone = await stored()
	expect(undone?.archivedAt).toBeNull()
	expect(undone?.readAt).toBeNull()
	expect(undone?.starredAt).not.toBeNull()
	// Not finished any more: no stamp on its card.
	await expect(
		page
			.getByRole("listitem")
			.filter({ has: page.getByRole("link", { name: title }) })
			.getByTestId("read-stamp"),
	).toHaveCount(0)

	// The browser's back button leaves too, and "Keep in Library" keeps it there.
	await readSoFar(id, 1)
	await page.getByRole("link", { name: title }).click()
	await waitForHydration(page)
	const again = await toTheEnd(page)
	await expect(again).toHaveAttribute("data-state", "finishing")
	await again.getByRole("button", { name: "Keep in Library" }).click()
	await expect(again).toHaveAttribute("data-state", "kept")
	await expect(again).toContainText("It stays in your Library.")
	await page.goBack()
	await expect(page).toHaveURL(/\/library$/)
	await page.waitForTimeout(500)
	expect((await stored())?.archivedAt).toBeNull()
	await readSoFar(id, 1)
	await page.getByRole("link", { name: title }).click()
	await waitForHydration(page)
	await expect(await toTheEnd(page)).toHaveAttribute("data-state", "finishing")
	await page.goBack()
	await expect(page).toHaveURL(/\/library$/)
	await expect(page.getByRole("status").filter({ hasText: "Finished and archived" })).toBeVisible()
	expect((await stored())?.archivedAt).not.toBeNull()

	// In the archive, its card is stamped "Read", and says "Finished" to a screen reader.
	await page.goto("/archive")
	const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) })
	const stamp = card.getByTestId("read-stamp")
	await expect(stamp).toBeVisible()
	await expect(stamp.locator("[aria-hidden=true]")).toHaveText("Read")
	await expect(stamp.locator(".sr-only")).toHaveText("Finished")
	// Where it is on every card: the top right, beside the card's buttons.
	const [box, cardBox] = [await stamp.boundingBox(), await card.boundingBox()]
	expect(box!.y - cardBox!.y).toBeLessThan(30)
	expect(cardBox!.x + cardBox!.width - (box!.x + box!.width)).toBeLessThan(70)
})

test("an end reached too fast finishes only by hand, and fits a small phone", async ({ page }) => {
	test.setTimeout(90_000)
	await signup(page)
	const { id, stored } = await savedFixture(page)
	// An hour's article, opened at the top: the end is minutes away.
	await readSoFar(id, 60, 0)
	await page.goto("/library")
	await waitForHydration(page)
	await page.getByRole("link", { name: "Maker's Schedule, Manager's Schedule" }).click()
	await waitForHydration(page)
	const end = await toTheEnd(page)
	await expect(end).toHaveAttribute("data-state", "early")
	await expect(end).toContainText("You reached the end")

	// Leaving changes nothing.
	await page.getByRole("link", { name: "Back to library" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await page.waitForTimeout(500)
	expect((await stored())?.archivedAt).toBeNull()

	// The narrowest phones, in the language with the longest words: everything fits.
	await db
		.update(user)
		.set({ locale: "es" })
		.where(eq(user.id, (await stored())!.userId))
	await page.setViewportSize({ width: 320, height: 640 })
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
	const small = await toTheEnd(page)
	await expect(small.getByRole("button", { name: "Compartir en la próxima edición" })).toBeVisible()
	const { left, right } = await small.evaluate((el) => el.getBoundingClientRect())
	expect(left).toBeGreaterThanOrEqual(0)
	expect(right).toBeLessThanOrEqual(320)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/reader-end-320-es.png` })

	// By hand: finished, archived and back to the list, with the undo.
	await small.getByRole("button", { name: "Marcar como terminado" }).click()
	await expect(page).toHaveURL(/\/library$/)
	await expect(page.getByRole("status").filter({ hasText: "Terminado y archivado" })).toBeVisible()
	await expect.poll(async () => (await stored())?.archivedAt).not.toBeNull()
})

test("finishing an article opened by its address goes back to the list it was in", async ({
	page,
}) => {
	test.setTimeout(90_000)
	await signup(page)
	const { id, stored } = await savedFixture(page)
	const finishFromAddress = async () => {
		await readSoFar(id, 60, 0)
		// A new tab or a shared link: no list passes where it was opened from.
		await page.goto(`/read/${id}`)
		await waitForHydration(page)
		const end = await toTheEnd(page)
		await end.getByRole("button", { name: "Mark as finished" }).click()
	}

	// In the library: finishing archives it, and still goes back to the library.
	await finishFromAddress()
	await expect(page).toHaveURL(/\/library$/)
	await expect.poll(async () => (await stored())?.archivedAt).not.toBeNull()

	// Archived, not yet finished: back to the archive.
	await db
		.update(documents)
		.set({ readAt: null, readingProgress: 0, readingPosition: 0 })
		.where(eq(documents.id, id))
	await finishFromAddress()
	await expect(page).toHaveURL(/\/archive$/)
	await expect(page.getByRole("status").filter({ hasText: "Marked as finished" })).toBeVisible()
	await expect.poll(async () => (await stored())?.readAt).not.toBeNull()
})

test("starring in the reader reloads the article once", async ({ page }) => {
	const email = await signupUser(page, "Star once")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const id = await insertArticle(owner!.id, "Starred once", "<p>A short article to star.</p>")
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
	const loads: string[] = []
	page.on("request", (r) => {
		if (r.method() === "GET" && new URL(r.url()).pathname === `/read/${id}.data`)
			loads.push(r.url())
	})
	const star = page.getByRole("button", { name: "Star", exact: true }).first()
	await star.click()
	await expect(page.getByRole("button", { name: "Unstar", exact: true }).first()).toBeVisible()
	await page.waitForLoadState("networkidle")
	expect(loads).toHaveLength(1)
})

test("a malformed id or cursor is not found, not a server error", async ({ page }) => {
	await signupUser(page, "Bad ids")
	expect((await page.goto("/read/not-an-id"))?.status()).toBe(404)
	expect(
		(
			await page.goto(
				`/library?cursor=${Buffer.from('{"t":"x","id":"y","k":null}').toString("base64url")}`,
			)
		)?.status(),
	).toBe(200)
	expect((await page.goto("/notebook?view=stream&cursor=junk"))?.status()).toBe(200)
	const post = (path: string, form: Record<string, string>) =>
		page.request.post(path, { form, headers: { origin: new URL(page.url()).origin } })
	// A malformed id is a bad request, as in the API.
	expect((await post("/documents/not-an-id/state", { intent: "star" })).status()).toBe(400)
	expect((await post("/feed", { intent: "dismiss", itemId: "not-an-id" })).status()).toBe(400)
	expect((await page.request.get("/assets/not-an-id")).status()).toBe(404)
})

test.describe(() => {
	// The service worker would take the requests the test holds back.
	test.use({ serviceWorkers: "block" })
	test("undo waits for the change it undoes to reach the server", async ({ page }) => {
		const email = await signupUser(page, "Undo order")
		const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
		const id = await insertArticle(owner!.id, "Undo order", "<p>Alpha bravo charlie.</p>")
		await page.goto("/library")
		await waitForHydration(page)
		// The delete is held on its way: the undo must not overtake it.
		let release = () => {}
		const held = new Promise<void>((resolve) => (release = resolve))
		await page.route(`**/documents/${id}/state*`, async (route) => {
			if ((route.request().postData() ?? "").includes("intent=delete")) await held
			await route.continue()
		})
		await openMenuAnd(page, "Delete")
		const toast = page.getByRole("status").filter({ hasText: "Deleted" })
		await toast.getByRole("button", { name: "Undo" }).click()
		const restored = page.waitForResponse(
			(r) =>
				r.url().includes("/state") && (r.request().postData() ?? "").includes("intent=restore"),
		)
		release()
		await restored
		const stored = await db.query.documents.findFirst({ where: eq(documents.id, id) })
		expect(stored?.deletedAt).toBeNull()
		await expect(page.getByRole("link", { name: "Undo order" })).toBeVisible()
	})
})

/**
 * The lists that keep archived articles: where articles are put there, newest last, and the list's
 * address.
 */
const KEEPING_LISTS = [
	{
		list: "starred",
		put: async (_userId: string, ids: string[]) => {
			for (const id of ids)
				await db.update(documents).set({ starredAt: new Date() }).where(eq(documents.id, id))
			return "/starred"
		},
	},
	{
		list: "a topic",
		put: async (userId: string, ids: string[]) => {
			const [topic] = await db
				.insert(topics)
				.values({ userId, name: "Keepers", description: "Kept", status: "active", origin: "first" })
				.returning({ id: topics.id })
			await db.insert(documentTopics).values(
				ids.map((id) => ({
					documentId: id,
					topicId: topic!.id,
					probability: 1,
					level: "applied" as const,
				})),
			)
			return `/topics/${topic!.id}`
		},
	},
	// Without an `in:`, search looks in the library and the archive.
	{ list: "search", put: async () => "/search?q=kept%20sort:newest" },
]

test.describe(() => {
	// The service worker would take the requests the test holds back.
	test.use({ serviceWorkers: "block" })
	for (const { list, put } of KEEPING_LISTS)
		test(`archiving in ${list} keeps the card, which shows its new state at once`, async ({
			page,
		}) => {
			const email = await signupUser(page, "Keeping list", { features: ["topics"] })
			const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
			// Archived: an undo about another card must not bring it back.
			const other = await insertArticle(owner!.id, "Kept bystander", "<p>Delta echo.</p>")
			await db.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, other))
			const id = await insertArticle(owner!.id, "Kept card", "<p>Alpha bravo charlie.</p>")
			await page.goto(await put(owner!.id, [other, id]))
			await waitForHydration(page)
			const card = page.locator("li").filter({ has: page.getByRole("link", { name: "Kept card" }) })
			await expect(card).toBeVisible()
			// Each change is held on its way, so the card shows what it does before the page reloads.
			const held: (() => void)[] = []
			await page.route(`**/documents/${id}/state*`, async (route) => {
				await new Promise<void>((resolve) => held.push(resolve))
				await route.continue()
			})
			const release = async () => {
				await expect.poll(() => held.length).toBe(1)
				held.shift()!()
			}

			// e archives the article under the cursor: the card stays, under the cursor, ready to move back.
			await page.keyboard.press("j")
			await expect(card).toHaveAttribute("data-cursor")
			const archived = stateSaved(page, "archive")
			await page.keyboard.press("e")
			const toast = page.getByRole("status").filter({ hasText: "Archived" })
			await expect(toast).toBeVisible()
			await expect(card.getByRole("button", { name: "Move to library" })).toBeVisible()
			await expect(card).toHaveAttribute("data-cursor")
			await release()
			await archived
			await expect.poll(async () => await archivedAt(id)).not.toBeNull()
			await expect(card.getByRole("button", { name: "Move to library" })).toBeVisible()

			// The toast's undo puts it back; the card stays through that too.
			const undone = stateSaved(page, "undo-archive")
			await toast.getByRole("button", { name: "Undo" }).click()
			await expect.poll(() => held.length).toBe(1)
			await expect(card.getByRole("button", { name: "Archive", exact: true })).toBeVisible()
			await expect(card).toHaveAttribute("data-cursor")
			// Only the card the undo is about.
			const bystander = page
				.locator("li")
				.filter({ has: page.getByRole("link", { name: "Kept bystander" }) })
			await expect(bystander.getByRole("button", { name: "Move to library" })).toBeVisible()
			await release()
			await undone
			await expect.poll(async () => await archivedAt(id)).toBeNull()
			await expect(card.getByRole("button", { name: "Archive", exact: true })).toBeVisible()

			// The card's own button: the same, while the change is on its way.
			const again = stateSaved(page, "archive")
			await card.getByRole("button", { name: "Archive", exact: true }).click()
			await expect(card.getByRole("button", { name: "Move to library" })).toBeVisible()
			await release()
			await again
			await expect(card.getByRole("button", { name: "Move to library" })).toBeVisible()
			await expect(card).toHaveAttribute("data-cursor")

			// And back to the library from here: still in place.
			const back = stateSaved(page, "unarchive")
			await card.getByRole("button", { name: "Move to library" }).click()
			await expect(card.getByRole("button", { name: "Archive", exact: true })).toBeVisible()
			await release()
			await back
			await expect.poll(async () => await archivedAt(id)).toBeNull()
			await expect(card.getByRole("button", { name: "Archive", exact: true })).toBeVisible()
		})

	for (const [list, path] of [
		["the library", "/library"],
		["a search of the library", "/search?q=card%20in:library%20sort:newest"],
	] as const)
		test(`archiving in ${list} takes the card out at once, and the cursor moves on`, async ({
			page,
		}) => {
			const email = await signupUser(page, "Leaving list")
			const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
			await insertArticle(owner!.id, "Older card", "<p>Delta echo.</p>")
			const id = await insertArticle(owner!.id, "Leaving card", "<p>Alpha bravo charlie.</p>")
			await page.goto(path)
			await waitForHydration(page)
			const link = page.getByRole("link", { name: "Leaving card" })
			await expect(link).toBeVisible()
			// Held on its way: the card is gone before the page reloads its data.
			let release = () => {}
			await page.route(`**/documents/${id}/state*`, async (route) => {
				await new Promise<void>((resolve) => (release = resolve))
				await route.continue()
			})
			await page.keyboard.press("j")
			await expect(page.locator("li[data-cursor]")).toContainText("Leaving card")
			const archived = stateSaved(page, "archive")
			await page.keyboard.press("e")
			await expect(link).toHaveCount(0)
			await expect(page.locator("li[data-cursor]")).toContainText("Older card")
			release()
			await archived
			await expect(link).toHaveCount(0)
		})
})

async function archivedAt(id: string) {
	const row = await db.query.documents.findFirst({ where: eq(documents.id, id) })
	return row?.archivedAt ?? null
}
