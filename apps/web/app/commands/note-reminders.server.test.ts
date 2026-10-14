import {
	db,
	documents,
	documentVersions,
	eq,
	highlights,
	readingCompletions,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { NOTE_REMINDERS } from "~/lib/note-reminders"
import { listNoteReminders } from "~/services/note-reminders.server"
import { trashArticle, updateArticle, updateArticles } from "./articles.server"
import { skipArticleNote, snoozeNoteReminderCard } from "./note-reminders.server"

const userId = `test-note-reminders-${Date.now()}`
const otherId = `${userId}-other`
const HOUR = 3_600_000
const DAY = 24 * HOUR

async function article(owner = userId, values: Partial<typeof documents.$inferInsert> = {}) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId: owner,
			title: "An article",
			sourceUrl: `https://example.com/${Math.random()}`,
			urlHash: `${owner}-${Math.random()}`,
			status: "ready",
			firstOpenedAt: new Date(Date.now() - 30 * DAY),
			...values,
		})
		.returning({ id: documents.id })
	return doc!.id
}

/** A completion of the article's current cycle, `ago` milliseconds back. */
async function finished(
	id: string,
	ago: number,
	source: "manual" | "progress" | "listened" | "bulk" = "progress",
	owner = userId,
) {
	await db.insert(readingCompletions).values({
		userId: owner,
		documentId: id,
		cycle: 0,
		completedAt: new Date(Date.now() - ago),
		source,
	})
}

const ids = async () => (await listNoteReminders(userId, { limit: 50 })).items.map((i) => i.id)

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Reader", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
})

beforeEach(async () => {
	await db.delete(documents).where(eq(documents.userId, userId))
	await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherId))
})

describe("articles finished without a note", () => {
	it("asks about one listened to at once, and about one read only after a while", async () => {
		const listened = await article()
		await finished(listened, 2 * 60_000, "listened")
		const read = await article()
		await finished(read, 60_000)
		expect(await listNoteReminders(userId)).toMatchObject({
			items: [{ id: listened, listened: true }],
			total: 1,
			suggested: true,
		})
		const later = new Date(Date.now() + NOTE_REMINDERS.graceMinutes * 60_000 + 1000)
		const { items } = await listNoteReminders(userId, { now: later })
		expect(items.map((i) => [i.id, i.listened])).toEqual([
			[read, false],
			[listened, true],
		])
	})

	it("suggests from two read, not one", async () => {
		const a = await article()
		await finished(a, 2 * HOUR)
		expect((await listNoteReminders(userId)).suggested).toBe(false)
		const b = await article()
		await finished(b, 3 * HOUR, "manual")
		expect(await listNoteReminders(userId)).toMatchObject({
			items: [{ id: a }, { id: b }],
			total: 2,
			suggested: true,
		})
	})

	it("leaves out tidying up: bulk finishes and one finished from a list unopened", async () => {
		const [opened, unopened, bulkA, bulkB] = [
			await article(),
			await article(userId, { firstOpenedAt: null }),
			await article(),
			await article(),
		]
		await updateArticle(userId, opened, { finished: true })
		await updateArticle(userId, unopened, { finished: true })
		await updateArticles(userId, { ids: [bulkA, bulkB], finished: true })
		const later = new Date(Date.now() + HOUR)
		expect(
			(await listNoteReminders(userId, { now: later, limit: 50 })).items.map((i) => i.id),
		).toEqual([opened])
	})

	it("leaves out a note, an old finish, an earlier reading, the trash, another's", async () => {
		const kept = await article()
		await finished(kept, 2 * HOUR)
		const noted = await article(userId, { note: "What I take from it." })
		await finished(noted, 2 * HOUR)
		const old = await article()
		await finished(old, (NOTE_REMINDERS.withinDays + 1) * DAY)
		const rereading = await article(userId, { readingCycle: 1 })
		await finished(rereading, 2 * HOUR)
		const trashed = await article()
		await finished(trashed, 2 * HOUR)
		await trashArticle(userId, trashed)
		const theirs = await article(otherId)
		await finished(theirs, 2 * HOUR, "listened", otherId)
		expect(await ids()).toEqual([kept])
	})

	it("asks about an article with notes on its highlights only: those are about a passage", async () => {
		const a = await article()
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: a,
				version: 1,
				html: "<p>Text</p>",
				text: "Text",
				textHash: `${Math.random()}`,
				extractor: "test",
				extractorVersion: "0",
			})
			.returning({ id: documentVersions.id })
		await db.insert(highlights).values({
			userId,
			documentId: a,
			versionId: version!.id,
			startOffset: 0,
			endOffset: 4,
			exact: "Text",
			note: "About this passage.",
		})
		await finished(a, 60_000, "listened")
		expect(await ids()).toEqual([a])
	})

	it("never asks again after Nothing to add, until taken back", async () => {
		const a = await article()
		await finished(a, 2 * HOUR)
		await skipArticleNote(userId, a)
		expect(await ids()).toEqual([])
		await skipArticleNote(userId, a, false)
		expect(await ids()).toEqual([a])
	})

	it("refuses Nothing to add on an article in the trash or another's", async () => {
		const trashed = await article()
		await trashArticle(userId, trashed)
		const theirs = await article(otherId)
		for (const id of [trashed, theirs, "not-an-id"])
			await expect(skipArticleNote(userId, id)).rejects.toMatchObject({
				code: id === "not-an-id" ? "invalid_request" : "not_found",
			})
	})

	it("Not now puts the card off for a week; the articles stay listed", async () => {
		const a = await article()
		await finished(a, 60_000, "listened")
		await snoozeNoteReminderCard(userId)
		const soon = new Date(Date.now() + (NOTE_REMINDERS.snoozeDays - 1) * DAY)
		expect(await listNoteReminders(userId, { now: soon })).toMatchObject({
			items: [{ id: a }],
			suggested: false,
		})
		// A week on, it asks again, about what is still within the window.
		const b = await article()
		await finished(b, -NOTE_REMINDERS.snoozeDays * DAY, "listened")
		const weekOn = new Date(Date.now() + NOTE_REMINDERS.snoozeDays * DAY + 1000)
		expect(await listNoteReminders(userId, { now: weekOn })).toMatchObject({
			items: [{ id: b }, { id: a }],
			suggested: true,
		})
	})

	it("shows a few highlights of each, in the article's order", async () => {
		const a = await article()
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: a,
				version: 1,
				html: "<p>Text</p>",
				text: "Text",
				textHash: `${Math.random()}`,
				extractor: "test",
				extractorVersion: "0",
			})
			.returning({ id: documentVersions.id })
		for (const [start, exact] of [
			[40, "Fourth"],
			[10, "Second"],
			[0, "First"],
			[20, "Third"],
		] as const)
			await db.insert(highlights).values({
				userId,
				documentId: a,
				versionId: version!.id,
				startOffset: start,
				endOffset: start + 5,
				exact,
			})
		await finished(a, 60_000, "listened")
		const [item] = (await listNoteReminders(userId)).items
		expect(item!.highlights.map((h) => h.quote)).toEqual(["First", "Second", "Third"])
	})
})
