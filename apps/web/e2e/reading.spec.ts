import { db, documents, eq, readingCompletions, user } from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

test("Your reading totals what was finished, by day and by week, from Home's line", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Stats Reader")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const html = "<p>A few paragraphs worth reading to the end.</p>"
	const deep = await insertArticle(owner!.id, "Deep work", html)
	const slow = await insertArticle(owner!.id, "Slow reading", html)
	await db
		.update(documents)
		.set({ wordCount: 50_000, readingMinutes: 200 })
		.where(eq(documents.id, deep))
	await db
		.update(documents)
		.set({ wordCount: 2_000, readingMinutes: 8 })
		.where(eq(documents.id, slow))
	const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)
	await db.insert(readingCompletions).values([
		{ userId: owner!.id, documentId: deep, cycle: 0, completedAt: minutesAgo(1), source: "manual" },
		// 8 days ago: the week before this one, whatever day this is.
		{
			userId: owner!.id,
			documentId: slow,
			cycle: 0,
			completedAt: minutesAgo(8 * 24 * 60),
			source: "progress",
		},
	])

	await page.goto("/home")
	await waitForHydration(page)
	await expect(page.getByTestId("home-finished")).toHaveText(
		"You finished Deep work this past week.",
	)
	await page.getByRole("link", { name: "See your reading" }).click()
	await expect(page).toHaveURL(/\/reading$/)
	await expect(page.getByRole("heading", { name: "Your reading", level: 1 })).toBeAttached()

	const week = page.getByTestId("total-week")
	await expect(week).toContainText("1 article")
	await expect(week).toContainText("50,000 words · about 3 h 20 min")
	await expect(week).toContainText("Longer than The Great Gatsby")
	// Today's square is inked; the year grid has one per day.
	const today = page.getByTestId("year-grid").locator("[data-count]").last()
	await expect(today).toHaveAttribute("data-count", "1")

	// This week first; the week before, by its bar.
	const chosen = page.getByTestId("period-selected")
	await expect(chosen.getByRole("link", { name: /Deep work/ })).toBeVisible()
	await expect(chosen).not.toContainText("Slow reading")
	const bars = page.getByTestId("period-bars").getByRole("link")
	await expect(bars).toHaveCount(12)
	await bars.nth(-2).click()
	await expect(page).toHaveURL(/by=week&start=\d{4}-\d{2}-\d{2}$/)
	await expect(bars.nth(-2)).toHaveAttribute("aria-current", "true")
	await expect(chosen.getByRole("link", { name: /Slow reading/ })).toBeVisible()
	await expect(chosen).not.toContainText("Deep work")
	await chosen.getByRole("link", { name: /Slow reading/ }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${slow}$`))

	// By month, the current month is chosen, last of twelve.
	await page.goto("/reading")
	await page.getByRole("link", { name: "Months" }).click()
	await expect(page.getByRole("heading", { name: "Month by month" })).toBeVisible()
	await expect(bars.last()).toHaveAttribute("aria-current", "true")
})
