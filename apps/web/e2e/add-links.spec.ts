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
	await expect(page).toHaveURL(/\/add$/)
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
	await page.getByLabel("Link", { exact: true }).fill(`${one}\nhttps://www.youtube.com/watch?v=x`)
	await page.getByRole("button", { name: "Save", exact: true }).click()
	const results = page.getByRole("list", { name: "Links saved" })
	await expect(results.getByText(one)).toBeVisible()
	await expect(results.getByText("YouTube videos are not supported yet.")).toBeVisible()
	await expect(page.getByLabel("Link", { exact: true })).toHaveValue(
		"https://www.youtube.com/watch?v=x",
	)
})
