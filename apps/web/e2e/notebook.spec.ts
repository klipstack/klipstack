import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
	and,
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
import { expect, type Page, test } from "@playwright/test"
import {
	caretToEnd,
	createInviteCode,
	expectMarked,
	signupUser,
	uniqueEmail,
	waitForHydration,
} from "./helpers"
import { insertArticle } from "./seed"

/**
 * The Notebook: highlights and article notes on one page. (Until they merged, highlights had a page
 * of their own, /highlights, and these were highlights-page.spec.ts and notebook.spec.ts.)
 */

const FIXTURE = join(
	import.meta.dirname,
	"../../../packages/extract/test/fixtures/pages/paulgraham-makers.html",
)
const FIXTURE_URL = "https://paulgraham.com/makersschedule.html"
const TITLE = "Maker's Schedule, Manager's Schedule"

const noteSaved = (page: Page, id: string, status = 200) =>
	page.waitForResponse((r) => r.url().endsWith(`/documents/${id}/note`) && r.status() === status)

const highlightSaved = (page: Page, id: string) =>
	page.waitForResponse(
		(r) =>
			new URL(r.url()).pathname.startsWith(`/documents/${id}/highlights`) &&
			r.request().method() === "POST" &&
			r.ok(),
	)

async function writeNote(page: Page, id: string, note: string) {
	const res = await page.request.post(`/documents/${id}/note`, { data: { note } })
	expect(res.ok()).toBe(true)
}

const stored = async (id: string) =>
	(await db.query.documents.findFirst({ where: eq(documents.id, id) }))!.note

const shot = (page: Page, name: string) =>
	process.env.SHOT_DIR
		? page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true })
		: Promise.resolve()

test("notebook: filters, word search, stream and by article", async ({ page }) => {
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

	await page.goto("/notebook")
	await waitForHydration(page)
	const cards = page.locator("main li")
	const filters = page.getByRole("navigation", { name: "Show" })
	await expect(cards).toHaveCount(3)
	// by article first: the article once, its highlights in reading order beside it
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible()
	await expect(page.getByText("3 highlights")).toBeVisible()
	await expect(cards.first()).toContainText("one hour intervals")
	// Each quote marked in its highlight's color.
	await expectMarked(cards.first().locator(".marker"), "yellow")
	await expectMarked(cards.filter({ hasText: "half a day" }).locator(".marker"), "green")
	// All, Notes, Highlights and a chip per color in use (a dot and its count), in the colors' order.
	// (This used to read "All", "With notes1": All had no count, and highlights had a page alone.)
	const chipNames = () =>
		filters
			.getByRole("link")
			.evaluateAll((links) => links.map((a) => a.getAttribute("aria-label") ?? a.textContent))
	await expect.poll(chipNames).toEqual(["All3", "Notes1", "Highlights3", "Yellow (1)", "Green (2)"])
	await filters.getByRole("link", { name: "Green (2)" }).click()
	await expect(page).toHaveURL(/show=green/)
	await expect(cards).toHaveCount(2)
	await expect(cards.first()).toContainText("units of half a day")
	await filters.getByRole("link", { name: "All 3" }).click()
	await expect(cards).toHaveCount(3)

	await filters.getByRole("link", { name: "Notes 1" }).click()
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Why I block mornings.")

	// the stream keeps the filter and names the article on every card
	await page.getByRole("link", { name: "Stream" }).click()
	await expect(page).toHaveURL(/show=notes&view=stream/)
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toHaveCount(0)
	await expect(cards).toHaveCount(1)
	await expect(cards.first()).toContainText(TITLE)

	// the choice sticks: plain /notebook (the sidebar link) opens the stream now
	await page.getByRole("complementary").getByRole("link", { name: "Notebook" }).click()
	await expect(page).toHaveURL(/\/notebook$/)
	await expect(cards).toHaveCount(3)
	await expect(page.getByRole("link", { name: "Stream" })).toHaveAttribute("aria-current", "true")
	await page.reload()
	await expect(page.getByRole("heading", { level: 2, name: TITLE })).toHaveCount(0)
	await expect(cards.first()).toContainText(TITLE)

	// every word has to match somewhere: quote, note or the article's title
	await page.goto("/notebook?q=manager+intervals")
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("one hour intervals")
	await page.goto("/notebook?q=mornings")
	await expect(cards).toHaveCount(1)
	// a quoted phrase matches as a whole, not word by word
	await page.goto(`/notebook?q=${encodeURIComponent('"half a day"')}`)
	await expect(cards).toHaveCount(1)
	await page.goto(`/notebook?q=${encodeURIComponent('"day a half"')}`)
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()
	// accents never matter; words find their variants, phrases do not
	await page.goto(`/notebook?q=${encodeURIComponent("MÓRNINGS")}`)
	await expect(cards).toHaveCount(1)
	await page.goto("/notebook?q=blocked")
	await expect(cards).toHaveCount(1)
	await expect(cards).toContainText("Why I block mornings.")
	await page.goto(`/notebook?q=${encodeURIComponent('"blocked mornings"')}`)
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()
	await page.goto("/notebook?q=intervals+zebra")
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()

	// no highlight with a note in the results: no notes chip, and only the color found
	await page.goto("/notebook?q=hour+intervals")
	await expect(cards).toHaveCount(1)
	await expect.poll(chipNames).toEqual(["All1", "Highlights1", "Yellow (1)"])

	// The article's own note joins them: a card of its own in the stream, found by the same search.
	await writeNote(page, id, "Protect the mornings for deep work.")
	await page.goto("/notebook?q=mornings")
	await expect(cards).toHaveCount(2)
	const noteCard = page.getByTestId("note-card")
	await expect(noteCard.getByLabel(`Note on ${TITLE}`)).toHaveText(
		"Protect the mornings for deep work.",
	)
	await expect(noteCard.getByRole("link", { name: `Open ${TITLE}` })).toBeVisible()
	// No quote on it, and no ink: the article stands where the quote would.
	await expect(noteCard.getByTestId("quote-mark")).toHaveCount(0)
	await expect(noteCard.locator(".marker")).toHaveCount(0)
	await expect(noteCard.locator("[data-post-it]")).toHaveAttribute("data-post-it", "full")
	await expect(noteCard.getByTestId("post-it-tape")).toHaveCount(1)
	await expect.poll(chipNames).toEqual(["All2", "Notes2", "Highlights1", "Green (1)"])
	// Highlights alone: the note goes.
	await filters.getByRole("link", { name: "Highlights 1" }).click()
	await expect(cards).toHaveCount(1)
	await expect(noteCard).toHaveCount(0)

	// /highlights is gone: the Notebook holds them.
	expect((await page.goto("/highlights"))?.status()).toBe(404)
})

test("notebook: each article beside its note, written in place, found and narrowed", async ({
	page,
}) => {
	test.setTimeout(120_000)
	const email = await signupUser(page, "Notebook")
	const owner = await db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) })

	// Empty: a blank post-it, and an invitation to start.
	await page.goto("/notebook")
	await waitForHydration(page)
	await expect(page.getByRole("heading", { name: "Your notebook is empty" })).toBeVisible()
	await expect(page.getByTestId("blank-post-it")).toBeVisible()
	await expect(page.getByRole("link", { name: "Open your library" })).toBeVisible()
	await expect(page.getByRole("navigation", { name: "Show" })).toHaveCount(0)
	await shot(page, "notebook-empty")

	const tides = await insertArticle(owner!.id, "Tides", "<p>Tides and moons.</p>")
	const lighthouses = await insertArticle(owner!.id, "Lighthouses", "<p>Lamps.</p>")
	const harbors = await insertArticle(owner!.id, "Harbors", "<p>Boats come in.</p>")
	await insertArticle(owner!.id, "Without a note", "<p>Nothing to say.</p>")
	const [doc] = await db
		.select({ versionId: documents.currentVersionId })
		.from(documents)
		.where(eq(documents.id, harbors))
	// Harbors has a highlight and no note yet.
	await db.insert(highlights).values({
		userId: owner!.id,
		documentId: harbors,
		versionId: doc!.versionId!,
		startOffset: 0,
		endOffset: 5,
		exact: "Boats",
		createdAt: new Date(Date.now() - 60_000),
	})
	await writeNote(page, tides, "The moon pulls twice a day.")
	await writeNote(page, lighthouses, `Ask the keeper. Compare with [Tides](/read/${tides}).`)
	const [coast] = await db.insert(tags).values({ userId: owner!.id, name: "coast" }).returning()
	await db.insert(documentTags).values({ documentId: tides, tagId: coast!.id })

	// By article, the latest written first; an article with nothing kept is not there.
	await page.goto("/notebook")
	await waitForHydration(page)
	const articles = page.getByTestId("notebook-article")
	await expect(articles).toHaveCount(3)
	await expect(articles.nth(0).getByRole("heading", { name: "Lighthouses" })).toBeVisible()
	await expect(articles.nth(0).getByLabel("Note on Lighthouses")).toContainText("Ask the keeper.")
	await expect(articles.nth(1).getByLabel("Note on Tides")).toHaveText(
		"The moon pulls twice a day.",
	)
	await expect(articles.nth(2).getByRole("heading", { name: "Harbors" })).toBeVisible()
	// The link to Tides is a chip, as in the reader.
	await expect(articles.nth(0).getByTestId("doc-chip")).toHaveText("Tides")
	// Its note is a large post-it, as wide as its column.
	const noteBox = await articles.nth(0).locator("[data-post-it]").boundingBox()
	const columnBox = await articles.nth(0).locator("[data-post-it]").locator("..").boundingBox()
	expect(noteBox!.width).toBeGreaterThan(columnBox!.width - 20)
	await shot(page, "notebook-articles")

	// Written in place, saved on its own.
	const tidesNote = page.getByLabel("Note on Tides")
	await tidesNote.click()
	await caretToEnd(page)
	await Promise.all([noteSaved(page, tides), page.keyboard.type(" Spring tides are higher.")])
	await expect(articles.nth(1)).toContainText("Saved")
	expect(await stored(tides)).toBe("The moon pulls twice a day. Spring tides are higher.")
	// The next save replaces the note this one wrote: no conflict with itself.
	await Promise.all([noteSaved(page, tides), page.keyboard.type(" Twice a month.")])
	expect(await stored(tides)).toBe(
		"The moon pulls twice a day. Spring tides are higher. Twice a month.",
	)

	// Changed elsewhere meanwhile: nothing is overwritten unseen, and the writer chooses.
	await writeNote(page, tides, "Rewritten in the reader.")
	await Promise.all([noteSaved(page, tides, 409), page.keyboard.type(" Neap tides too.")])
	const alert = page.getByRole("alert")
	await expect(alert).toContainText("This note changed somewhere else")
	expect(await stored(tides)).toBe("Rewritten in the reader.")
	await Promise.all([
		noteSaved(page, tides),
		alert.getByRole("button", { name: "Keep mine" }).click(),
	])
	await expect(alert).toHaveCount(0)
	expect(await stored(tides)).toBe(
		"The moon pulls twice a day. Spring tides are higher. Twice a month. Neap tides too.",
	)

	await writeNote(page, tides, "The reader's version wins.")
	await tidesNote.click()
	await caretToEnd(page)
	await Promise.all([noteSaved(page, tides, 409), page.keyboard.type("!")])
	await page.getByRole("button", { name: "Use the saved note" }).click()
	await expect(page.getByLabel("Note on Tides")).toHaveText("The reader's version wins.")
	// The editor left behind sends nothing: once the page is quiet, the saved note is still there.
	await page.waitForLoadState("networkidle")
	expect(await stored(tides)).toBe("The reader's version wins.")

	// An article without a note: a blank post-it, no tape, to write the first one straight on.
	const harborsNote = articles.nth(2).getByLabel("Note on Harbors")
	const blank = articles.nth(2).locator("[data-post-it]")
	await expect(articles.nth(2).locator('[data-placeholder="Add your note"]')).toBeVisible()
	await expect(blank.getByTestId("post-it-tape")).toHaveCount(0)
	// A note written meanwhile elsewhere is not overwritten unseen, from a blank post-it either.
	await writeNote(page, harbors, "Written on the phone.")
	await harborsNote.click()
	await Promise.all([noteSaved(page, harbors, 409), page.keyboard.type("Fishing boats at dawn.")])
	await expect(alert).toContainText("This note changed somewhere else")
	expect(await stored(harbors)).toBe("Written on the phone.")
	await Promise.all([
		noteSaved(page, harbors),
		alert.getByRole("button", { name: "Keep mine" }).click(),
	])
	expect(await stored(harbors)).toBe("Fishing boats at dawn.")
	// Written on, it is paper like the others.
	await expect(blank.getByTestId("post-it-tape")).toHaveCount(1)

	// Search by the note's words, and the tag menu.
	await page.goto("/notebook?q=keeper")
	await expect(articles).toHaveCount(1)
	await expect(articles.first()).toContainText("Lighthouses")
	await page.goto("/notebook?q=nothingmatches")
	await expect(page.getByText("Nothing matches that search.")).toBeVisible()
	await page.goto("/notebook")
	await waitForHydration(page)
	await page.getByRole("button", { name: "Choose a tag" }).click()
	await page.getByRole("menuitem", { name: "coast" }).click()
	await expect(page).toHaveURL(new RegExp(`tag=${coast!.id}`))
	await expect(articles).toHaveCount(1)
	await expect(articles.first()).toContainText("Tides")

	// In the stream each note is a card; it opens its article with the note showing.
	await page.goto("/notebook?view=stream")
	await waitForHydration(page)
	await expect(page.getByTestId("note-card")).toHaveCount(3)
	await expect(page.getByTestId("quote-card")).toHaveCount(1)
	// Cards are clippings taped up: however the tape is set (each of its cuts), it stays inside the
	// card's box, or a column break would leave it at the foot of the column before.
	const card = page.getByTestId("quote-card")
	const tape = card.getByTestId("clipping-tape")
	const box = (await card.boundingBox())!
	for (const cut of ["0", "1", "2"]) {
		await tape.evaluate((el, cut) => {
			el.dataset.cut = cut
		}, cut)
		const taped = (await tape.boundingBox())!
		expect(taped.y).toBeGreaterThanOrEqual(box.y - 0.5)
		expect(taped.x).toBeGreaterThanOrEqual(box.x)
	}
	await page.getByRole("link", { name: "Open Tides" }).click()
	await expect(page).toHaveURL(new RegExp(`/read/${tides}#note$`))
	const sidebar = page.getByRole("complementary", { name: "Notes and highlights" })
	await expect(sidebar.getByLabel("Your note", { exact: true })).toHaveText(
		"The reader's version wins.",
	)

	// From the sidebar and the command palette, by its name or as where highlights are.
	await page.goto("/home")
	await waitForHydration(page)
	await expect(
		page.getByRole("complementary").getByRole("link", { name: "Highlights" }),
	).toHaveCount(0)
	await page.getByRole("link", { name: "Notebook" }).click()
	await expect(page).toHaveURL(/\/notebook$/)
	for (const typed of ["notebook", "highlights"]) {
		await page.goto("/library")
		await waitForHydration(page)
		await page.keyboard.press("ControlOrMeta+k")
		await page.keyboard.type(typed)
		await page
			.getByRole("dialog", { name: "Command palette" })
			.getByRole("option", { name: "Notebook", exact: true })
			.click()
		await expect(page).toHaveURL(/\/notebook$/)
	}
})

test("notebook: by topic, a tag, notes written on the card, delete and Shuffle", async ({
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
	await page.goto("/notebook?view=topics")
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
	// Its × goes back to the view remembered: See all was a look at one topic, not a choice.
	await page.getByTestId("topic-chip").click()
	await expect(page).toHaveURL(/view=topics/)
	await expect(cards).toHaveCount(8)
	await page.getByRole("link", { name: "Stream" }).click()
	await expect(cards).toHaveCount(10)

	// The tag menu offers the tags whose articles have highlights or notes.
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
	// The card shows the note before the server has it: reload only once it is saved.
	await Promise.all([
		highlightSaved(page, kept),
		editor.getByRole("button", { name: "Save" }).click(),
	])
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
						.where(and(eq(highlights.userId, userId), eq(highlights.exact, "Kept quote")))
				)[0]?.note,
		)
		.toBe("Worth a third look.")
	// Emptied, the note comes off the card.
	await note.click()
	await editor.getByRole("textbox").press("ControlOrMeta+a")
	await editor.getByRole("textbox").press("Backspace")
	await Promise.all([
		highlightSaved(page, kept),
		editor.getByRole("button", { name: "Save" }).click(),
	])
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

	// An article note is a card of its own in every view but by article: by topic, and dealt.
	// Keepsake is in a second topic too: its note shows under both, written on in the first only.
	const [keeping] = await db
		.insert(topics)
		.values({ userId, name: "Keeping", description: "Kept.", status: "active", origin: "first" })
		.returning({ id: topics.id })
	await db
		.insert(documentTopics)
		.values({ documentId: kept, topicId: keeping!.id, probability: 0.9, level: "applied" })
	await writeNote(page, kept, "Keep this one close.")
	await page.goto("/notebook?view=topics")
	await expect(craftGroup).toContainText("8 highlights · 1 note")
	await expect(craftGroup.getByTestId("note-card").first()).toContainText("Keep this one close.")
	await expect(craftGroup.getByRole("link", { name: "See all 9" })).toBeVisible()
	await expect(craftGroup.getByLabel("Note on Keepsake")).toBeVisible()
	const keepingGroup = page.getByRole("region", { name: "Keeping" })
	await expect(keepingGroup.getByTestId("note-read-only")).toHaveText("Keep this one close.")
	await expect(keepingGroup.getByLabel("Note on Keepsake")).toHaveCount(0)
	await shot(page, "notebook-topics")
	await page.goto("/notebook?shuffle=new")
	await expect(page.getByTestId("note-card")).toHaveCount(1)
	await expect(cards).toHaveCount(10)
})

test("a Spanish reader's empty notebook, on a phone", async ({ browser }) => {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
	const page = await context.newPage()
	const email = await signupUser(page, "Cuaderno")
	await db.update(user).set({ locale: "es" }).where(eq(user.email, email))
	await page.goto("/notebook")
	await expect(page.getByRole("heading", { name: "Tu cuaderno está vacío" })).toBeVisible()
	await expect(page.getByRole("link", { name: "Abrir tu biblioteca" })).toBeVisible()
	await shot(page, "notebook-empty-es")
	await context.close()
})
