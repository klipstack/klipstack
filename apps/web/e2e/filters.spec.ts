import { db, documents, eq, user } from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

async function signup(page: Page): Promise<string> {
	const email = await signupUser(page, "Reader", { verified: false })
	const row = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!row) throw new Error("no user")
	return row.id
}

/** Ready articles straight in the database: no extraction needed. Oldest first. */
async function seed(userId: string) {
	const base = Date.now() - 60_000
	const docs = [
		{ title: "Short new", minutes: 4 },
		{ title: "Long new", minutes: 35 },
		{ title: "Medium started", minutes: 15, opened: true, progress: 0.4 },
		{ title: "Scrolled to the end", minutes: 6, opened: true, progress: 1 },
		{ title: "A post on X", minutes: 1, url: "https://x.com/someone/status/123", post: true },
		{ title: "An article on X", minutes: 3, url: "https://x.com/someone/status/456" },
	]
	await db.insert(documents).values(
		docs.map((d, i) => ({
			userId,
			title: d.title,
			sourceUrl: d.url ?? `https://example.com/${i}`,
			urlHash: `filters-${userId}-${i}`,
			status: "ready" as const,
			type: d.post ? ("post" as const) : ("article" as const),
			readingMinutes: d.minutes,
			readingProgress: d.progress ?? 0,
			firstOpenedAt: d.opened ? new Date() : null,
			createdAt: new Date(base + i * 1000),
		})),
	)
}

const titles = (page: Page) => page.locator("main li h3").allInnerTexts()

test("inbox filters, sort, and archiving everything read", async ({ page }) => {
	const badgeCalls: string[] = []
	await page.exposeFunction("recordAppBadge", (action: string) => badgeCalls.push(action))
	await page.addInitScript(() => {
		const record = (window as unknown as { recordAppBadge: (action: string) => Promise<void> })
			.recordAppBadge
		Object.defineProperties(navigator, {
			setAppBadge: { configurable: true, value: (n: number) => record(`set:${n}`) },
			clearAppBadge: { configurable: true, value: () => record("clear") },
		})
	})
	await page.goto("/login")
	await expect.poll(() => badgeCalls.includes("clear")).toBe(true)
	const userId = await signup(page)
	await seed(userId)
	badgeCalls.length = 0
	await page.goto("/library")
	await waitForHydration(page)
	const filters = page.getByRole("navigation", { name: "Show" })

	await expect(filters.getByRole("link", { name: "Unread 4", exact: true })).toBeVisible()
	await expect(
		page.getByRole("complementary").getByRole("link", { name: "Library", exact: true }),
	).toHaveText("Library")
	await expect(page.getByTestId("unread-badge")).toHaveCount(0)
	await expect.poll(() => badgeCalls.includes("clear")).toBe(true)
	await filters.getByRole("link", { name: /^Quick reads/ }).click()
	await expect(page).toHaveURL(/show=quick/)
	// short X Articles are quick reads; posts are not
	await expect.poll(() => titles(page)).toEqual(["An article on X", "Short new"])

	await filters.getByRole("link", { name: /^Long reads/ }).click()
	await expect.poll(() => titles(page)).toEqual(["Long new"])
	await filters.getByRole("link", { name: /^Continue reading/ }).click()
	await expect.poll(() => titles(page)).toEqual(["Medium started"])
	await filters.getByRole("link", { name: /^From X/ }).click()
	await expect.poll(() => titles(page)).toEqual(["An article on X", "A post on X"])

	// sort keeps the filter and vice versa
	await filters.getByRole("link", { name: "All" }).click()
	await page.getByRole("button", { name: /^Sort/ }).click()
	await page.getByRole("menuitem", { name: "Longest first" }).click()
	await expect(page).toHaveURL(/sort=longest/)
	await expect
		.poll(() => titles(page))
		.toEqual([
			"Long new",
			"Medium started",
			"Scrolled to the end",
			"Short new",
			"An article on X",
			"A post on X",
		])

	// read ones go in one go, and come back with undo
	await filters.getByRole("link", { name: /^Read/ }).click()
	await expect(page).toHaveURL(/show=read&sort=longest/)
	await expect.poll(() => titles(page)).toEqual(["Scrolled to the end"])
	await page.getByRole("button", { name: "Archive all read" }).click()
	await expect(page.getByText("1 article archived")).toBeVisible()
	await expect(page.getByText("Nothing here right now.")).toBeVisible()
	await page.getByRole("button", { name: "Undo" }).click()
	await expect.poll(() => titles(page)).toEqual(["Scrolled to the end"])
	expect(badgeCalls.every((action) => action === "clear")).toBe(true)
})

test("sorted pages continue without gaps or repeats", async ({ page }) => {
	const userId = await signup(page)
	// 35 articles, lengths repeating so ties cross the page boundary; created in the same instant.
	const now = new Date()
	await db.insert(documents).values(
		Array.from({ length: 35 }, (_, i) => ({
			userId,
			title: `Article ${i}`,
			sourceUrl: `https://example.com/p/${i}`,
			urlHash: `pages-${userId}-${i}`,
			status: "ready" as const,
			readingMinutes: (i % 4) + 1,
			createdAt: now,
		})),
	)
	for (const sort of ["shortest", "oldest"]) {
		await page.goto(`/library?sort=${sort}`)
		await waitForHydration(page)
		await expect(page.locator("main li")).toHaveCount(30)
		const first = await titles(page)
		await page.getByRole("link", { name: "Load more" }).click()
		await expect(page).toHaveURL(new RegExp(`sort=${sort}&cursor=`))
		await expect(page.locator("main li")).toHaveCount(5)
		const all = [...first, ...(await titles(page))]
		expect(new Set(all).size).toBe(35)
	}
})

test("archive: grouped by when things were archived, with finished chips", async ({ page }) => {
	const userId = await signup(page)
	const day = 86_400_000
	const now = Date.now()
	const docs = [
		{ title: "Archived just now", ago: 0, finished: true },
		{ title: "Archived three days ago", ago: 3 * day, finished: false },
		{ title: "Archived long ago", ago: 800 * day, finished: false },
		{ title: "Still in the inbox", ago: null, finished: false },
	]
	await db.insert(documents).values(
		docs.map((d, i) => ({
			userId,
			title: d.title,
			sourceUrl: `https://example.com/archive/${i}`,
			urlHash: `archive-${userId}-${i}`,
			status: "ready" as const,
			readingMinutes: 5,
			archivedAt: d.ago === null ? null : new Date(now - d.ago),
			readAt: d.finished ? new Date(now) : null,
			// saved in the opposite order: the archive must not list by save date
			createdAt: new Date(now - (10 - i) * 1000),
		})),
	)
	await page.goto("/archive")
	await waitForHydration(page)
	await expect
		.poll(() => titles(page))
		.toEqual(["Archived just now", "Archived three days ago", "Archived long ago"])
	await expect(page.locator("main li h2")).toHaveText([
		"Today",
		"Last 7 days",
		String(new Date(now - 800 * day).getUTCFullYear()),
	])

	const filters = page.getByRole("navigation", { name: "Show" })
	await filters.getByRole("link", { name: "Not finished 2" }).click()
	await expect(page).toHaveURL(/\/archive\?show=unfinished/)
	await expect.poll(() => titles(page)).toEqual(["Archived three days ago", "Archived long ago"])
	await filters.getByRole("link", { name: "Finished 1" }).click()
	await expect.poll(() => titles(page)).toEqual(["Archived just now"])
	// no sort menu in the archive: its order is the grouping
	await expect(page.getByRole("button", { name: /^Sort/ })).toHaveCount(0)
})

test("starred: grouped by when things were starred, with finished chips", async ({ page }) => {
	const userId = await signup(page)
	const day = 86_400_000
	const now = Date.now()
	const docs = [
		{ title: "Starred today, finished", starred: 0, finished: true, archived: true },
		{ title: "Starred yesterday", starred: 1 * day, finished: false, archived: false },
		{ title: "Starred long ago", starred: 800 * day, finished: false, archived: true },
		{ title: "Not starred", starred: null, finished: false, archived: false },
	]
	await db.insert(documents).values(
		docs.map((d, i) => ({
			userId,
			title: d.title,
			sourceUrl: `https://example.com/starred/${i}`,
			urlHash: `starred-${userId}-${i}`,
			status: "ready" as const,
			readingMinutes: 5,
			starredAt: d.starred === null ? null : new Date(now - d.starred),
			archivedAt: d.archived ? new Date(now - 5 * day) : null,
			readAt: d.finished ? new Date(now) : null,
			// saved in the opposite order: starred must not list by save date
			createdAt: new Date(now - (10 - i) * 1000),
		})),
	)
	await page.goto("/starred")
	await waitForHydration(page)
	// inbox and archive alike, by star date
	await expect
		.poll(() => titles(page))
		.toEqual(["Starred today, finished", "Starred yesterday", "Starred long ago"])
	await expect(page.locator("main li h2")).toHaveText([
		"Today",
		"Yesterday",
		String(new Date(now - 800 * day).getUTCFullYear()),
	])

	const filters = page.getByRole("navigation", { name: "Show" })
	await filters.getByRole("link", { name: "Not finished 2" }).click()
	await expect(page).toHaveURL(/\/starred\?show=unfinished/)
	await expect.poll(() => titles(page)).toEqual(["Starred yesterday", "Starred long ago"])
	await expect(page.getByRole("button", { name: /^Sort/ })).toHaveCount(0)
})
