import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

test("the dialog saves several links at once, and keeps the ones it could not save", async ({
	page,
}) => {
	await signupUser(page, "Several Links")
	await page.goto("/library")
	await waitForHydration(page)
	const stamp = Date.now()
	const one = `https://example.com/several-${stamp}/one`
	const two = `https://example.com/several-${stamp}/two`

	await page.getByRole("button", { name: "Save link" }).click()
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	await dialog.getByLabel("Link", { exact: true }).fill(`${one}\nnot a link`)
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	// One refused: the dialog stays, says what happened to each, and keeps only the refused one.
	const results = dialog.getByRole("list", { name: "Links saved" })
	await expect(results.getByText(one)).toBeVisible()
	await expect(results.getByText("That does not look like a valid link.")).toBeVisible()
	await expect(dialog.getByLabel("Link", { exact: true })).toHaveValue("not a link")

	// All saved: the dialog closes and says how many.
	await dialog.getByLabel("Link", { exact: true }).fill(`${two}\n${one}`)
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	await expect(page.getByRole("status").getByText("2 links saved.")).toBeVisible()
	await expect(dialog).toBeHidden()

	// More than ten: refused before anything is saved, with what was typed still there.
	await page.getByRole("button", { name: "Save link" }).click()
	const many = Array.from({ length: 11 }, (_, i) => `https://example.com/many-${stamp}/${i}`)
	await dialog.getByLabel("Link", { exact: true }).fill(many.join("\n"))
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	await expect(dialog.getByText("Save up to 10 links at once.")).toBeVisible()
	await expect(dialog.getByLabel("Link", { exact: true })).toHaveValue(many.join("\n"))

	// The dialog leads to the page with every other way in.
	await dialog.getByRole("link", { name: "More ways to add" }).click()
	await expect(page).toHaveURL(/\/add\?tab=more$/)
	await expect(page.getByRole("link", { name: "More ways to add", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	)
	await expect(page.getByRole("heading", { name: "Save from anywhere" })).toBeVisible()
	await expect(page.getByRole("link", { name: "Save to Klipstack" })).toHaveAttribute(
		"href",
		/^javascript:/,
	)
	await expect(page.getByRole("heading", { name: "Your AI assistant" })).toBeVisible()
	await expect(page.getByText(/\/mcp$/)).toBeVisible()
})

test("the Add page saves several links and lists each one's outcome", async ({ page }) => {
	await signupUser(page, "Add Page Links")
	await page.goto("/add")
	await waitForHydration(page)
	const stamp = Date.now()
	const one = `https://example.com/add-page-${stamp}/one`
	const field = page.getByLabel("Link", { exact: true })
	const height = () => field.evaluate((el) => el.getBoundingClientRect().height)
	// Two lines to start; it grows with what is typed, up to eight lines.
	const empty = await height()
	await field.fill(Array.from({ length: 4 }, (_, i) => `https://example.com/${i}`).join("\n"))
	expect(await height()).toBeGreaterThan(empty)
	await field.fill(Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`).join("\n"))
	const capped = await height()
	await field.fill(Array.from({ length: 30 }, (_, i) => `https://example.com/${i}`).join("\n"))
	expect(await height()).toBe(capped)

	// Enter starts a new line; ⌘↵ / Ctrl+Enter saves.
	await field.fill(one)
	await field.press("Enter")
	await field.pressSequentially("https://www.youtube.com/watch?v=x")
	await expect(field).toHaveValue(`${one}\nhttps://www.youtube.com/watch?v=x`)
	await field.press("Control+Enter")
	const results = page.getByRole("list", { name: "Links saved" })
	await expect(results.getByText(one)).toBeVisible()
	await expect(results.getByText("YouTube videos are not supported yet.")).toBeVisible()
	await expect(page.getByLabel("Link", { exact: true })).toHaveValue(
		"https://www.youtube.com/watch?v=x",
	)
})

test("the Add page's tabs each have their own address", async ({ page }) => {
	await signupUser(page, "Add Tabs")
	await page.goto("/add")
	const tabs = page.getByRole("navigation", { name: "Ways to add" })
	await expect(tabs.getByRole("link", { name: "Paste links" })).toHaveAttribute(
		"aria-current",
		"page",
	)
	await expect(page.getByLabel("Link", { exact: true })).toBeVisible()
	await expect(page.getByRole("heading", { name: "Something to read" })).toHaveCount(0)

	await tabs.getByRole("link", { name: "Something to read" }).click()
	await expect(page).toHaveURL(/\/add\?tab=read$/)
	await expect(page.getByRole("heading", { name: "Something to read" })).toBeVisible()
	await expect(page.getByLabel("Link", { exact: true })).toHaveCount(0)

	// A shared link lands on the field, whatever the tab.
	await page.goto("/add?tab=more&url=https://example.com/shared")
	await expect(page.getByLabel("Link", { exact: true })).toHaveValue("https://example.com/shared")
})
