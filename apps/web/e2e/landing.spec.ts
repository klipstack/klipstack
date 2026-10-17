import { expect, test } from "@playwright/test"
import { waitForHydration } from "./helpers"

const SENTENCE = "None of it takes long: a minute at the end, before the next thing."

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
	await demo.getByText(/Tap a sentence to highlight it/).click()
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

test("the landing walkthrough: highlights stay private, an edition only when the reader marks one", async ({
	page,
}) => {
	await page.goto("/")
	await waitForHydration(page)
	// Home's time choice re-sorts the sample: with 5 minutes, only what fits, and the article
	// started stays as where the reader left off.
	const home = page.getByRole("figure", { name: "A sample of Klipstack's home" })
	await expect(home).toContainText("Why cities need more benches")
	await home.getByRole("button", { name: "5 min", exact: true }).click()
	await expect(home).not.toContainText("Why cities need more benches")
	await expect(home).toContainText("Doesn't fit in 5 minutes, but it's where you left off.")
	await expect(home).toContainText("What we keep from what we read")

	const reader = page.getByRole("figure", { name: "A sample article you can highlight" })
	const end = page.getByRole("figure", { name: "The end of the sample article" })
	const notebook = page.getByTestId("landing-notebook")
	const edition = page.getByTestId("landing-edition")

	// Highlighting adds to the private notebook, not to an edition.
	await reader.getByRole("button", { name: SENTENCE }).click()
	await page.keyboard.press("Escape")
	await expect(notebook).toContainText(SENTENCE)
	await expect(notebook).toContainText("3 highlights")
	await expect(edition).toContainText("Not in an edition")

	// The private note lands in the notebook, and still no edition.
	const note = "Try one line in the margin per article."
	await end.getByLabel("Your note").fill(note)
	await expect(notebook).toContainText(note)
	await expect(edition).toContainText("Not in an edition")

	// Marked for the next edition: a draft, with the note for readers apart from the private one,
	// and no highlight quoted until chosen.
	await end.getByRole("button", { name: "Add to next edition" }).click()
	await expect(edition).toContainText("Draft · not published")
	await expect(edition.locator("blockquote")).toHaveCount(0)
	await expect(edition).not.toContainText(note)
	await end.getByRole("button", { name: "Start from my note" }).click()
	await expect(end.getByLabel("For your edition's readers")).toHaveValue(note)
	await expect(edition).toContainText(note)

	// Up to three highlights: a fourth can't be chosen.
	await reader.getByRole("button", { name: "Most of what we read is gone within a week." }).click()
	await page.keyboard.press("Escape")
	const choices = edition.getByRole("checkbox")
	await expect(choices).toHaveCount(4)
	for (const i of [0, 1, 2]) await choices.nth(i).check()
	await expect(edition.locator("blockquote")).toHaveCount(3)
	await expect(choices.nth(3)).toBeDisabled()

	// A quoted highlight removed and marked again comes back unquoted, as a new highlight does.
	const quoted = reader.getByRole("button", { name: SENTENCE })
	await quoted.click()
	await page
		.getByRole("dialog", { name: "Edit highlight" })
		.getByRole("button", { name: "Delete highlight" })
		.click()
	await quoted.click()
	await page.keyboard.press("Escape")
	await expect(edition.getByRole("checkbox", { name: SENTENCE })).not.toBeChecked()
})
