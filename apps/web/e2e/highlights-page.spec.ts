import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
	db,
	documents,
	documentTags,
	documentTopics,
	eq,
	highlights,
	tags,
	topicLibraries,
	topicSorts,
	topics,
	user,
} from "@klipstack/db"
import { expect, test } from "@playwright/test"
import { createInviteCode, signupUser, uniqueEmail, waitForHydration } from "./helpers"
import { insertArticle } from "./seed"

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
const TITLE = "Maker's Schedule, Manager's Schedule"

test("highlights page: filters, word search, stream and by article", async ({ page }) => {
	test.setTimeout(90_000)
	await page.goto("/signup")
	await page.getByLabel("Invite code").fill(await createInviteCode())
	await page.getByLabel("Name").fill("Marker")
	await page.getByLabel("Email").fill(uniqueEmail("hlpage"))
	await page.getByLabel("Password").fill("password123")
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL(/\/home$/)
	const res = await page.request.post("/api/documents", {
		data: { url: FIXTURE_URL, html: readFileSync(FIXTURE, "utf8") },
	})
	const { id } = ((await res.json()) as { article: { id: string } }).article
	await page.goto("/library")
	await expect(page.getByRole("link", { name: TITLE })).toBeVisible({ timeout: 60_000 })

	// highlights made through the API, like the extension or an agent would
	for (const h of [
		{ exact: "each day cut into one hour intervals", color: 0 },
		{ exact: "units of half a day at least", color: 1, note: "Why I block mornings." },
		{ exact: "Each type of schedule works fine by itself", color: 1 },
	]) {
		const created = await page.request.post(`/documents/${id}/highlights`, {
			data: { intent: "create", ...h },
		})
		expect(created.status()).toBe(201)
	}

	await page.goto("/highlights")
	await waitForHydration(page)
	const cards = page.locator("main li")
	const filters = page.getByRole("navigation", { name: "Show" })
	await expect(cards).toHaveCount(3)
	// by article first: the article once, its highlights in reading order below it
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible()
	await expect(page.getByText("3 highlights")).toBeVisible()
	await expect(cards.first()).toContainText("one hour intervals")
	// All, With notes and a chip per color in use (a dot and its count), in the colors' order.
	// (This used to say there were no color chips: they came with the board.)
	const chipNames = () =>
		filters
			.getByRole("link")
			.evaluateAll((links) => links.map((a) => a.getAttribute("aria-label") ?? a.textContent))
	await expect.poll(chipNames).toEqual(["All", "With notes1", "Yellow (1)", "Green (2)"])
	await filters.getByRole("link", { name: "Green (2)" }).click()
	await expect(page).toHaveURL(/show=green/)
	await expect(cards).toHaveCount(2)
	await expect(cards.first()).toContainText("units of half a day")
	await filters.getByRole("link", { name: "All", exact: true }).click()
	await expect(cards).toHaveCount(3)

	await filters.getByRole("link", { name: "With notes 1" }).click()
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Why I block mornings.")

	// the stream keeps the filter and names the article on every card
	await page.getByRole("link", { name: "Stream" }).click()
	await expect(page).toHaveURL(/show=notes&view=stream/)
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toHaveCount(0)
	await expect(cards).toHaveCount(1)
	await expect(cards.first()).toContainText(TITLE)

	// the choice sticks: plain /highlights (the sidebar link) opens the stream now
	await page.getByRole("complementary").getByRole("link", { name: "Highlights" }).click()
	await expect(page).toHaveURL(/\/highlights$/)
	await expect(cards).toHaveCount(3)
	await expect(page.getByRole("link", { name: "Stream" })).toHaveAttribute("aria-current", "true")
	await page.reload()
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toHaveCount(0)
	await expect(cards.first()).toContainText(TITLE)

	// every word has to match somewhere: quote, note or the article's title
	await page.goto("/highlights?q=manager+intervals")
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("one hour intervals")
	await page.goto("/highlights?q=mornings")
	await expect(cards).toHaveCount(1)
	// a quoted phrase matches as a whole, not word by word
	await page.goto(`/highlights?q=${encodeURIComponent('"half a day"')}`)
	await expect(cards).toHaveCount(1)
	await page.goto(`/highlights?q=${encodeURIComponent('"day a half"')}`)
	await expect(page.getByText("No highlights match that search.")).toBeVisible()
	// accents never matter; words find their variants, phrases do not
	await page.goto(`/highlights?q=${encodeURIComponent("MÓRNINGS")}`)
	await expect(cards).toHaveCount(1)
	await page.goto("/highlights?q=blocked")
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Why I block mornings.")
	await page.goto(`/highlights?q=${encodeURIComponent('"blocked mornings"')}`)
	await expect(page.getByText("No highlights match that search.")).toBeVisible()
	await page.goto("/highlights?q=intervals+zebra")
	await expect(page.getByText("No highlights match that search.")).toBeVisible()

	// no highlight with a note in the results: no notes chip, and only the color found
	await page.goto("/highlights?q=hour+intervals")
	await expect(cards).toHaveCount(1)
	await expect.poll(chipNames).toEqual(["All", "Yellow (1)"])
})

test("highlights board: by topic, a tag, notes written on the card, delete and Shuffle", async ({
	page,
}) => {
	test.setTimeout(90_000)
	const email = await signupUser(page, "Board Reader", { features: ["topics"] })
	const [owner] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
	const userId = owner!.id
	await db.insert(topicLibraries).values({
		userId,
		proposedAt: new Date(),
		confirmedAt: new Date(),
		librarySortedAt: new Date(),
	})
	const [craft] = await db
		.insert(topics)
		.values({
			userId,
			name: "Craft",
			description: "On making things.",
			status: "active",
			origin: "first",
		})
		.returning({ id: topics.id })
	let minute = 0
	const article = async (title: string, quotes: string[], { topic = true } = {}) => {
		const id = await insertArticle(userId, title, `<p>${title}</p>`)
		const [doc] = await db
			.select({ versionId: documents.currentVersionId })
			.from(documents)
			.where(eq(documents.id, id))
		await db.insert(topicSorts).values({ documentId: id, userId })
		if (topic)
			await db
				.insert(documentTopics)
				.values({ documentId: id, topicId: craft!.id, probability: 0.9, level: "applied" })
		for (const exact of quotes)
			await db.insert(highlights).values({
				userId,
				documentId: id,
				versionId: doc!.versionId!,
				startOffset: 0,
				endOffset: 1,
				exact,
				color: minute % 2,
				createdAt: new Date(Date.UTC(2026, 8, 1, 0, ++minute)),
			})
		return id
	}
	await article(
		"Workshop",
		["one", "two", "three", "four", "five", "six", "seven"].map((n) => `Craft ${n}`),
	)
	const kept = await article("Keepsake", ["Kept quote"])
	await article("Loose ends", ["Loose one", "Loose two"], { topic: false })
	const [tag] = await db.insert(tags).values({ userId, name: "keep" }).returning({ id: tags.id })
	await db.insert(documentTags).values({ documentId: kept, tagId: tag!.id })

	// By topic: the topic's newest six and a way to all eight; articles in no topic are Other.
	await page.goto("/highlights?view=topics")
	await waitForHydration(page)
	const cards = page.getByTestId("quote-card")
	const craftGroup = page.getByRole("region", { name: "Craft" })
	const other = page.getByRole("region", { name: "Other" })
	await expect(craftGroup.getByTestId("quote-card")).toHaveCount(6)
	await expect(craftGroup).toContainText("8 highlights")
	await expect(craftGroup.getByTestId("quote-card").first()).toContainText("Kept quote")
	await expect(other.getByTestId("quote-card")).toHaveCount(2)
	// Each card names its article.
	await expect(other.getByTestId("quote-card").first()).toContainText("Loose ends")

	// See all: the stream, narrowed to the topic, with a chip to undo it.
	await craftGroup.getByRole("link", { name: "See all 8" }).click()
	await expect(page).toHaveURL(new RegExp(`topic=${craft!.id}&view=stream`))
	await expect(cards).toHaveCount(8)
	await page.getByTestId("topic-chip").click()
	await expect(cards).toHaveCount(10)

	// The tag menu offers the tags whose articles have highlights.
	await page.getByRole("button", { name: "Choose a tag" }).click()
	await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["keep1"])
	await page.getByRole("menuitem", { name: "keep" }).click()
	await expect(page).toHaveURL(new RegExp(`tag=${tag!.id}`))
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Kept quote")

	// A note, written on the card: on a post-it, kept on reload.
	const card = cards.first()
	await card.hover()
	await card.getByRole("button", { name: "Add note" }).click()
	const editor = page.getByRole("dialog", { name: "Highlight note" })
	await editor.getByRole("textbox").fill("Worth a second look.")
	await editor.getByRole("button", { name: "Save" }).click()
	const note = card.getByRole("button", { name: "Edit note" })
	await expect(note).toContainText("Worth a second look.")
	await expect(note).toHaveAttribute("data-post-it", "full")
	await expect(note.getByTestId("post-it-tape")).toHaveCount(1)
	await page.reload()
	await waitForHydration(page)
	// Changed in place, on the same paper; Escape keeps what was there.
	await note.click()
	await editor.getByRole("textbox").fill("Worth a third look.")
	await editor.getByRole("textbox").press("Escape")
	await expect(note).toContainText("Worth a second look.")
	await note.click()
	await editor.getByRole("textbox").fill("Worth a third look.")
	await editor.getByRole("button", { name: "Save" }).click()
	await expect(note).toContainText("Worth a third look.")
	await expect
		.poll(
			async () =>
				(
					await db
						.select({ note: highlights.note })
						.from(highlights)
						.where(eq(highlights.exact, "Kept quote"))
				)[0]?.note,
		)
		.toBe("Worth a third look.")
	// Emptied, the note comes off the card.
	await note.click()
	await editor.getByRole("textbox").fill("")
	await editor.getByRole("button", { name: "Save" }).click()
	await expect(note).toHaveCount(0)
	await expect(card.getByTestId("post-it-tape")).toHaveCount(0)
	await page.reload()
	await waitForHydration(page)
	await expect(cards).toHaveCount(1)
	await expect(note).toHaveCount(0)
	await page.getByRole("link", { name: "Show every tag" }).click()
	await expect(cards).toHaveCount(10)

	// Delete, then Undo.
	const loose = cards.filter({ hasText: "Loose two" })
	await loose.hover()
	await loose.getByRole("button", { name: "Delete highlight" }).click()
	await expect(loose).toHaveCount(0)
	await page.getByRole("button", { name: "Undo" }).click()
	await expect(loose).toHaveCount(1)

	// Shuffle deals a hand, the same until dealt again; Done goes back to the view.
	await page.getByRole("link", { name: "Shuffle" }).click()
	await expect(page).toHaveURL(/shuffle=[a-z0-9]+$/)
	await expect(page.getByRole("heading", { name: "A random handful" })).toBeVisible()
	await expect(cards).toHaveCount(10)
	const hand = new URL(page.url()).searchParams.get("shuffle")
	const order = await cards.allTextContents()
	await page.reload()
	await expect.poll(() => cards.allTextContents()).toEqual(order)
	await page.getByRole("link", { name: "Deal again" }).click()
	await expect.poll(() => new URL(page.url()).searchParams.get("shuffle")).not.toBe(hand)
	await expect(cards).toHaveCount(10)
	await page.getByRole("link", { name: "Done" }).click()
	await expect(page).toHaveURL(/view=stream/)
	await expect(page.getByRole("heading", { name: "A random handful" })).toHaveCount(0)
})
