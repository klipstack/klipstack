import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

test("a new reader adds the guide from Home, and finds it and the texts in the sidebar", async ({
	page,
}) => {
	test.setTimeout(60_000)
	await signupUser(page, "Starter Reader")
	// The empty library offers them too, and leads to all of them.
	await page.goto("/library")
	const empty = page.getByRole("region", { name: "Or start with one of these" })
	await expect(empty.getByTestId("starter-guide")).toContainText("How to use Klipstack")
	await expect(page.getByRole("link", { name: "More to read" })).toHaveAttribute("href", "/texts")

	await page.goto("/home")
	await waitForHydration(page)

	// Nothing saved: the guide on a card of its own, and books from different topics.
	const shelf = page.getByRole("region", { name: "Or start with one of these" })
	const books = shelf.getByRole("list", { name: "Books to start with" })
	await expect(books.getByText("Of Studies")).toBeVisible()
	await expect(books.getByText("How to use Klipstack")).toHaveCount(0)
	await expect(books.getByRole("listitem")).toHaveCount(4)
	await shelf.getByRole("button", { name: "Add How to use Klipstack to your library" }).click()
	await expect(page).toHaveURL(/\/read\/[\w-]+$/)
	const guideUrl = page.url()
	// Extracted from the page that ships with the app: nothing fetched.
	await expect(page.getByRole("heading", { name: "Highlight", exact: true })).toBeVisible({
		timeout: 20_000,
	})

	// Something saved and unread: Home has its sections and the library its list, not the shelf.
	await page.goto("/home")
	await expect(page.getByRole("region", { name: "Or start with one of these" })).toHaveCount(0)
	await page.goto("/library")
	await expect(page.getByRole("region", { name: "Or start with one of these" })).toHaveCount(0)

	// The sidebar leads to every text, a shelf per topic, in the reader's language.
	await page.getByRole("link", { name: "Discover" }).first().click()
	await expect(page).toHaveURL(/\/texts$/)
	await expect(page.getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "page")
	const reading = page.getByRole("region", { name: "Reading & writing" })
	await expect(page.getByRole("region", { name: "Stories" })).toBeVisible()
	await expect(page.getByTestId("starter-guide").getByRole("link")).toHaveAttribute(
		"href",
		new URL(guideUrl).pathname,
	)
	await reading.getByRole("button", { name: "Add Of Studies to your library" }).click()
	await expect(page).toHaveURL(/\/read\/[\w-]+$/)
	await expect(page.getByText("Some books are to be tasted")).toBeVisible({ timeout: 20_000 })
	// Loaded as a page of its own, it runs in the browser too.
	await page.goto("/texts")
	await waitForHydration(page)
	await expect(reading.getByRole("link", { name: "Open Of Studies" })).toBeVisible()

	// The Spanish texts, a switch away, on the same shelves.
	await page.getByRole("link", { name: "Español" }).click()
	await expect(page).toHaveURL(/\/texts\?lang=es$/)
	await expect(reading.getByText("Cartas literarias a una mujer: Carta I")).toBeVisible()
	await expect(reading.getByText("Of Studies")).toHaveCount(0)
})

test("the guide is a public page in each language", async ({ page }) => {
	await page.goto("/guide")
	await expect(page).toHaveURL(/\/guide\/en$/)
	await expect(page.getByRole("heading", { name: "How to use Klipstack" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Add to library" })).toHaveCount(0)
	await page.goto("/guide/es")
	await expect(page.getByRole("heading", { name: "Cómo usar Klipstack" })).toBeVisible()
})
