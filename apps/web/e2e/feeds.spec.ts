import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import {
	db,
	documents,
	documentVersions,
	eq,
	feeds,
	feedItems,
	storeFeedEntries,
	subscriptions,
	user,
} from "@klipstack/db"
import { expect, type Page, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"

/** Same as @klipstack/extract's (which loads jsdom, too heavy for the test runner). */
const urlHash = (url: string) => createHash("sha256").update(url).digest("hex")

async function signup(page: Page): Promise<string> {
	const email = await signupUser(page, "Reader", { verified: false, feeds: true })
	const row = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!row) throw new Error("no user")
	return row.id
}

/** Feeds straight in the database (the app cannot fetch local servers): one busy, one quiet. */
async function seed(userId: string) {
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`
	const busyUrl = `https://busy-${stamp}.example.com/feed`
	const quietUrl = `https://quiet-${stamp}.example.com/feed`
	const [busy, quiet] = await db
		.insert(feeds)
		.values([
			{
				url: busyUrl,
				urlHash: urlHash(busyUrl),
				title: "Busy blog",
				siteUrl: "https://example.com/",
			},
			{ url: quietUrl, urlHash: urlHash(quietUrl), title: "Quiet blog", errorCount: 5 },
		])
		.returning({ id: feeds.id })
	const hour = 3_600_000
	await storeFeedEntries(
		busy!.id,
		Array.from({ length: 7 }, (_, i) => {
			const url = `https://example.com/busy-${stamp}/${i + 1}`
			return {
				guid: `${i + 1}`,
				url,
				urlHash: urlHash(url),
				title: `Busy post ${i + 1}`,
				author: "Ann",
				excerpt: `What post ${i + 1} is about.`,
				publishedAt: new Date(Date.now() - (7 - i) * hour),
			}
		}),
	)
	await db.insert(subscriptions).values([
		{ userId, feedId: busy!.id },
		{ userId, feedId: quiet!.id },
	])
	return { busyId: busy!.id, quietId: quiet!.id }
}

test("feed page: new posts by date, the sites followed, save, dismiss, rename, unsubscribe", async ({
	page,
}) => {
	const userId = await signup(page)
	const { busyId, quietId } = await seed(userId)
	// Timers the test can fast-forward: waiting out a timer that must not fire takes no real time.
	await page.clock.install()
	await page.goto("/feed")
	await waitForHydration(page)

	// Nav dot and the dateline: there are new posts.
	await expect(page.getByTestId("feed-nav-dot").first()).toBeVisible()
	await expect(page.getByTestId("feed-summary")).toHaveText("7 new posts")

	// Every new post, newest first, under its day; the first is the lead.
	const fresh = page.getByTestId("feed-new")
	const posts = fresh.getByTestId("feed-item")
	await expect(posts).toHaveCount(7)
	await expect(posts.first()).toContainText("Busy post 7")
	await expect(posts.last()).toContainText("Busy post 1")
	await expect(fresh.getByRole("heading", { level: 2 }).first()).toHaveText(/today|yesterday/i)
	await expect(page.getByTestId("feed-seen")).toHaveCount(0)

	// The sites followed: the busy one with its new posts, the quiet one flagged as not updating.
	const sites = page.getByTestId("feed-sites")
	await expect(sites.getByRole("link", { name: /Busy blog/ })).toContainText("7")
	await expect(
		sites.getByRole("link", { name: /Quiet blog/ }).getByRole("img"),
	).toHaveAccessibleName("Not updating")

	// Merely leaving Feed on screen no longer acknowledges every post after three seconds.
	await page.clock.runFor(3_500)
	await expect(page.getByTestId("feed-nav-dot").first()).toBeVisible()
	await expect(posts.first().getByTestId("feed-new-dot")).toBeVisible()

	// Save keeps the post in its place, clipped, and links to the library article.
	const first = posts.filter({ hasText: "Busy post 7" })
	await page.mouse.move(1, 1)
	await expect(first.getByTestId("feed-actions")).toHaveCSS("opacity", "0")
	await first.getByRole("button", { name: "Busy post 7", exact: true }).focus()
	await expect(first.getByTestId("feed-actions")).toHaveCSS("opacity", "1")
	await first.hover()
	await first.getByRole("button", { name: "Save", exact: true }).click()
	await expect(first.getByRole("link", { name: "Read", exact: true })).toBeVisible()
	await expect(first.getByTestId("feed-clipped")).toHaveText("Clipped")
	await expect(first.getByTestId("feed-new-dot")).toHaveCount(0)
	await expect(posts.first()).toContainText("Busy post 7")
	const saved = await db.query.documents.findFirst({ where: eq(documents.userId, userId) })
	expect(saved?.captureSource).toBe("feed")
	expect(saved?.archivedAt).toBeNull()
	expect(saved?.readAt).toBeNull()

	// Dismiss, then undo.
	const second = posts.filter({ hasText: "Busy post 6" })
	await second.hover()
	await second.getByRole("button", { name: "Dismiss", exact: true }).click()
	await expect(posts.filter({ hasText: "Busy post 6" })).toHaveCount(0)
	await page.getByRole("status").getByRole("button", { name: "Undo" }).click()
	await expect(posts.filter({ hasText: "Busy post 6" })).toHaveCount(1)

	// A new visit: the saved post is among those seen, below the line that ends the new ones.
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByTestId("feed-summary")).toHaveText("6 new posts")
	await expect(page.getByTestId("feed-caught-up")).toBeVisible()
	await expect(page.getByTestId("feed-seen").getByTestId("feed-item")).toContainText("Busy post 7")

	// One site at a time: its name over its posts, renamed from its menu.
	await sites.getByRole("link", { name: /Busy blog/ }).click()
	await expect(page).toHaveURL(/\/feed\?site=/)
	const heading = page.getByRole("heading", { level: 2, name: "Busy blog" })
	await expect(heading).toBeVisible()
	await page.getByRole("button", { name: "Feed actions" }).click()
	await page.getByRole("menuitem", { name: "Rename" }).click()
	await page.getByRole("textbox", { name: "Name" }).fill("My busy blog")
	await page.getByRole("textbox", { name: "Name" }).press("Enter")
	await expect(page.getByRole("heading", { level: 2, name: "My busy blog" })).toBeVisible()
	await expect(sites.getByRole("link", { name: /My busy blog/ })).toBeVisible()
	await expect
		.poll(async () => {
			const row = await db.query.subscriptions.findFirst({
				where: eq(subscriptions.feedId, busyId),
			})
			return row?.title
		})
		.toBe("My busy blog")

	// A site that is not one of the reader's is every site.
	await page.goto(`/feed?site=${crypto.randomUUID()}`)
	await expect(page).toHaveURL(/\/feed$/)

	// Unsubscribe from the quiet one: back to every site, without it.
	await sites.getByRole("link", { name: /Quiet blog/ }).click()
	await expect(page.getByRole("heading", { level: 2, name: "Quiet blog" })).toBeVisible()
	await page.getByRole("button", { name: "Feed actions" }).click()
	await page.getByRole("menuitem", { name: "Unsubscribe" }).click()
	await page.getByRole("button", { name: "Unsubscribe", exact: true }).click()
	await expect(page).toHaveURL(/\/feed$/)
	await expect(sites.getByRole("link", { name: /Quiet blog/ })).toHaveCount(0)
	await expect
		.poll(() => db.query.subscriptions.findFirst({ where: eq(subscriptions.feedId, quietId) }))
		.toBeUndefined()
})

test("feeds are off for a new account until turned on in Settings → Features", async ({ page }) => {
	await signupUser(page, "New Reader")
	await page.goto("/home")
	await waitForHydration(page)
	const nav = page.getByRole("navigation").first()
	await expect(nav.getByRole("link", { name: "Home" })).toBeVisible()
	await expect(nav.getByRole("link", { name: "Feed", exact: true })).toHaveCount(0)
	expect((await page.goto("/feed"))?.status()).toBe(404)
	expect((await page.request.get("/feed/opml")).status()).toBe(404)
	await page.goto("/settings/usage")
	await expect(page.getByRole("heading", { name: "Usage", exact: true }).first()).toBeVisible()
	await expect(page.getByText("Feeds followed")).toHaveCount(0)

	await page.goto("/settings/features")
	await waitForHydration(page)
	const done = page.waitForResponse((r) => r.url().includes("/prefs") && r.ok())
	await page.getByTestId("feature-feeds").check()
	await done
	await page.goto("/home")
	await waitForHydration(page)
	await nav.getByRole("link", { name: "Feed", exact: true }).click()
	await expect(page).toHaveURL(/\/feed$/)
	await expect(page.getByRole("heading", { name: "No feeds yet" })).toBeVisible()
})

test("feed page: empty state offers to add a feed", async ({ page }) => {
	await signup(page)
	await page.goto("/feed")
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "No feeds yet" })).toBeVisible()
	await expect(page.locator("[data-empty-drawing=mailbox] svg")).toBeVisible()
	await page.getByRole("button", { name: "Follow a site" }).click()
	const dialog = page.getByRole("dialog", { name: "Follow a site" })
	await expect(dialog).toBeVisible()
	// Local addresses are refused, like saved links.
	await dialog.getByLabel("Site or feed address").fill("http://localhost:1/feed")
	await dialog.getByRole("button", { name: "Follow" }).click()
	await expect(dialog.getByText("We could not reach that site.")).toBeVisible()
})

test("feed: titles and right-click share post actions", async ({ page, context }) => {
	const userId = await signup(page)
	await seed(userId)
	await page.goto("/feed")
	await waitForHydration(page)
	const featured = page
		.getByTestId("feed-new")
		.getByTestId("feed-item")
		.filter({ hasText: "Busy post 7" })
	const title = featured.getByRole("button", { name: "Busy post 7", exact: true })
	const dialog = page.getByRole("dialog", { name: "Post actions" })
	await title.focus()
	await title.press("Enter")
	await expect(dialog).toBeVisible()
	await expect(title).toHaveAttribute("aria-expanded", "true")
	await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible()
	await expect(dialog.getByRole("button", { name: "Save and read" })).toBeVisible()
	await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused()
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)
	await expect(title).toBeFocused()
	await expect(featured.getByTestId("feed-new-dot")).toBeVisible()

	// The excerpt is also a context-menu target. Keep the popover beside the pointer.
	const excerpt = featured.getByText("What post 7 is about.")
	const box = (await excerpt.boundingBox())!
	// On whole pixels: a click's coordinates are, and the excerpt may sit between two.
	const point = { x: Math.ceil(box.x) + 12, y: Math.ceil(box.y) + 10 }
	await excerpt.click({ button: "right", position: { x: point.x - box.x, y: point.y - box.y } })
	await expect(dialog).toHaveAttribute("data-placement", "floating")
	const popupBox = (await dialog.boundingBox())!
	expect(popupBox.x).toBeCloseTo(point.x, 0)
	expect(popupBox.y).toBeCloseTo(
		Math.min(point.y, page.viewportSize()!.height - popupBox.height - 8),
		0,
	)
	const original = dialog.getByRole("link", { name: "Open original" })
	await expect(original).toHaveAttribute("target", "_blank")
	await expect(original).toHaveAttribute("rel", "noopener noreferrer")
	const originalUrl = (await original.getAttribute("href"))!
	await context.route("https://example.com/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "<p>Original post</p>" }),
	)
	const opening = page.waitForEvent("popup")
	await original.click()
	const originalPage = await opening
	await expect(originalPage).toHaveURL(originalUrl)
	await originalPage.close()
	await expect(page).toHaveURL(/\/feed$/)
	await expect(dialog).toHaveCount(0)
	await expect(featured.getByTestId("feed-new-dot")).toHaveCount(0)
	await expect(page.getByTestId("feed-new").getByTestId("feed-new-dot").first()).toBeVisible()

	await title.click()
	await dialog.getByRole("button", { name: "Save", exact: true }).click()
	await expect(dialog).toHaveCount(0)
	await expect(featured.getByRole("link", { name: "Read", exact: true })).toBeVisible()
	await title.click()
	await expect(dialog.getByRole("link", { name: "Read", exact: true })).toBeVisible()
	await expect(dialog.getByRole("button", { name: /^Save/ })).toHaveCount(0)
	await page.getByRole("heading", { name: "Feed", exact: true }).click()
	await expect(dialog).toHaveCount(0)

	// Dismiss from the same popover, then restore through the usual toast.
	await featured.click({ button: "right" })
	await dialog.getByRole("button", { name: "Dismiss", exact: true }).click()
	await expect(dialog).toHaveCount(0)
	await expect(featured).toHaveCount(0)
	await page.getByRole("status").getByRole("button", { name: "Undo" }).click()
	await expect(featured).toHaveCount(1)
})

test("feed: the popover of the last post stays beside its title, and a later scroll closes it", async ({
	page,
}) => {
	const userId = await signup(page)
	await seed(userId)
	await page.goto("/feed")
	await waitForHydration(page)
	const item = page.getByTestId("feed-item").last()
	const title = item.getByRole("button", { name: /^Busy post/ })
	const dialog = page.getByRole("dialog", { name: "Post actions" })
	expect((await title.boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height)
	// The click scrolls the last post into view; the browser reports that scroll after it opened.
	await title.click()
	await expect(dialog).toBeVisible()
	await page.waitForTimeout(500)
	await expect(dialog).toBeVisible()
	await expectBeside()

	// A little scroll and the popover follows its title; past the edge of the window and it closes.
	const b = (await title.boundingBox())!
	await page.mouse.move(b.x + b.width + 40, b.y - 100)
	await page.mouse.wheel(0, -40)
	await expect.poll(async () => (await title.boundingBox())!.y).toBeGreaterThan(b.y + 20)
	await expect(dialog).toBeVisible()
	await expectBeside()
	// Past the bottom of the window, and short of the top of the page: Chromium on macOS goes on
	// scrolling after a wheel that hits the top, and would pull the next scroll back up with it.
	const t = (await title.boundingBox())!
	await page.mouse.wheel(0, t.y - page.viewportSize()!.height - 20)
	await expect(dialog).toHaveCount(0)

	// Right-clicked at the bottom of the list, it stays open too.
	await page.evaluate(() => window.scrollTo(0, 0))
	expect((await title.boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height)
	await item.click({ button: "right" })
	await expect(dialog).toBeVisible()
	// Nothing should close it while the page settles.
	await page.waitForTimeout(500)
	await expect(dialog).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)

	// Right-clicked higher up, a little scroll moves it as far as the post.
	const items = page.getByTestId("feed-item")
	let upper = items.first()
	for (const candidate of await items.all()) {
		const y = (await candidate.boundingBox())!.y
		if (y > 100 && y < 300) {
			upper = candidate
			break
		}
	}
	const u = (await upper.boundingBox())!
	await upper.click({ button: "right", position: { x: 20, y: 10 } })
	await expect(dialog).toBeVisible()
	const d = (await dialog.boundingBox())!
	await page.mouse.move(u.x + 10, u.y + 5)
	await page.mouse.wheel(0, -50)
	await expect.poll(async () => (await upper.boundingBox())!.y).toBeGreaterThan(u.y + 30)
	await expect(async () => {
		const moved = (await upper.boundingBox())!.y - u.y
		expect(Math.abs((await dialog.boundingBox())!.y - d.y - moved)).toBeLessThan(2)
	}).toPass({ timeout: 2_000 })

	/** Lined up with the title's left edge, right under or above it. */
	async function expectBeside() {
		await expect(async () => {
			const t = (await title.boundingBox())!
			const d = (await dialog.boundingBox())!
			expect(Math.abs(d.x - t.x)).toBeLessThan(2)
			expect(
				Math.min(Math.abs(d.y - (t.y + t.height)), Math.abs(d.y + d.height - t.y)),
			).toBeLessThan(10)
		}).toPass({ timeout: 2_000 })
	}
})

test("feed page: imports an OPML file, and exports the feeds again", async ({ page }) => {
	await signup(page)
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`
	const first = `https://opml-${stamp}.example.com/feed`
	const second = `https://opml-${stamp}.example.com/atom.xml`
	await page.goto("/feed")
	await waitForHydration(page)

	// Someone coming from another reader starts from the empty page.
	await expect(page.getByRole("button", { name: "Import feeds (OPML)" })).toBeVisible()
	await page.getByTestId("opml-file").setInputFiles({
		name: "subscriptions.opml",
		mimeType: "text/x-opml",
		buffer: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
			<opml version="1.0"><head><title>Subscriptions</title></head><body>
				<outline text="Folder">
					<outline type="rss" text="First imported blog" xmlUrl="${first}"/>
				</outline>
				<outline type="rss" text="Second imported blog" xmlUrl="${second}"/>
				<outline type="rss" text="Not the web" xmlUrl="ftp://opml-${stamp}.example.com/feed"/>
			</body></opml>`),
	})
	await expect(page.getByRole("status")).toContainText("Following 2 new feeds.")
	await expect(page.getByRole("status")).toContainText("1 skipped.")
	// Nothing is fetched yet: both are among the sites followed, under the file's names.
	const sites = page.getByTestId("feed-sites").getByRole("link")
	await expect(sites).toHaveCount(3)
	await expect(sites.nth(1)).toContainText("First imported blog")
	await expect(sites.nth(2)).toContainText("Second imported blog")

	// A file that is something else says so.
	await page.getByTestId("opml-file").setInputFiles({
		name: "feed.xml",
		mimeType: "text/xml",
		buffer: Buffer.from("<rss><channel/></rss>"),
	})
	await expect(page.getByRole("status")).toContainText("That is not an OPML file.")

	// Export: the same feeds, under the same names.
	await page.getByRole("button", { name: "Feed options" }).click()
	const downloading = page.waitForEvent("download")
	await page.getByRole("menuitem", { name: "Export feeds (OPML)" }).click()
	const download = await downloading
	expect(download.suggestedFilename()).toBe("klipstack-feeds.opml")
	const xml = await readFile(await download.path(), "utf8")
	expect(xml).toContain(`text="First imported blog" title="First imported blog" xmlUrl="${first}"`)
	expect(xml).toContain(`xmlUrl="${second}"`)
})

test.describe("feed on touch devices", () => {
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
	test("save and read returns to Feed from the action sheet", async ({ page }) => {
		const userId = await signup(page)
		const { busyId } = await seed(userId)
		await page.goto("/feed")
		await waitForHydration(page)
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
			.toBe(true)
		const featured = page
			.getByTestId("feed-new")
			.getByTestId("feed-item")
			.filter({ hasText: "Busy post 7" })
		const item = (await db.select().from(feedItems).where(eq(feedItems.feedId, busyId))).find(
			(item) => item.title === "Busy post 7",
		)!
		// A ready article saved elsewhere since this page loaded uses the same deduplicated save path.
		const [doc] = await db
			.insert(documents)
			.values({
				userId,
				sourceUrl: item.url,
				urlHash: item.urlHash,
				title: item.title,
				status: "ready",
			})
			.returning()
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: "<p>A short post for reading.</p>",
				text: "A short post for reading.",
				textHash: "feed-read",
				extractor: "test",
				extractorVersion: "1",
			})
			.returning()
		await db
			.update(documents)
			.set({ currentVersionId: version!.id })
			.where(eq(documents.id, doc!.id))
		await expect(featured.getByTestId("feed-actions")).toHaveCSS("opacity", "1")
		await featured.getByRole("button", { name: "Busy post 7", exact: true }).tap()
		const sheet = page.getByRole("dialog", { name: "Post actions" })
		await expect(sheet).toHaveAttribute("data-placement", "bottom")
		const sheetBox = (await sheet.boundingBox())!
		expect(sheetBox.x).toBe(0)
		expect(sheetBox.width).toBe(390)
		expect(sheetBox.y + sheetBox.height).toBe(844)
		await sheet.getByRole("button", { name: "Close", exact: true }).tap()
		await expect(sheet).toHaveCount(0)
		await featured.getByRole("button", { name: "Busy post 7", exact: true }).tap()
		await sheet.getByRole("button", { name: "Save and read", exact: true }).tap()
		await expect(page).toHaveURL(new RegExp(`/read/${doc!.id}$`))
		await expect(page.getByRole("heading", { name: "Busy post 7", exact: true })).toBeVisible()
		await waitForHydration(page)
		await page.getByRole("button", { name: "Mark as finished", exact: true }).click()
		await expect(page).toHaveURL(/\/feed$/)
		await expect(page.getByTestId("feed-new").getByTestId("feed-item").first()).toContainText(
			"Busy post 6",
		)
		await page.getByRole("button", { name: "Feed options", exact: true }).tap()
		await page.getByRole("menuitem", { name: "Following", exact: true }).tap()
		const following = page.getByRole("dialog", { name: "Following", exact: true })
		await expect(following).toContainText("Busy blog")
		await expect(following).toContainText("Quiet blog")
		const busy = following.getByTestId("feed-quiet-row").filter({ hasText: "Busy blog" })
		await expect(busy.getByTestId("subscription-actions")).toHaveCSS("opacity", "1")
		await busy.getByRole("button", { name: "Rename", exact: true }).tap()
		await expect(following.getByRole("textbox", { name: "Name" })).toBeFocused()
		await following.getByRole("button", { name: "Cancel", exact: true }).tap()
		await following.getByRole("button", { name: "Close", exact: true }).tap()
		await expect(following).toHaveCount(0)
	})
})

test("Following opens from the page menu and manages feeds inside a scrollable modal", async ({
	page,
}) => {
	const userId = await signup(page)
	await seed(userId)
	const stamp = Date.now()
	const extras = await db
		.insert(feeds)
		.values(
			Array.from({ length: 12 }, (_, i) => {
				const url = `https://following-${stamp}-${i}.example.com/feed`
				return { url, urlHash: urlHash(url), title: `Other blog ${i}` }
			}),
		)
		.returning()
	await db.insert(subscriptions).values(extras.map((feed) => ({ userId, feedId: feed.id })))
	await page.goto("/feed")
	await waitForHydration(page)
	await expect(page.getByRole("button", { name: "Following", exact: true })).toHaveCount(0)
	const options = page.getByRole("button", { name: "Feed options", exact: true })
	await options.click()
	await page.getByRole("menuitem", { name: "Following", exact: true }).click()
	const dialog = page.getByRole("dialog", { name: "Following", exact: true })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByTestId("feed-quiet-row")).toHaveCount(14)
	await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused()
	const busy = dialog.getByTestId("feed-quiet-row").filter({ hasText: "Busy blog" })
	await expect(dialog.getByRole("button", { name: "Feed actions" })).toHaveCount(0)
	const actions = busy.getByTestId("subscription-actions")
	await expect(actions).toHaveCSS("opacity", "0")
	await busy.hover()
	await expect(actions).toHaveCSS("opacity", "1")
	await dialog.getByRole("button", { name: "Close", exact: true }).hover()
	await expect(actions).toHaveCSS("opacity", "0")
	await page.keyboard.press("Tab")
	await expect(busy.getByRole("button", { name: "Rename", exact: true })).toBeFocused()
	await expect(actions).toHaveCSS("opacity", "1")
	await expect(dialog.getByTestId("tooltip")).toHaveText("Rename")
	await expect(dialog.getByTestId("tooltip")).toBeVisible()
	await expect(busy.getByRole("link", { name: "Open site", exact: true })).toHaveAttribute(
		"href",
		"https://example.com/",
	)
	await expect(busy.getByRole("link", { name: "Open site", exact: true })).toHaveAttribute(
		"target",
		"_blank",
	)
	await page.keyboard.press("Enter")
	await dialog.getByRole("textbox", { name: "Name" }).press("Escape")
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveCount(0)
	await expect(busy.getByRole("button", { name: "Rename", exact: true })).toBeFocused()
	await busy.getByRole("button", { name: "Rename", exact: true }).click()
	await dialog.getByRole("textbox", { name: "Name" }).fill("A renamed blog")
	await dialog.getByRole("textbox", { name: "Name" }).press("Enter")
	await expect(dialog.getByText("A renamed blog", { exact: true })).toBeVisible()
	await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveCount(0)

	await page.setViewportSize({ width: 390, height: 500 })
	const quiet = dialog.getByTestId("feed-quiet-row").filter({ hasText: "Quiet blog" })
	await quiet.scrollIntoViewIfNeeded()
	await expect(quiet.getByText("Never updated", { exact: true })).toBeVisible()
	await expect(quiet.getByTestId("subscription-actions")).toHaveCSS("opacity", "1")
	const box = (await quiet.getByTestId("subscription-actions").boundingBox())!
	expect(box.x).toBeGreaterThanOrEqual(0)
	expect(box.x + box.width).toBeLessThanOrEqual(390)
	expect(box.y + box.height).toBeLessThanOrEqual(500)
	await quiet.getByRole("button", { name: "Unsubscribe", exact: true }).click()
	await expect(quiet.getByText("Stop following Quiet blog?", { exact: true })).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(dialog).toBeVisible()
	await expect(quiet.getByRole("button", { name: "Unsubscribe", exact: true })).toBeFocused()
	await quiet.getByRole("button", { name: "Unsubscribe", exact: true }).click()
	await quiet.getByRole("button", { name: "Unsubscribe", exact: true }).click()
	await expect(dialog.getByTestId("feed-quiet-row")).toHaveCount(13)
	await expect(dialog).toBeVisible()
	await page.keyboard.press("Escape")
	await expect(dialog).toHaveCount(0)
	await expect(options).toBeFocused()
	await options.click()
	await page.getByRole("menuitem", { name: "Following", exact: true }).click()
	await page.mouse.click(2, 2)
	await expect(dialog).toHaveCount(0)
	await expect(options).toBeFocused()
})
