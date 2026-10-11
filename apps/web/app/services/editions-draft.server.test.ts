import { db, documents, editions, eq, inArray, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createEdition } from "~/commands/editions.server"
import { currentDraft, editionNudge, publishEdition, snoozeNudge } from "./editions.server"

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
		await db.delete(editions).where(eq(editions.userId, userId))
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
		// "Not now" quiets this one too.
		await snoozeNudge(userId)
		expect((await editionNudge(userId, sixDays)).reason).toBeNull()
		await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, userId))
		// Published, it is no longer the draft: nothing is due.
		expect((await publishEdition(userId, draft.id)).ok).toBe(true)
		expect(await editionNudge(userId, week)).toMatchObject({ reason: null, draft: null })
	})
})
