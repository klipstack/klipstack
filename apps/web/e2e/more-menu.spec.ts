import { db, documents, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

const COUNT = 20
const title = (i: number) => `Long list article ${String(i).padStart(2, "0")}`

/** A library of COUNT articles, newest first: article 00 at the top, 19 well below the window. */
async function longLibrary(page: Page) {
	const email = await signupUser(page, "Long List")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing more-menu test user")
	await db.insert(documents).values(
		Array.from({ length: COUNT }, (_, i) => ({
			userId: owner.id,
			sourceUrl: `https://example.com/long-list/${i}`,
			urlHash: `${owner.id}-${i}`,
			title: title(i),
			status: "ready" as const,
			createdAt: new Date(Date.now() - i * 60_000),
		})),
	)
	await page.goto("/library")
	await waitForHydration(page)
}

test("the ⋯ menu of the last card stays open beside its button, and a later scroll closes it", async ({
	page,
}) => {
	await longLibrary(page)

	const last = title(COUNT - 1)
	const card = page.getByRole("listitem").filter({ hasText: last })
	const button = card.getByRole("button", { name: "More actions" })
	const menu = page.getByRole("menu", { name: "More actions" })
	// The click scrolls the card at the bottom of the list into view.
	await button.click()
	await expect(menu).toBeVisible()
	// The page settles; the menu is still open, right under (or above) its button.
	await page.waitForTimeout(500)
	await expect(menu).toBeVisible()
	await expectBeside()

	// The reader scrolling the page on purpose: a little, and the menu follows its button…
	const b = (await button.boundingBox())!
	await page.mouse.move(b.x - 200, b.y - 200)
	await page.mouse.wheel(0, -50)
	await expect.poll(async () => (await button.boundingBox())!.y).toBeGreaterThan(b.y + 30)
	await expect(menu).toBeVisible()
	await expectBeside()
	// …far enough to take the button off the screen, and it closes.
	await page.mouse.wheel(0, -1000)
	await expect(menu).toBeHidden()

	/** The menu's right edge lines up with its button's, right under or above it. */
	async function expectBeside() {
		await expect(async () => {
			const b = (await button.boundingBox())!
			const m = (await menu.boundingBox())!
			expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThan(2)
			const gap = Math.min(Math.abs(m.y - (b.y + b.height)), Math.abs(m.y + m.height - b.y))
			expect(gap).toBeLessThan(10)
		}).toPass({ timeout: 2_000 })
	}
})

test("a right-click on the last card opens its menu, which stays open", async ({ page }) => {
	await longLibrary(page)
	const link = page.getByRole("link", { name: title(COUNT - 1) })
	// The right-click scrolls the card into view first; that scroll is reported after the menu opened.
	await link.click({ button: "right" })
	const menu = page.getByRole("menu", { name: "More actions" })
	await expect(menu).toBeVisible()
	await page.waitForTimeout(500)
	await expect(menu).toBeVisible()
})
