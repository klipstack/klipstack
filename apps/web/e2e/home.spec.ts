import { createHash } from "node:crypto"
import {
	db,
	documents,
	documentTopics,
	documentVersions,
	eq,
	feeds,
	feedItems,
	subscriptions,
	notifyDocumentEvent,
	topicLibraries,
	topicSorts,
	topics,
	user,
} from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { createInviteCode, signupUser, uniqueEmail, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

test("home adapts to the library, opens articles and returns after finishing", async ({ page }) => {
	test.setTimeout(60_000)
	const email = uniqueEmail("home")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Home Reader")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing home test user")
	await expect(page.getByRole("heading", { name: "Your next read starts here" })).toBeVisible()
	await expect(page.getByRole("link", { name: "Save link", exact: true })).toHaveAttribute(
		"href",
		"/add",
	)
	await expect(page.getByTestId("home-article")).toHaveCount(0)
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner.id,
			sourceUrl: "https://example.com/home-story",
			urlHash: owner.id,
			title: "A story worth returning to",
			status: "processing",
			readingMinutes: 8,
			firstOpenedAt: new Date(),
			lastReadAt: new Date(),
			readingProgress: 0.4,
			readingPosition: 0.4,
		})
		.returning()
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "Your next read is on its way" })).toBeVisible()
	await expect(page.getByRole("link", { name: "View library", exact: true })).toHaveAttribute(
		"href",
		"/library",
	)
	await db.update(documents).set({ status: "failed" }).where(eq(documents.id, doc!.id))
	await page.reload()
	await waitForHydration(page)
	await expect(
		page.getByRole("heading", { name: "Some articles couldn't be prepared" }),
	).toBeVisible()
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: "<p>A short story to test the reading journey.</p>",
			text: "A short story to test the reading journey.",
			textHash: "home-story",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning()
	await db
		.update(documents)
		.set({ currentVersionId: version!.id, status: "ready" })
		.where(eq(documents.id, doc!.id))
	// A finished extraction replaces the empty state without navigating or refreshing the page.
	await expect(async () => {
		await notifyDocumentEvent({ userId: owner.id, documentId: doc!.id, kind: "ready" })
		await expect(page.getByTestId("home-article")).toHaveCount(1, { timeout: 2000 })
	}).toPass({ timeout: 10_000 })
	await expect(page.getByRole("link", { name: "View library", exact: true })).toHaveCount(0)
	await expect(page.getByRole("heading", { name: "Recently saved" })).toHaveCount(0)
	await page.getByRole("link", { name: "View all: Continue reading", exact: true }).click()
	await expect(page.getByRole("button", { name: "Sort: Recently read" })).toBeVisible()
	await page.getByRole("button", { name: "Sort: Recently read" }).click()
	await page.getByRole("menuitem", { name: "Newest first" }).click()
	await expect(page).toHaveURL(/show=progress&sort=newest/)
	await page.goto("/home")
	await waitForHydration(page)
	await page.setViewportSize({ width: 390, height: 844 })
	await expect(page.getByRole("heading", { name: "Welcome back, Home", exact: true })).toBeVisible()
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true)
	await page.getByTestId("home-article").click()
	await expect(page).toHaveURL(new RegExp(`/read/${doc!.id}$`))
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: doc!.title!, exact: true })).toBeVisible()
	await page.getByRole("button", { name: "Mark as finished", exact: true }).click()
	await expect(page).toHaveURL(/\/home$/)
	await expect(page.getByTestId("home-article")).toHaveCount(0)
	await expect(page.getByRole("heading", { name: "Ready for your next read" })).toBeVisible()
	await page.getByRole("link", { name: "Revisit saved articles", exact: true }).click()
	await expect(page).toHaveURL(/\/archive$/)
	await expect(page.getByRole("heading", { name: doc!.title!, exact: true })).toBeVisible()
})

test("Home discovers new feed posts and returns here after save and read", async ({
	page,
	context,
}) => {
	const email = uniqueEmail("home-feeds")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Feed Reader")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = (await db.query.user.findFirst({ where: eq(user.email, email) }))!
	const url = `https://home-${Date.now()}.example.com/feed`
	const hash = (input: string) => createHash("sha256").update(input).digest("hex")
	const [feed] = await db
		.insert(feeds)
		.values({ url, urlHash: hash(url), title: "Home blog" })
		.returning()
	await db.insert(subscriptions).values({ userId: owner.id, feedId: feed!.id })
	const posts = await db
		.insert(feedItems)
		.values(
			[1, 2, 3].map((n) => ({
				feedId: feed!.id,
				guid: `${n}`,
				title: `Home post ${n}`,
				url: `${url}/${n}`,
				urlHash: hash(`${url}/${n}`),
				excerpt: `An interesting post ${n}.`,
				sortAt: new Date(Date.now() - n * 3_600_000),
			})),
		)
		.returning()
	// Timers the test can fast-forward: waiting out a timer that must not fire takes no real time.
	await page.clock.install()
	await page.goto("/home")
	await waitForHydration(page)
	const discovery = page.getByTestId("home-feed")
	await expect(discovery.getByTestId("feed-item")).toHaveCount(3)
	await expect(page.getByRole("heading", { name: "Your next read starts here" })).toHaveCount(0)
	await page.clock.runFor(3_500)
	await expect(discovery.getByTestId("feed-new-dot")).toHaveCount(3)
	await discovery.getByRole("link", { name: "View feeds" }).click()
	await expect(page).toHaveURL(/\/feed$/)
	await page.getByRole("link", { name: "Home", exact: true }).click()
	await expect(discovery.getByTestId("feed-new-dot")).toHaveCount(3)

	await discovery.getByRole("button", { name: "Home post 1", exact: true }).click()
	const dialog = page.getByRole("dialog", { name: "Post actions" })
	await context.route(`${url}/**`, (route) =>
		route.fulfill({ contentType: "text/html", body: "<p>Original</p>" }),
	)
	const opening = page.waitForEvent("popup")
	await dialog.getByRole("link", { name: "Open original" }).click()
	const original = await opening
	await expect(original).toHaveURL(`${url}/1`)
	await original.close()
	await expect(discovery.getByTestId("feed-item")).toHaveCount(2)
	await expect(discovery.getByRole("button", { name: "Home post 1", exact: true })).toHaveCount(0)

	const second = discovery.getByTestId("feed-item").filter({ hasText: "Home post 2" })
	await second.hover()
	await second.getByRole("button", { name: "Dismiss", exact: true }).click()
	await expect(discovery.getByTestId("feed-item")).toHaveCount(1)
	await page.getByRole("status").getByRole("button", { name: "Undo" }).click()
	await expect(discovery.getByTestId("feed-item")).toHaveCount(2)

	// Ready copies saved elsewhere since this page loaded exercise deduplication without fetching.
	const readyArticle = async (title: string) => {
		const post = posts.find((post) => post.title === title)!
		const [doc] = await db
			.insert(documents)
			.values({
				userId: owner.id,
				sourceUrl: post.url,
				urlHash: post.urlHash,
				title,
				status: "ready",
			})
			.returning()
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: "<p>A short feed story.</p>",
				text: "A short feed story.",
				textHash: "home-feed-story",
				extractor: "test",
				extractorVersion: "1",
			})
			.returning()
		await db
			.update(documents)
			.set({ currentVersionId: version!.id })
			.where(eq(documents.id, doc!.id))
		return doc!
	}
	const saved = await readyArticle("Home post 3")
	const third = discovery.getByTestId("feed-item").filter({ hasText: "Home post 3" })
	await third.hover()
	await third.getByRole("button", { name: "Save", exact: true }).click()
	await expect(discovery.getByTestId("feed-item")).toHaveCount(1)
	await expect(page).toHaveURL(/\/home$/)
	expect(await db.query.documents.findFirst({ where: eq(documents.id, saved.id) })).toMatchObject({
		firstOpenedAt: null,
		readAt: null,
	})
	await page.setViewportSize({ width: 390, height: 844 })
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true)
	const read = await readyArticle("Home post 2")
	// The saved post's big card pushes this one below a phone's fold. Scroll first: the menu closes
	// on scroll, and a scroll-into-view lands a frame after the click.
	const post = second.getByRole("button", { name: "Home post 2", exact: true })
	await post.scrollIntoViewIfNeeded()
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	)
	await post.click()
	await dialog.getByRole("button", { name: "Save and read", exact: true }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${read.id}$`))
	await waitForHydration(page)
	await page.getByRole("button", { name: "Mark as finished", exact: true }).click()
	await expect(page).toHaveURL(/\/home$/)
	await expect(discovery).toHaveCount(0)
	await expect(page.getByRole("heading", { name: "Recently saved" })).toBeVisible()
	await expect(page.getByTestId("feed-nav-dot")).toHaveCount(0)
})

test("home cards keep the image box without an image, so titles in a row line up", async ({
	page,
}) => {
	const email = uniqueEmail("home-images")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Image Reader")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!owner) throw new Error("Missing home test user")
	// An inline image: nothing to fetch.
	const image =
		"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='10'><rect width='16' height='10' fill='teal'/></svg>"
	const article = (n: number, title: string) => ({
		userId: owner.id,
		status: "ready" as const,
		readingMinutes: 20,
		title,
		sourceUrl: `https://example.com/${email}/${n}`,
		urlHash: `${email}/${n}`,
		createdAt: new Date(Date.now() - n * 1000),
	})
	await db.insert(documents).values([
		{ ...article(1, "Saved with an image"), leadImageUrl: image },
		article(2, "Saved without an image"),
		{
			...article(3, "Being read, without an image"),
			firstOpenedAt: new Date(),
			readingProgress: 0.4,
			readingPosition: 0.4,
		},
	])
	await page.goto("/home")
	await waitForHydration(page)

	const recent = page.locator("section[aria-labelledby=home-recent]").getByTestId("home-article")
	await expect(recent).toHaveCount(2)
	await expect(recent.getByTestId("article-image-placeholder")).toHaveCount(1)
	const tops = await recent
		.locator("h3")
		.evaluateAll((titles) => titles.map((h) => Math.round(h.getBoundingClientRect().top)))
	expect(tops[1]).toBe(tops[0])
	// The article being read gets the same placeholder.
	const reading = page.locator("section[aria-labelledby=home-reading]")
	await expect(reading.getByTestId("article-image-placeholder")).toHaveCount(1)
	if (process.env.SHOT_DIR)
		await page.screenshot({
			path: `${process.env.SHOT_DIR}/home-image-placeholder.png`,
			fullPage: true,
		})
})

test("without reading in progress, the newest save takes the big card", async ({ page }) => {
	const email = uniqueEmail("home-lead")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Lead Reader")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = (await db.query.user.findFirst({ where: eq(user.email, email) }))!
	const saves = await db
		.insert(documents)
		.values(
			[1, 2, 3, 4, 5].map((n) => ({
				userId: owner.id,
				status: "ready" as const,
				readingMinutes: 20,
				title: `Saved ${n}`,
				sourceUrl: `https://example.com/${email}/${n}`,
				urlHash: `${email}/${n}`,
				createdAt: new Date(Date.now() - n * 1000),
			})),
		)
		.returning()
	await page.goto("/home")
	await waitForHydration(page)

	await expect(page.getByRole("heading", { name: "Continue reading" })).toHaveCount(0)
	const recent = page.locator("section[aria-labelledby=home-recent]").getByTestId("home-article")
	await expect(recent).toHaveCount(4)
	await expect(recent.first()).toContainText("Saved 1")
	await expect(recent.first()).toContainText("Start reading")
	await expect(recent.filter({ hasText: "Start reading" })).toHaveCount(1)
	// The big card spans the section, the other three share the row below it.
	const boxes = await recent.evaluateAll((cards) =>
		cards.map((card) => {
			const box = card.getBoundingClientRect()
			return { top: Math.round(box.top), width: Math.round(box.width) }
		}),
	)
	expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 2)
	expect(new Set(boxes.slice(1).map((box) => box.top)).size).toBe(1)
	if (process.env.SHOT_DIR)
		await page.screenshot({ path: `${process.env.SHOT_DIR}/home-lead.png`, fullPage: true })

	// Once one is in progress, Continue reading has the big card again, and recent saves go back to three.
	await db
		.update(documents)
		.set({ firstOpenedAt: new Date(), lastReadAt: new Date(), readingProgress: 0.3 })
		.where(eq(documents.id, saves[4]!.id))
	await page.reload()
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "Continue reading" })).toBeVisible()
	await expect(recent).toHaveCount(3)
	await expect(recent.filter({ hasText: "Start reading" })).toHaveCount(0)
})

test("Home brings back older saves and narrows to the time chosen, without asking again", async ({
	page,
	browser,
}) => {
	const email = uniqueEmail("home-time")
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Time Reader")
	await page.getByLabel("Email").fill(email)
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const owner = (await db.query.user.findFirst({ where: eq(user.email, email) }))!
	const day = 86_400_000
	const saves = [
		{ title: "Half read, ten left", minutes: 20, age: 1, progress: 0.5 },
		{ title: "Fresh and long", minutes: 45, age: 1 },
		{ title: "Fresh and short", minutes: 4, age: 2 },
		{ title: "Fresh, twelve minutes", minutes: 12, age: 3 },
		...Array.from({ length: 8 }, (_, n) => ({ title: `Middling ${n}`, minutes: 25, age: 4 + n })),
		{ title: "Saved last month", minutes: 50, age: 30 },
		{ title: "Short, from last month", minutes: 3, age: 31 },
	]
	await db.insert(documents).values(
		saves.map((s) => {
			const url = `https://example.com/${owner.id}/${encodeURIComponent(s.title)}`
			return {
				userId: owner.id,
				sourceUrl: url,
				urlHash: createHash("sha256").update(url).digest("hex"),
				title: s.title,
				status: "ready" as const,
				readingMinutes: s.minutes,
				readingProgress: s.progress ?? 0,
				firstOpenedAt: s.progress ? new Date() : null,
				createdAt: new Date(Date.now() - s.age * day),
			}
		}),
	)
	await page.reload()
	await waitForHydration(page)

	const older = page.getByTestId("home-rediscover")
	await expect(older.getByRole("heading", { name: "From a while ago" })).toBeVisible()
	await expect(older.getByTestId("home-article")).toHaveText([/./, /./])
	await expect(
		older.getByRole("link", { name: "View all: From a while ago", exact: true }),
	).toHaveAttribute("href", "/library?show=unread&sort=oldest")

	// Fourteen unfinished articles, more than Home shows: the time choice leads the page.
	const time = page.getByTestId("home-time")
	const choice = (name: string) => time.getByRole("link", { name, exact: true })
	await expect(time.getByRole("heading", { name: "How much time do you have?" })).toBeVisible()
	await expect(choice("Any")).toHaveAttribute("aria-current", "true")
	const articles = page.getByTestId("home-article")
	await expect(articles).toHaveCount(6)

	const requests: string[] = []
	page.on("request", (r) => {
		if (r.resourceType() === "fetch" || r.resourceType() === "document") requests.push(r.url())
	})
	// Ten minutes left can't fit in five, but finishing what was started still comes first.
	await choice("5 min").click()
	await expect(choice("5 min")).toHaveAttribute("aria-current", "true")
	await expect(articles).toHaveText([
		/Half read, ten left/,
		/Fresh and short/,
		/Short, from last month/,
	])
	await expect(page).toHaveURL(/\/home\?time=5$/)
	await expect(
		page.getByText("Doesn't fit in 5 minutes, but it's where you left off."),
	).toBeVisible()
	await choice("15 min").click()
	// What fills at least half the time comes first.
	await expect(articles).toHaveText([
		/Half read, ten left/,
		/Fresh, twelve minutes/,
		/Fresh and short/,
		/Short, from last month/,
	])
	// Tapping the time already chosen changes nothing.
	await choice("15 min").click()
	await expect(page).toHaveURL(/\/home\?time=15$/)
	// With an hour, the long ones lead; the one from last month stays under From a while ago.
	await choice("60 min").click()
	await expect(articles).toHaveText([
		/Half read, ten left/,
		/Fresh and long/,
		/Fresh and short/,
		/Fresh, twelve minutes/,
		/Saved last month/,
		/Short, from last month/,
	])
	await expect(page.getByTestId("home-rediscover").getByTestId("home-article")).toHaveText([
		/Saved last month/,
		/Short, from last month/,
	])
	expect(requests).toEqual([])

	// Before the page's script runs (or without it), the choices are links the server answers.
	const noScript = await browser.newContext({
		javaScriptEnabled: false,
		storageState: await page.context().storageState(),
	})
	const plain = await noScript.newPage()
	await plain.goto("/home")
	await plain.getByTestId("home-time").getByRole("link", { name: "5 min", exact: true }).click()
	await expect(plain).toHaveURL(/\/home\?time=5$/)
	await expect(plain.getByTestId("home-article")).toHaveText([
		/Half read, ten left/,
		/Fresh and short/,
		/Short, from last month/,
	])
	await noScript.close()
	await page.screenshot({ path: "test-results/home-time.png", fullPage: true })

	// Nothing fits: say so, and offer everything again.
	await db
		.update(documents)
		.set({ readAt: new Date() })
		.where(eq(documents.title, "Half read, ten left"))
	await db
		.update(documents)
		.set({ readAt: new Date(), firstOpenedAt: new Date() })
		.where(eq(documents.title, "Fresh and short"))
	await db
		.update(documents)
		.set({ readAt: new Date(), firstOpenedAt: new Date() })
		.where(eq(documents.title, "Short, from last month"))
	// The address keeps the choice, and the server renders it.
	await page.goto("/home?time=5")
	await expect(choice("5 min")).toHaveAttribute("aria-current", "true")
	await expect(articles).toHaveCount(0)
	await expect(page.getByText("Nothing in your library fits in 5 minutes.")).toBeVisible()
	await page.getByRole("link", { name: "Show everything" }).click()
	await expect(page).toHaveURL(/\/home$/)
	await expect(choice("Any")).toHaveAttribute("aria-current", "true")
	await expect(articles).not.toHaveCount(0)
})

test("Home says what was finished this past week, and leaves tidying up out", async ({ page }) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Finished Reader")
	const owner = await db.query.user.findFirst({ where: eq(user.email, email) })
	const html = "<p>A few paragraphs worth reading to the end.</p>"
	const slow = await insertArticle(owner!.id, "Slow reading", html)
	const deep = await insertArticle(owner!.id, "Deep work", html)
	await insertArticle(owner!.id, "Old news", html)
	await insertArticle(owner!.id, "Older news", html)
	const finished = page.getByTestId("home-finished")

	// Nothing finished yet: nothing said, no zero.
	await page.goto("/home")
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "Recently saved" })).toBeVisible()
	await expect(finished).toHaveCount(0)

	// Opened from Home, finished in the reader, back on Home.
	const finishFromHome = async (id: string, title: string) => {
		await page.getByRole("link", { name: title }).first().click()
		await expect(page).toHaveURL(new RegExp(`/read/${id}$`))
		// At the end of the article, once it is on the page, as a reader gets there.
		const end = page.getByTestId("reader-end")
		await expect(end).toBeAttached()
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
		await expect(end).toBeInViewport()
		await end.getByRole("button", { name: "Mark as finished" }).click()
		await expect(page).toHaveURL(/\/home$/)
	}
	await finishFromHome(slow, "Slow reading")
	await expect(finished).toHaveText("You finished Slow reading this past week.")
	// The title stands apart from the sentence, as a title: not a link.
	await expect(finished.locator("cite")).toHaveText("Slow reading")
	await expect(finished.getByRole("link")).toHaveCount(0)

	// Two marked finished at once from the library is tidying up: it doesn't count.
	await page.goto("/library")
	await waitForHydration(page)
	const bar = page.getByRole("toolbar", { name: "Selected articles" })
	await page.getByRole("checkbox", { name: "Select “Old news”" }).click()
	await page.getByRole("checkbox", { name: "Select “Older news”" }).click()
	await expect(bar).toContainText("2 selected")
	await Promise.all([
		page.waitForResponse((r) => r.url().includes("/documents/bulk") && r.ok()),
		bar.getByRole("button", { name: "Mark finished" }).click(),
	])
	await page.goto("/home")
	await expect(finished).toHaveText("You finished Slow reading this past week.")

	await waitForHydration(page)
	await finishFromHome(deep, "Deep work")
	await expect(finished).toHaveText("You finished 2 articles this past week.")
	// On a phone the greeting is in the top bar; the line opens the page.
	await page.setViewportSize({ width: 390, height: 844 })
	await expect(finished).toBeVisible()
})

test("home narrows to a topic: the biggest as chips, the rest under More, something different", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Topic Home Reader", { features: ["topics"] })
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id
	// Confirmed topics and a sorted library, as the worker leaves them: it has nothing left to do.
	await db.insert(topicLibraries).values({
		userId,
		proposedAt: new Date(),
		confirmedAt: new Date(),
		librarySortedAt: new Date(),
	})
	const toRead = { Psyche: 4, Aeon: 3, Ideas: 2, Notes: 2, Craft: 1, Minor: 1 }
	for (const [name, count] of Object.entries(toRead)) {
		const [topic] = await db
			.insert(topics)
			.values({ userId, name, description: `About ${name}`, status: "active", origin: "first" })
			.returning({ id: topics.id })
		// Each topic read from once, but Craft: never, so it is the different one.
		const read = name === "Craft" ? 0 : 1
		for (let i = 0; i < count + read; i++) {
			const id = await insertArticle(userId, `${name} essay ${i + 1}`, `<p>${name}</p>`)
			await db
				.update(documents)
				.set(
					i < count
						? { readingMinutes: 10 }
						: { readingMinutes: 10, readAt: new Date(), archivedAt: new Date() },
				)
				.where(eq(documents.id, id))
			await db
				.insert(documentTopics)
				.values({ documentId: id, topicId: topic!.id, probability: 0.9, level: "applied" })
			await db.insert(topicSorts).values({ documentId: id, userId })
		}
	}

	await page.goto("/home")
	await waitForHydration(page)
	const choice = page.getByRole("group", { name: "About what?" })
	await expect(choice.getByRole("link")).toHaveText([
		"Anything",
		"Psyche",
		"Aeon",
		"Ideas",
		"Notes",
		"Something different",
	])
	await expect(choice.getByRole("link", { name: "Anything" })).toHaveAttribute(
		"aria-current",
		"true",
	)
	// Each card says its topic.
	await expect(page.getByTestId("home-article-topic").first()).toBeVisible()

	await choice.getByRole("link", { name: "Aeon" }).click()
	await expect(page).toHaveURL(/\?topic=/)
	const heading = page.getByTestId("home-topic")
	await expect(heading).toContainText("Aeon")
	await expect(heading).toContainText("3 to read")
	await expect(page.getByTestId("home-article")).toHaveCount(3)
	for (const title of await page.getByTestId("home-article").locator("h3").allTextContents())
		expect(title).toContain("Aeon")

	// With a time: none of them fits in 5 minutes; any length keeps the topic.
	await page
		.getByRole("group", { name: "How much time do you have?" })
		.getByRole("link", { name: "5 min", exact: true })
		.click()
	await expect(heading).toContainText("5 minutes of Aeon")
	await expect(page.getByText("Nothing in Aeon fits in 5 minutes.")).toBeVisible()
	await page.getByRole("link", { name: "Any length" }).click()
	await expect(page.getByTestId("home-article")).toHaveCount(3)
	await expect(heading).toContainText("Aeon")

	// The smaller topics are under More; chosen, one shows as a chip. A topic keeps the time.
	await page
		.getByRole("group", { name: "How much time do you have?" })
		.getByRole("link", { name: "30 min" })
		.click()
	await expect(heading).toContainText("30 minutes of Aeon")
	await choice.getByRole("button", { name: "More topics" }).click()
	await page.getByRole("menuitem", { name: "Minor" }).click()
	await expect(choice.getByRole("link", { name: "Minor" })).toHaveAttribute("aria-current", "true")
	await expect(heading).toContainText("30 minutes of Minor")
	await expect(heading).toContainText("1 to read")

	await choice.getByRole("link", { name: "Something different" }).click()
	await expect(page).toHaveURL(/&different/)
	await expect(page).toHaveURL(/time=30/)
	await expect(heading).toContainText("Craft")
	await expect(heading).toContainText("a topic you haven't read from yet")
	await expect(page.getByTestId("home-article")).toHaveCount(1)

	await choice.getByRole("link", { name: "Anything" }).click()
	await expect(page.getByTestId("home-topic")).toHaveCount(0)
})
