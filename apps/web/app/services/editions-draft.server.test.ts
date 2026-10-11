import { db, documents, editions, eq, inArray, sql, user as userTable } from "@klipstack/db"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { createEdition, startEdition } from "~/commands/editions.server"
import {
	addItem,
	currentDraft,
	editionNudge,
	publishEdition,
	removeItem,
	snoozeNudge,
} from "./editions.server"

/** The draft in progress, and what the nudge makes of it. */

const userId = `test-editions-draft-${Date.now()}`
const DAY = 86_400_000
const input = { locale: "en", timeZone: "Europe/Madrid" }

async function addMarked(n: number) {
	const rows = await db
		.insert(documents)
		.values(
			Array.from({ length: n }, (_, i) => ({
				userId,
				sourceUrl: `https://draft.example/${i}/${Math.random()}`,
				urlHash: `${userId}-${i}-${Math.random()}`,
				title: `Marked ${i}`,
				status: "ready" as const,
				shortlistedAt: new Date(),
			})),
		)
		.returning({ id: documents.id })
	return rows.map((r) => r.id)
}

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Drafter", email: `${userId}@x.test` })
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId]))
})

describe("the draft in progress", () => {
	afterEach(async () => {
		await db.delete(editions).where(eq(editions.userId, userId))
		await db.delete(documents).where(eq(documents.userId, userId))
		await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
	})

	it("is started once, however many Starts arrive together", async () => {
		// Connections open first: a new one is slow enough to hide the race.
		await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_sleep(0.01)`)))
		const started = await Promise.all(Array.from({ length: 4 }, () => startEdition(userId, input)))
		expect(new Set(started.map((edition) => edition.id)).size).toBe(1)
		expect(await db.select().from(editions).where(eq(editions.userId, userId))).toHaveLength(1)
	})

	it("is none until one is started, then the one edited last; a published one is not", async () => {
		expect(await currentDraft(db, userId)).toBeNull()
		const older = await createEdition(userId, input)
		const newer = await createEdition(userId, input)
		expect((await currentDraft(db, userId))?.id).toBe(newer.id)
		await db
			.update(editions)
			.set({ updatedAt: new Date(Date.now() + 1000) })
			.where(eq(editions.id, older.id))
		expect((await currentDraft(db, userId))?.id).toBe(older.id)
	})

	it("stops the nudge for a new edition, and nudges to publish it a week after it was started", async () => {
		await addMarked(3)
		// Three marked: an edition by themselves, before any was published. "Not now" quiets it for
		// a week.
		expect(await editionNudge(userId)).toMatchObject({
			marked: 3,
			daysSince: null,
			reason: "marked",
		})
		await snoozeNudge(userId)
		expect((await editionNudge(userId)).reason).toBeNull()
		expect((await editionNudge(userId, new Date(Date.now() + 8 * DAY))).reason).toBe("marked")
		await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
		const draft = await createEdition(userId, input)
		expect(await editionNudge(userId)).toMatchObject({
			reason: null,
			draft: { days: 0, items: 3 },
		})
		// A minute past: the database's clock may run a few milliseconds ahead of this one.
		const sixDays = new Date(Date.now() + 6 * DAY + 60_000)
		const week = new Date(Date.now() + 7 * DAY + 60_000)
		expect((await editionNudge(userId, sixDays)).reason).toBeNull()
		expect(await editionNudge(userId, week)).toMatchObject({
			reason: "draft",
			draft: { days: 7, items: 3 },
		})
		// "Not now" quiets this one too, for a week.
		await db
			.update(editions)
			.set({ createdAt: new Date(Date.now() - 8 * DAY) })
			.where(eq(editions.id, draft.id))
		expect((await editionNudge(userId)).reason).toBe("draft")
		await snoozeNudge(userId)
		expect((await editionNudge(userId)).reason).toBeNull()
		expect((await editionNudge(userId, week)).reason).toBe("draft")
		await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
		// Published, it is no longer the draft: nothing is due.
		expect((await publishEdition(userId, draft.id)).ok).toBe(true)
		expect(await editionNudge(userId, week)).toMatchObject({ reason: null, draft: null })
	})

	it("marks an article added from the picker to a draft: it is in the next edition", async () => {
		const [picked, other] = await addMarked(2)
		await db
			.update(documents)
			.set({ shortlistedAt: null })
			.where(inArray(documents.id, [picked!, other!]))
		const marked = async (id: string) =>
			(
				await db.select({ at: documents.shortlistedAt }).from(documents).where(eq(documents.id, id))
			)[0]!.at
		const published = await createEdition(userId, input)
		await addItem(userId, published.id, other!)
		expect((await publishEdition(userId, published.id)).ok).toBe(true)
		const draft = await createEdition(userId, input)
		const item = await addItem(userId, draft.id, picked!)
		expect(await marked(picked!)).not.toBeNull()
		// Removing it takes the mark off again, as it does for a marked one.
		await removeItem(userId, draft.id, item.id)
		expect(await marked(picked!)).toBeNull()
		// A published edition's working copy is not the next edition.
		await addItem(userId, published.id, picked!)
		expect(await marked(picked!)).toBeNull()
	})
})
