import {
	db,
	documentTopics,
	user,
	eq,
	monthOf,
	topicLibraries,
	topicSorts,
	topics,
	usageCounts,
	userFeatures,
} from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { signupAdmin, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const userByEmail = async (email: string) =>
	(await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!

/**
 * Topics' limits and counts, where readers and admins see them: the month's sorts spent on the
 * Topics page, and on /admin/usage what topics cost and how they were used. The reader is an
 * admin, to see their own row; the topics are set up as the worker leaves them, without it.
 */
test("topics: sorting waits for next month at the budget, and admins see costs and uses", async ({
	page,
}) => {
	const email = await signupAdmin(page, "Topic Budget")
	const reader = await userByEmail(email)
	await db.insert(userFeatures).values({ userId: reader.id, feature: "topics" })
	const now = new Date()
	await db
		.insert(topicLibraries)
		.values({ userId: reader.id, proposedAt: now, seenAt: now, confirmedAt: now })
	const [topic] = await db
		.insert(topics)
		.values({
			userId: reader.id,
			name: "Psyche",
			description: "Articles from Psyche.",
			status: "active",
			origin: "first",
		})
		.returning({ id: topics.id })
	for (let i = 1; i <= 3; i++) {
		const id = await insertArticle(reader.id, `Psyche essay ${i}`, "<p>Psyche</p>")
		await db.insert(topicSorts).values({ documentId: id, userId: reader.id })
		await db
			.insert(documentTopics)
			.values({ documentId: id, topicId: topic!.id, probability: 0.9, level: "applied" })
	}
	// Two saved since, and the month's 1,000 sorts spent: they wait.
	await insertArticle(reader.id, "Waiting essay 1", "<p>Later</p>")
	await insertArticle(reader.id, "Waiting essay 2", "<p>Later</p>")
	const { month, resetsAt } = monthOf()
	await db.insert(usageCounts).values([
		{ userId: reader.id, metric: "topic_sorts", month, count: 1000 },
		{ userId: reader.id, metric: "topics", month, count: 3 },
		// Far past any real account's, so this one is in the top 50 of the Topics table: $2,000.
		{ userId: reader.id, metric: "topic_spend", month, count: 2_000_000_000 },
	])

	await page.goto("/topics")
	const next = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
		resetsAt,
	)
	await expect(page.getByTestId("topics-sorts-paused")).toHaveText(
		`Sorting stopped for this month: 1,000 articles were sorted, the most an account can. 2 articles are waiting, and sorting starts again on ${next}. Nothing is lost.`,
	)
	await expect(page.getByTestId("topics-sorting")).toHaveCount(0)

	// Uses, clicked: a topic chosen in the library, then its page opened from there.
	await page.goto("/library")
	await waitForHydration(page)
	const counted = () =>
		page.waitForRequest((r) => r.url().endsWith("/topics/use") && r.method() === "POST")
	let beacon = counted()
	await page.getByRole("button", { name: "Choose a topic" }).click()
	await page.getByRole("menuitem", { name: /Psyche/ }).click()
	await beacon
	await expect(page).toHaveURL(new RegExp(`topic=${topic!.id}`))
	beacon = counted()
	await page.getByRole("link", { name: "Everything in Psyche" }).click()
	await beacon
	await expect(page).toHaveURL(new RegExp(`/topics/${topic!.id}$`))
	// A reload is not a click: once the page runs again, it has sent nothing.
	const sent: string[] = []
	page.on("request", (r) => {
		if (r.url().endsWith("/topics/use")) sent.push(r.url())
	})
	await page.reload()
	await waitForHydration(page)
	expect(sent).toEqual([])

	await expect
		.poll(async () =>
			(await db.select().from(usageCounts).where(eq(usageCounts.userId, reader.id)))
				.filter((r) => r.month === month && r.metric.startsWith("topic_"))
				.map((r) => `${r.metric}:${r.count}`)
				.sort(),
		)
		.toEqual([
			"topic_filter_library:1",
			"topic_opened:1",
			"topic_sorts:1000",
			"topic_spend:2000000000",
		])

	await page.goto("/admin/usage?by=topicCost")
	await expect(page.getByLabel("Rank by")).toHaveValue("topicCost")
	const usageRow = page.getByRole("table").first().getByRole("row").filter({ hasText: email })
	await expect(usageRow).toContainText("$2,000.00")
	const topicsTable = page.getByRole("table", { name: "Topics this month" })
	await expect(topicsTable.getByRole("columnheader")).toContainText([
		"Name",
		"Cost",
		"Articles sorted",
		"Haiku's work",
		"Library filter",
		"Search filter",
		"Topic opened",
	])
	const row = topicsTable.getByRole("row").filter({ hasText: email })
	await expect(row.getByRole("cell")).toHaveText([
		/Topic Budget/,
		"$2,000.00",
		"1000 / 1000",
		"3 / 100",
		"1",
		"0",
		"1",
		"0",
		"0",
		"0",
		"0",
		"0",
	])
	await expect(page.getByTestId("topic-cost-total")).toContainText(
		"Topics this month, every account",
	)
})
