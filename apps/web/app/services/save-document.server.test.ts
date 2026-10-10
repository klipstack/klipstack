import { db, documentRaw, documents, eq, inArray, sql, user as userTable } from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { saveDocument } from "./documents.server"

const userId = `test-save-${Date.now()}`

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Saver", email: `${userId}@example.com` })
})

afterAll(async () => {
	// Saving admits a real extraction job (in its transaction, so no mock stands in). No worker runs
	// here: left behind, the jobs would keep the next one that starts busy, and its tests waiting.
	await db.execute(
		sql`delete from pgboss.job where data->>'documentId' in (select id::text from documents where user_id = ${userId})`,
	)
	await db.delete(userTable).where(eq(userTable.id, userId))
	await stopBoss()
})

describe("saveDocument", () => {
	it("keeps the address as saved for fetching, and its normal form for finding it again", async () => {
		const url = `https://example.com/guide-${Date.now()}/?s=term&utm_source=x#part`
		const { document } = await saveDocument({ userId, url, html: "<p>x</p>", source: "api" })
		expect(document.fetchUrl).toBe(url.replace("#part", ""))
		expect(document.sourceUrl).not.toContain("?s=")
		const [raw] = await db
			.select({ finalUrl: documentRaw.finalUrl })
			.from(documentRaw)
			.where(eq(documentRaw.documentId, document.id))
		// A capture's relative links resolve against the page's real address.
		expect(raw?.finalUrl).toBe(url.replace("#part", ""))
		await db.delete(documents).where(eq(documents.id, document.id))
	})

	it("saves a URL sent many times at once as one article", async () => {
		const html = "<html><body><p>captured</p></body></html>"
		// A few bursts: the race does not show on every one.
		for (let round = 0; round < 4; round++) {
			const url = `https://example.com/race-${Date.now()}-${round}`
			const results = await Promise.all(
				Array.from({ length: 8 }, (_, i) =>
					saveDocument({ userId, url, html: i === 7 ? html : null, source: "api" }),
				),
			)
			expect(results.filter((r) => r.created)).toHaveLength(1)
			const ids = [...new Set(results.map((r) => r.document.id))]
			expect(ids).toHaveLength(1)
			// The capture sent with one of them is kept, whichever request inserted the row.
			const raw = await db
				.select({ id: documentRaw.id })
				.from(documentRaw)
				.where(inArray(documentRaw.documentId, ids))
			expect(raw).toHaveLength(1)
		}
		const rows = await db.select().from(documents).where(eq(documents.userId, userId))
		expect(rows).toHaveLength(4)
	})
})
