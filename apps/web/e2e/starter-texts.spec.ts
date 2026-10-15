import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

test("a new reader adds the guide from Home, and finds it and the essays on the Add page", async ({
	page,
}) => {
	test.setTimeout(60_000)
	await signupUser(page, "Starter Reader")
	await page.goto("/home")
	await waitForHydration(page)

	// Nothing saved: the guide first, then essays in the reader's language only.
	const shelf = page.getByRole("region", { name: "Or start with one of these" })
	await expect(shelf.getByText("How to use Klipstack")).toBeVisible()
	await expect(shelf.getByText("Of Studies")).toBeVisible()
	await expect(shelf.getByText("In Spanish")).toHaveCount(0)
	await shelf.getByRole("button", { name: "Add How to use Klipstack to your library" }).click()
	await expect(page).toHaveURL(/\/read\/[\w-]+$/)
	const guideUrl = page.url()
	// Extracted from the page that ships with the app: nothing fetched.
	await expect(page.getByRole("heading", { name: "Highlight", exact: true })).toBeVisible({
		timeout: 20_000,
	})

	// Something saved: Home has its sections, not the shelf.
	await page.goto("/home")
	await expect(page.getByRole("region", { name: "Or start with one of these" })).toHaveCount(0)

	// The Add page lists every text, the reader's language first, and knows which they have.
	await page.goto("/add")
	const list = page.getByRole("region", { name: "Something to read" })
	await expect(list.getByText("In Spanish")).toBeVisible()
	await expect(list.getByRole("link", { name: "Open How to use Klipstack" })).toHaveAttribute(
		"href",
		new URL(guideUrl).pathname,
	)
	await list.getByRole("button", { name: "Add Of Studies to your library" }).click()
	await expect(page).toHaveURL(/\/read\/[\w-]+$/)
	await expect(page.getByText("Some books are to be tasted")).toBeVisible({ timeout: 20_000 })
	await page.goto("/add")
	await expect(list.getByRole("link", { name: "Open Of Studies" })).toBeVisible()
})

test("the guide is a public page in each language", async ({ page }) => {
	await page.goto("/guide")
	await expect(page).toHaveURL(/\/guide\/en$/)
	await expect(page.getByRole("heading", { name: "How to use Klipstack" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Add to library" })).toHaveCount(0)
	await page.goto("/guide/es")
	await expect(page.getByRole("heading", { name: "Cómo usar Klipstack" })).toBeVisible()
})
