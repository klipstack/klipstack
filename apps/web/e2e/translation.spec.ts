import { db, documents, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FRENCH =
	'<p>Le croissant est une viennoiserie à base de pâte levée feuilletée, née à Vienne sous le nom de <a href="https://example.com/kipferl">kipferl</a>.</p><p>Il est devenu un symbole de la boulangerie française au vingtième siècle.</p>'

/** An account with AI, reading an article in French (as language detection sets it). */
async function frenchArticle(page: Page) {
	const email = await signupUser(page, "Reader", { features: ["ai"] })
	const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const id = await insertArticle(account!.id, "Le croissant", FRENCH)
	await db.update(documents).set({ language: "fr" }).where(eq(documents.id, id))
	await page.goto(`/read/${id}`)
	await waitForHydration(page)
	return id
}

const content = (page: Page) => page.locator(".reader-content")
const bar = (page: Page) => page.getByTestId("translation-bar")

test("translates an article, shows its original to read, and puts the original back", async ({
	page,
}) => {
	// The worker translates it, with the fake model.
	test.setTimeout(90_000)
	await frenchArticle(page)
	const offer = page.getByTestId("translation-offer")
	await expect(offer).toContainText("This article is in French.")
	await expect(offer).toContainText("Uses 1 translation credit. 30 credits left this month.")

	await offer.getByRole("button", { name: "Translate to English" }).click()
	await expect(bar(page)).toContainText("Translated from French.", { timeout: 60_000 })
	await expect(content(page)).toContainText("translated text")
	await expect(content(page).locator('a[href="https://example.com/kipferl"]')).toHaveCount(1)

	// Always, from now on: the button goes, and Settings lists it.
	await bar(page).getByRole("button", { name: "Always translate French" }).click()
	await expect(page.getByText("Articles in French you save will be translated")).toBeVisible()
	await expect(bar(page).getByRole("button", { name: "Always translate French" })).toHaveCount(0)

	// The original, to read: copying works, highlighting doesn't.
	await bar(page).getByRole("link", { name: "Show original text" }).click()
	await expect(page).toHaveURL(/\?original=1$/)
	await expect(content(page)).toContainText("Le croissant est une viennoiserie")
	await expect(bar(page)).toContainText("You're reading the original text, in French.")
	await waitForHydration(page)
	await content(page).getByText("symbole de la boulangerie").selectText()
	const toolbar = page.getByRole("dialog", { name: "Selected text" })
	await expect(toolbar.getByRole("button", { name: "Copy text" })).toBeVisible()
	await expect(toolbar.getByRole("button", { name: "Highlight" })).toHaveCount(0)
	await bar(page).getByRole("link", { name: "Show translation" }).click()
	await expect(content(page)).toContainText("translated text")

	// The original language back, from the menu; the translation, kept, costs nothing again.
	await waitForHydration(page)
	await page.getByRole("button", { name: "More actions" }).click()
	await page.getByRole("menuitem", { name: "Use original language" }).click()
	await expect(content(page)).toContainText("Le croissant est une viennoiserie")
	await expect(offer).toContainText("It was translated before: no credits needed.")

	await page.goto("/settings/features")
	await waitForHydration(page)
	const always = page.getByTestId("always-translate")
	await expect(always).toContainText("French")
	await always.getByRole("button", { name: "Remove French" }).click()
	await expect(page.getByText("To add a language, choose Always translate")).toBeVisible()
})

test("never offers a language the reader reads, until Settings takes it out", async ({ page }) => {
	const id = await frenchArticle(page)
	const offer = page.getByTestId("translation-offer")
	await offer.getByRole("button", { name: "Never translate French" }).click()
	await expect(page.getByText("Articles in French won't be offered a translation.")).toBeVisible()
	await expect(offer).toHaveCount(0)
	await page.reload()
	await waitForHydration(page)
	await expect(content(page)).toContainText("Le croissant")
	await expect(offer).toHaveCount(0)

	await page.goto("/settings/features")
	await waitForHydration(page)
	const list = page.getByTestId("never-translate")
	await expect(list).toContainText("French")
	await list.getByRole("button", { name: "Remove French" }).click()
	await expect(page.getByText("To add a language, choose Never translate")).toBeVisible()

	await page.goto(`/read/${id}`)
	await expect(offer).toContainText("This article is in French.")
})
