import { expect, test } from "@playwright/test"
import { waitForHydration } from "./helpers"

const SENTENCE = "Klipstack does the same for what you read on a screen."

test("the landing page's demo highlights with the reader's toolbar", async ({ page }) => {
	await page.goto("/")
	await waitForHydration(page)
	const demo = page.getByRole("figure", { name: "A sample article you can highlight" })
	const sentence = demo.getByRole("button", { name: SENTENCE })
	const toolbar = page.getByRole("dialog", { name: "Edit highlight" })

	// Mark a sentence: it stands out, with the toolbar above it.
	await sentence.click()
	await expect(sentence).toHaveAttribute("aria-pressed", "true")
	await expect(sentence).toHaveClass(/hl-pop/)
	await expect(toolbar).toBeVisible()
	// The demo has no notes to write and nothing to copy.
	await expect(toolbar.getByRole("button", { name: "Add note" })).toHaveCount(0)

	// Clicking elsewhere closes it; delete removes the highlight.
	await demo.getByText(/This works like an article/).click()
	await expect(toolbar).toBeHidden()
	await expect(sentence).not.toHaveClass(/hl-pop/)
	await sentence.click()
	await toolbar.getByRole("button", { name: "Delete highlight" }).click()
	await expect(toolbar).toBeHidden()
	await expect(sentence).toHaveAttribute("aria-pressed", "false")

	// From the keyboard: the toolbar takes the focus, and Escape gives it back.
	await sentence.focus()
	await page.keyboard.press("Enter")
	await expect(toolbar.getByRole("button", { name: "Delete highlight" })).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(toolbar).toBeHidden()
	await expect(sentence).toBeFocused()
	await expect(sentence).toHaveAttribute("aria-pressed", "true")
})
