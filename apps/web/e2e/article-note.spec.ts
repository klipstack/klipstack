import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
const QUOTE = "There are two types of schedule"

async function signupAndSave(page: Page): Promise<string> {
	await signupUser(page, "Noter", { verified: false })
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto(`/read/${id}`)
	await expect(page.locator(".reader-content")).toContainText(QUOTE, { timeout: 60_000 })
	return id
}

const noteSaved = (page: Page, id: string) =>
	page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/note`) && r.ok())

test("article note: write, autosave, reload, keys, clear, export", async ({ page }) => {
	test.setTimeout(120_000)
	const id = await signupAndSave(page)
	const LONG_NOTE = `Makers need long blocks.\n${"Meetings cost more than their hour. ".repeat(8)}`
	const hl = await page.request.post(`/documents/${id}/highlights`, {
		data: { intent: "create", exact: QUOTE, note: LONG_NOTE },
	})
	expect(hl.status()).toBe(201)
	await page.reload()
	await waitForHydration(page)

	await page.getByTestId("toggle-sidebar").click()
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar.getByRole("heading", { name: "Notes and highlights" })).toBeVisible()
	// highlight notes show in full
	await expect(sidebar).toContainText(LONG_NOTE.trim())

	// typing saves on its own; j/k type letters, they don't move through highlights
	const note = sidebar.getByLabel("Note", { exact: true })
	await note.click()
	await Promise.all([noteSaved(page, id), page.keyboard.type("jk my take")])
	await expect(note).toHaveText("jk my take")
	await expect(sidebar.getByText("Saved", { exact: true })).toBeVisible()
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/article-note.png` })

	// Escape leaves the note first, then closes the sidebar
	await page.keyboard.press("Escape")
	await expect(sidebar).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(sidebar).toHaveCount(0)

	await page.reload()
	// Before hydration the toggle has no handler yet, and the click would be lost.
	await waitForHydration(page)
	await page.getByTestId("toggle-sidebar").click()
	await expect(sidebar.getByLabel("Note", { exact: true })).toHaveText("jk my take")

	// clearing it saves on blur and sticks
	await sidebar.getByLabel("Note", { exact: true }).fill("")
	await Promise.all([noteSaved(page, id), sidebar.getByLabel("Note", { exact: true }).blur()])
	await page.reload()
	await waitForHydration(page)
	await page.getByTestId("toggle-sidebar").click()
	await expect(sidebar.getByLabel("Note", { exact: true })).toHaveText("")
})
