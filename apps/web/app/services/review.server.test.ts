import {
	db,
	documents,
	documentTags,
	documentVersions,
	eq,
	highlights,
	inArray,
	tags,
	user,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { REVIEW } from "~/lib/review"
import { listReview, reviewSuggested, snoozeReview } from "./review.server"

const userId = `test-review-${Date.now()}`
const otherId = `${userId}-other`
const fewId = `${userId}-few`
const fiveId = `${userId}-five`
const now = new Date("2026-10-10T12:00:00Z")
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000)

type Save = Partial<typeof documents.$inferInsert> & { title: string }

async function save(owner: string, saves: Save[]) {
	return db
		.insert(documents)
		.values(
			saves.map((doc) => ({
				userId: owner,
				sourceUrl: `https://example.com/${encodeURIComponent(doc.title)}`,
				urlHash: `${owner}-${doc.title}`,
				status: "ready" as const,
				...doc,
			})),
		)
		.returning({ id: documents.id, title: documents.title })
}

const titles = (docs: { title: string | null }[]) => docs.map((d) => d.title)

beforeAll(async () => {
	await db.insert(user).values(
		[userId, otherId, fewId, fiveId].map((id) => ({
			id,
			name: "Reader",
			email: `${id}@example.com`,
		})),
	)
	const saved = await save(userId, [
		{ title: "Forty days", createdAt: daysAgo(40) },
		{ title: "Thirty-one days", createdAt: daysAgo(31) },
		{ title: "A year", createdAt: daysAgo(365) },
		{ title: "Tagged", createdAt: daysAgo(50) },
		{ title: "A post", type: "post", createdAt: daysAgo(45) },
		{ title: "Kept 91 days ago", createdAt: daysAgo(200), keptAt: daysAgo(91) },
		// Too recent, or touched: none of these is in the review.
		{ title: "Twenty-nine days", createdAt: daysAgo(29) },
		{ title: "Kept 89 days ago", createdAt: daysAgo(200), keptAt: daysAgo(89) },
		{ title: "Opened", createdAt: daysAgo(60), firstOpenedAt: daysAgo(59) },
		{ title: "Finished", createdAt: daysAgo(60), readAt: daysAgo(59) },
		{ title: "Scrolled through", createdAt: daysAgo(60), readingProgress: 0.96 },
		{ title: "Starred", createdAt: daysAgo(60), starredAt: daysAgo(59) },
		{ title: "For an edition", createdAt: daysAgo(60), shortlistedAt: daysAgo(59) },
		{ title: "With a note", createdAt: daysAgo(60), note: "Read for the chapter on tides" },
		{ title: "With an edition note", createdAt: daysAgo(60), editionNote: "Worth it" },
		{ title: "Highlighted", createdAt: daysAgo(60) },
		{ title: "Archived", createdAt: daysAgo(60), archivedAt: daysAgo(1) },
		{ title: "Trashed", createdAt: daysAgo(60), deletedAt: daysAgo(1) },
		{ title: "Failed", status: "failed", createdAt: daysAgo(60) },
		{ title: "Processing", status: "processing", createdAt: daysAgo(60) },
	])
	const id = (title: string) => saved.find((d) => d.title === title)!.id
	const highlighted = id("Highlighted")
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: highlighted,
			version: 1,
			html: "<p>Tides</p>",
			text: "Tides",
			textHash: "tides",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning({ id: documentVersions.id })
	await db.insert(highlights).values({
		documentId: highlighted,
		userId,
		versionId: version!.id,
		startOffset: 0,
		endOffset: 5,
		exact: "Tides",
	})
	const [tag] = await db.insert(tags).values({ userId, name: "someday" }).returning()
	await db.insert(documentTags).values({ documentId: id("Tagged"), tagId: tag!.id })
	await save(otherId, [{ title: "Someone else's", createdAt: daysAgo(60) }])
	// One short of enough to review, among plenty that aren't: only those in the review count.
	await save(fewId, [
		...Array.from({ length: REVIEW.minToSuggest - 1 }, (_, i) => ({
			title: `Few ${i}`,
			createdAt: daysAgo(60),
		})),
		...Array.from({ length: 3 }, (_, i) => ({
			title: `Few, starred ${i}`,
			createdAt: daysAgo(60),
			starredAt: daysAgo(59),
		})),
		...Array.from({ length: 3 }, (_, i) => ({
			title: `Few, opened ${i}`,
			createdAt: daysAgo(60),
			firstOpenedAt: daysAgo(59),
		})),
		...Array.from({ length: 3 }, (_, i) => ({ title: `Few, recent ${i}`, createdAt: daysAgo(3) })),
	])
	await save(
		fiveId,
		Array.from({ length: REVIEW.minToSuggest }, (_, i) => ({
			title: `Five ${i}`,
			createdAt: daysAgo(60),
		})),
	)
})

afterAll(async () => {
	await db.delete(user).where(inArray(user.id, [userId, otherId, fewId, fiveId]))
})

const inReview = ["A year", "Kept 91 days ago", "Tagged", "A post", "Forty days", "Thirty-one days"]

describe("the review of old saves", () => {
	it("lists the saves from more than a month ago never touched, the oldest first", async () => {
		const { items, more } = await listReview(userId, { now })
		expect(titles(items)).toEqual(inReview)
		expect(more).toBe(false)
	})

	it("lists a page at a time, and says when there are more", async () => {
		const { items, more } = await listReview(userId, { now, limit: 4 })
		expect(titles(items)).toEqual(inReview.slice(0, 4))
		expect(more).toBe(true)
	})

	it("lists only the reader's own saves", async () => {
		expect(titles((await listReview(otherId, { now })).items)).toEqual(["Someone else's"])
	})
})

describe("Home's suggestion of the review", () => {
	beforeEach(async () => {
		await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
	})

	it("comes with enough saves to review", async () => {
		expect(await reviewSuggested(userId, now)).toBe(true)
	})

	it("comes with exactly enough", async () => {
		expect(await reviewSuggested(fiveId, now)).toBe(true)
	})

	it("doesn't come for fewer, however many saves aren't in the review", async () => {
		expect(await reviewSuggested(fewId, now)).toBe(false)
	})

	it("is put off for a month, then comes back", async () => {
		await snoozeReview(userId, now)
		const putOff = new Date(now.getTime() + (REVIEW.snoozeDays - 1) * 86_400_000)
		const back = new Date(now.getTime() + (REVIEW.snoozeDays + 1) * 86_400_000)
		expect(await reviewSuggested(userId, putOff)).toBe(false)
		expect(await reviewSuggested(userId, back)).toBe(true)
	})

	it("keeps the reader's other preferences when put off", async () => {
		await db
			.update(userTable)
			.set({ prefs: { theme: "dark" } })
			.where(eq(userTable.id, userId))
		await snoozeReview(userId, now)
		const [row] = await db
			.select({ prefs: userTable.prefs })
			.from(userTable)
			.where(eq(userTable.id, userId))
		expect(row?.prefs).toMatchObject({ theme: "dark", reviewSuggestAfter: expect.any(String) })
	})
})
