import {
	db,
	documents,
	documentTopics,
	eq,
	savedSearches,
	topicLibraries,
	topicSorts,
	topics,
	user,
} from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupUser, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

test("the library narrows to a topic, its search is saved, and the search says when it ended", async ({
	page,
}) => {
	test.setTimeout(60_000)
	const email = await signupUser(page, "Topic Library Reader", { features: ["topics"] })
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id
	// Confirmed topics and a sorted library, as the worker leaves them: it has nothing left to do.
	await db.insert(topicLibraries).values({
		userId,
		proposedAt: new Date(),
		confirmedAt: new Date(),
		librarySortedAt: new Date(),
	})
	const topicIds: Record<string, string> = {}
	for (const [name, count] of [
		["Psyche", 3],
		["Aeon", 2],
	] as const) {
		const [topic] = await db
			.insert(topics)
			.values({
				userId,
				name,
				description: `Essays from ${name}.`,
				status: "active",
				origin: "first",
			})
			.returning({ id: topics.id })
		topicIds[name] = topic!.id
		for (let i = 0; i < count; i++) {
			const id = await insertArticle(userId, `${name} essay ${i + 1}`, `<p>${name}</p>`)
			await db
				.insert(documentTopics)
				.values({ documentId: id, topicId: topic!.id, probability: 0.9, level: "applied" })
			await db.insert(topicSorts).values({ documentId: id, userId })
		}
	}
	const loose = await insertArticle(userId, "A loose note", "<p>Nothing like the others.</p>")
	await db.insert(topicSorts).values({ documentId: loose, userId })
	// Opened: no longer unread.
	await db
		.update(documents)
		.set({ firstOpenedAt: new Date(), readingProgress: 0.3 })
		.where(eq(documents.title, "Psyche essay 1"))

	await page.goto("/library")
	await waitForHydration(page)
	const cards = page.locator("main li h3")
	// Each card names its topic beside its source.
	await expect(page.getByTestId("card-topic")).toHaveCount(5)
	await page.getByRole("button", { name: "Choose a topic" }).click()
	const menu = page.getByRole("menu")
	await expect(menu.getByRole("menuitem")).toHaveText(["Psyche3", "Aeon2", "No topic1"])
	await menu.getByRole("menuitem", { name: "Psyche" }).click()
	await expect(page).toHaveURL(/\/library\?topic=/)
	await expect(cards).toHaveCount(3)
	await expect(page.getByTestId("topic-line")).toContainText("Essays from Psyche.")
	await expect(page.getByTestId("card-topic")).toHaveCount(0)

	// The filters keep to the topic, and count its articles.
	const filters = page.getByRole("navigation", { name: "Show" })
	await filters.getByRole("link", { name: "Unread 2" }).click()
	await expect(page).toHaveURL(/topic=.*show=unread/)
	await expect(cards).toHaveText(["Psyche essay 3", "Psyche essay 2"])

	// No topic, then every topic again.
	await page.getByRole("button", { name: "Topic: Psyche" }).click()
	await page.getByRole("menu").getByRole("menuitem", { name: "No topic" }).click()
	await expect(cards).toHaveText(["A loose note"])
	// Every topic again, still unread: the one opened is not.
	await page.getByRole("link", { name: "Show every topic" }).click()
	await expect(page).toHaveURL(/\/library\?show=unread$/)
	await expect(cards).toHaveCount(5)

	// Its search, saved under the topic's name.
	await page.goto(`/library?topic=${topicIds.Aeon}`)
	await page.getByRole("link", { name: "Search this topic" }).click()
	await expect(page).toHaveURL(/\/search\?q=topic%3AAeon(%20|\+)in%3Alibrary/)
	await expect(cards).toHaveCount(2)
	await expect(page.getByTestId("search-topic-chip")).toContainText("Aeon")
	await waitForHydration(page)
	await page.getByTestId("save-search").click()
	await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
	const saved = page.getByTestId("saved-searches")
	await expect(saved.getByRole("link", { name: "topic:Aeon in:library" })).toBeVisible()

	// The reader renames the topic: the saved search follows it.
	await page.goto("/topics")
	await waitForHydration(page)
	await page.getByRole("button", { name: "More for Aeon" }).click()
	await page.getByRole("menuitem", { name: "Rename" }).click()
	await page.getByLabel("Name of the topic Aeon").fill("Aeon Essays")
	// The new name shows at once: the sidebar's searches are read again once the rename is done.
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/topics")),
		page.getByRole("button", { name: "Rename", exact: true }).click(),
	])
	await expect(page.getByRole("heading", { name: "Aeon Essays" })).toBeVisible()
	const renamed = saved.getByRole("link", { name: "topic:Aeon in:library" })
	await expect(renamed).toHaveAttribute("href", /q=topic%3A%22Aeon(%20|\+)Essays%22/)
	await renamed.click()
	await expect(page).toHaveURL(/q=topic%3A%22Aeon(%20|\+)Essays%22/)
	await expect(cards).toHaveCount(2)

	// The topic ends: the sidebar marks the search, which offers to drop it, keeping the rest.
	await db.update(topics).set({ status: "retired" }).where(eq(topics.id, topicIds.Aeon!))
	await page.reload()
	await waitForHydration(page)
	await expect(saved.getByTestId("saved-search-ended").first()).toBeVisible()
	const notice = page.getByTestId("search-missing-topic")
	await expect(notice).toContainText("The topic “Aeon Essays” ended")
	await notice.getByRole("button", { name: "Remove it from this search" }).click()
	await expect(page).toHaveURL(/\/search\?q=in%3Alibrary$/)
	await expect(notice).toHaveCount(0)
	await expect(saved.getByTestId("saved-search-ended")).toHaveCount(0)

	// The search's own Topic chip writes the topic chosen into the query.
	await page
		.getByTestId("search-topic-chip")
		.getByRole("button", { name: "Choose a topic" })
		.click()
	await page.getByRole("menu").getByRole("menuitem", { name: "Psyche" }).click()
	await expect(page).toHaveURL(/\/search\?q=in%3Alibrary(%20|\+)topic%3APsyche$/)
	await expect(cards).toHaveCount(3)

	// Archive all read archives every read article: it is not offered in a topic.
	await db
		.update(documents)
		.set({ readAt: new Date(), readingProgress: 1 })
		.where(eq(documents.title, "Psyche essay 2"))
	await page.goto("/library?show=read")
	await expect(page.getByRole("button", { name: "Archive all read" })).toBeVisible()
	await page.goto(`/library?topic=${topicIds.Psyche}&show=read`)
	await expect(cards).toHaveText(["Psyche essay 2"])
	await expect(page.getByRole("button", { name: "Archive all read" })).toHaveCount(0)

	// Nothing starred in the topic: the way out keeps the view.
	await page.goto(`/starred?topic=${topicIds.Psyche}`)
	await expect(page.getByText("Nothing here right now.")).toBeVisible()
	await page.getByText("Show every topic", { exact: true }).click()
	await expect(page).toHaveURL(/\/starred$/)

	// Turning topics off names the saved searches that would find nothing.
	await db.insert(savedSearches).values({ userId, name: "Psyche reading", query: "topic:Psyche" })
	await page.goto("/topics")
	await waitForHydration(page)
	// So does removing the one topic it names, in the question before; Cancel keeps it.
	await page.getByRole("button", { name: "More for Psyche" }).first().click()
	await page.getByRole("menuitem", { name: "Remove" }).click()
	const asking = page.getByRole("group", { name: "Remove the topic Psyche" })
	await expect(asking).toContainText(
		"A saved search names this topic and will find nothing in it: Psyche reading.",
	)
	await asking.getByRole("button", { name: "Cancel" }).click()
	await expect(asking).toHaveCount(0)
	await page.getByRole("button", { name: "Turn off topics" }).click()
	await expect(page.getByTestId("topics-off-saved")).toHaveText(
		"1 saved search names topics and will find nothing in them: Psyche reading.",
	)
})

test("home's view all links keep the topic chosen", async ({ page }) => {
	const email = await signupUser(page, "Topic Home Links Reader", { features: ["topics"] })
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id
	await db.insert(topicLibraries).values({
		userId,
		proposedAt: new Date(),
		confirmedAt: new Date(),
		librarySortedAt: new Date(),
	})
	const ids: Record<string, string> = {}
	for (const name of ["Psyche", "Aeon"]) {
		const [topic] = await db
			.insert(topics)
			.values({ userId, name, description: name, status: "active", origin: "first" })
			.returning({ id: topics.id })
		ids[name] = topic!.id
		for (let i = 0; i < 2; i++) {
			const id = await insertArticle(userId, `${name} essay ${i + 1}`, `<p>${name}</p>`)
			await db
				.insert(documentTopics)
				.values({ documentId: id, topicId: topic!.id, probability: 0.9, level: "applied" })
			await db.insert(topicSorts).values({ documentId: id, userId })
		}
	}
	await page.goto(`/home?topic=${ids.Psyche}`)
	await page.getByRole("link", { name: "View all: Recently saved", exact: true }).click()
	await expect(page).toHaveURL(new RegExp(`/library\\?topic=${ids.Psyche}&show=unread$`))
	await expect(page.locator("main li h3")).toHaveText(["Psyche essay 2", "Psyche essay 1"])
})
