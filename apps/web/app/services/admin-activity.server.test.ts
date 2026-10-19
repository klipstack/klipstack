import { randomUUID } from "node:crypto"
import {
	type Db,
	documents,
	documentVersions,
	highlights,
	readingCompletions,
	sql,
	type Tx,
} from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { ACTIVITY_DAYS } from "~/lib/admin-constants"
import { authorizeAdmin } from "~/lib/admin.server"
import { findStarterText, starterUrlHash } from "~/lib/starter-texts.server"
import { adminFixtures } from "~/test/admin-fixtures"
import { inSnapshot } from "~/test/snapshot"
import { type ActivityDay, listActivity } from "./admin-activity.server"

const fx = adminFixtures("admin-activity")
afterAll(() => fx.cleanup())

async function save(tx: Db | Tx, userId: string, createdAt: Date, urlHash: string = randomUUID()) {
	const [doc] = await tx
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://${urlHash}.example/`,
			urlHash,
			status: "ready",
			createdAt,
		})
		.returning({ id: documents.id })
	return doc!.id
}

async function highlight(tx: Db | Tx, userId: string, documentId: string, createdAt: Date) {
	const [version] = await tx
		.insert(documentVersions)
		.values({
			documentId,
			version: 1,
			html: "<p>Text</p>",
			text: "Text",
			textHash: randomUUID(),
			extractor: "test",
			extractorVersion: "0",
		})
		.returning({ id: documentVersions.id })
	await tx.insert(highlights).values({
		userId,
		documentId,
		versionId: version!.id,
		startOffset: 0,
		endOffset: 4,
		exact: "Text",
		createdAt,
	})
}

async function finish(
	tx: Db | Tx,
	userId: string,
	documentId: string,
	completedAt: Date,
	source: (typeof readingCompletions.$inferInsert)["source"],
	cycle = 1,
) {
	await tx.insert(readingCompletions).values({ userId, documentId, completedAt, source, cycle })
}

describe("listActivity", () => {
	it("counts each UTC day's saves, highlights and finished articles, and the people behind them, without admins", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		const [a, b] = await Promise.all([fx.account(), fx.account()])
		const now = new Date("2026-10-19T12:00:00Z")
		const today = new Date("2026-10-19T00:30:00Z")
		// 23:59 UTC on the 18th: the day before.
		const yesterday = new Date("2026-10-18T23:59:00Z")
		const tooOld = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000)

		const { before, after } = await inSnapshot(async (tx) => {
			// A server whose database doesn't run in UTC still counts UTC days.
			await tx.execute(sql`set local timezone = 'America/New_York'`)
			const before = await listActivity(ctx, now, tx)
			const doc = await save(tx, a.id, today)
			await save(tx, a.id, today)
			await highlight(tx, a.id, doc, today)
			await finish(tx, a.id, doc, today, "progress")
			await finish(tx, a.id, doc, today, "listened", 2)
			const other = await save(tx, b.id, yesterday)
			await finish(tx, b.id, other, yesterday, "manual")
			// The first moment of the oldest day counts; the last of the day before doesn't.
			await save(tx, b.id, new Date("2026-10-06T00:00:00Z"))
			await save(tx, b.id, new Date("2026-10-05T23:59:59Z"))
			// Not counted: finishing many at once, old read dates, a starter text, an admin's
			// activity, and anything before the period.
			const tidied = await save(tx, b.id, tooOld)
			await finish(tx, b.id, tidied, yesterday, "bulk")
			await finish(tx, b.id, tidied, yesterday, "legacy", 2)
			// A starter text counts in no column: saving, highlighting or finishing it.
			const starter = await save(
				tx,
				b.id,
				yesterday,
				starterUrlHash(findStarterText("bacon-of-studies")!),
			)
			await highlight(tx, b.id, starter, yesterday)
			await finish(tx, b.id, starter, yesterday, "progress")
			const mine = await save(tx, admin.id, today)
			await highlight(tx, admin.id, mine, today)
			await finish(tx, admin.id, mine, today, "manual")
			await highlight(tx, b.id, tidied, tooOld)
			return { before, after: await listActivity(ctx, now, tx) }
		})

		expect(after.map((day) => day.day)).toEqual(before.map((day) => day.day))
		expect(after).toHaveLength(ACTIVITY_DAYS)
		expect(after[0]!.day).toBe("2026-10-19")
		expect(after.at(-1)!.day).toBe("2026-10-06")
		const diff = (day: string) => {
			const was = before.find((row) => row.day === day)!
			const now = after.find((row) => row.day === day)!
			return Object.fromEntries(
				(["saved", "highlighted", "finished", "people"] as const).map((key) => [
					key,
					now[key] - was[key],
				]),
			) as Omit<ActivityDay, "day">
		}
		expect(diff("2026-10-19")).toEqual({ saved: 2, highlighted: 1, finished: 2, people: 1 })
		expect(diff("2026-10-18")).toEqual({ saved: 1, highlighted: 0, finished: 1, people: 1 })
		expect(diff("2026-10-06")).toEqual({ saved: 1, highlighted: 0, finished: 0, people: 1 })
		for (const row of after.slice(2, -1))
			expect(diff(row.day)).toEqual({ saved: 0, highlighted: 0, finished: 0, people: 0 })
	})
})
