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
	await expect(dialog.getByLabel("Link", { exact: true })).toBeFocused()
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

	// Below the field, folded: the bookmarklet and an AI assistant's prompt.
	await expect(dialog.getByRole("button", { name: "Copy prompt" })).toBeHidden()
	await dialog.getByText("Other ways to save").click()
	await expect(dialog.getByRole("link", { name: "Save to Klipstack" })).toHaveAttribute(
		"href",
		/^javascript:.*\/add\?url=/,
	)
	await expect(dialog.getByRole("button", { name: "Copy prompt" })).toBeVisible()
	await expect(dialog.getByRole("link", { name: "Connected apps" })).toHaveAttribute(
		"href",
		"/settings/connected-apps",
	)

	// Opened again: what was typed is there, the old refusal is not.
	await page.keyboard.press("Escape")
	await page.getByRole("button", { name: "Save link" }).click()
	await expect(dialog.getByLabel("Link", { exact: true })).toHaveValue(many.join("\n"))
	await expect(dialog.getByText("Save up to 10 links at once.")).toBeHidden()
})

test("the Save link field grows, Enter starts a line and Ctrl+Enter saves", async ({ page }) => {
	await signupUser(page, "Field Links")
	// `/add`, where the bookmarklet and the phone's share sheet go: the library, with the dialog open.
	await page.goto("/add")
	await expect(page).toHaveURL(/\/library$/)
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	const stamp = Date.now()
	const one = `https://example.com/field-${stamp}/one`
	const field = dialog.getByLabel("Link", { exact: true })
	await expect(field).toBeFocused()
	// The shortcut of this platform (the tests run on Linux).
	await expect(dialog.getByText("One link per line, up to 10. Ctrl+Enter saves.")).toBeVisible()
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
	const results = dialog.getByRole("list", { name: "Links saved" })
	await expect(results.getByText(one)).toBeVisible()
	await expect(results.getByText("YouTube videos are not supported yet.")).toBeVisible()
	await expect(field).toHaveValue("https://www.youtube.com/watch?v=x")
})

test("links typed and not saved stay in the field until they are", async ({ page }) => {
	await signupUser(page, "Draft Links")
	await page.goto("/library")
	await waitForHydration(page)
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	const field = dialog.getByLabel("Link", { exact: true })
	const typed = `https://example.com/draft-${Date.now()}`
	await page.getByRole("button", { name: "Save link" }).click()
	await field.fill(typed)
	await page.keyboard.press("Escape")
	await expect(dialog).toBeHidden()

	// Another page, and a reload: still there.
	await page.goto("/notebook")
	await page.reload()
	await waitForHydration(page)
	await page.keyboard.press("Control+k")
	await page.getByRole("option", { name: "Save a link" }).click()
	await expect(field).toHaveValue(typed)

	// A shared link joins it on a line of its own.
	await page.goto("/add?url=https://example.com/shared")
	await expect(field).toHaveValue(`${typed}\nhttps://example.com/shared`)

	// Saved: the field starts empty again.
	await field.press("Control+Enter")
	await expect(page.getByRole("status").getByText("2 links saved.")).toBeVisible()
	await page.getByRole("button", { name: "Save link" }).click()
	await expect(field).toHaveValue("")
})

test("the command menu opens the Save link dialog where the reader is", async ({ page }) => {
	await signupUser(page, "Palette Links")
	await page.goto("/notebook")
	await waitForHydration(page)
	await page.keyboard.press("Control+k")
	await page.getByRole("option", { name: "Save a link" }).click()
	const dialog = page.getByRole("dialog", { name: "Save a link" })
	await expect(dialog.getByLabel("Link", { exact: true })).toBeFocused()
	await expect(page).toHaveURL(/\/notebook$/)
})
