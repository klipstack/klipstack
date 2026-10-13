import { randomUUID } from "node:crypto"
import { db, documents, eq, sql, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { NOTEBOOK_PAGE_SIZE } from "~/services/notebook.server"
import { loader } from "./notebook"

// The loader over the real database; only the session stands in.
const owner = `test-notebook-route-${randomUUID()}`
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: owner }) }))
vi.mock("~/lib/i18n.server", () => ({ getLocale: () => "en" }))

const COUNT = NOTEBOOK_PAGE_SIZE + 5

beforeAll(async () => {
	await db.insert(userTable).values({ id: owner, name: "Owner", email: `${owner}@example.com` })
	// One note a minute apart, the newest last: note 0 is the oldest.
	await db.insert(documents).values(
		Array.from({ length: COUNT }, (_, i) => ({
			userId: owner,
			sourceUrl: `https://example.com/${owner}/${i}`,
			urlHash: `${owner}-${i}`,
			status: "ready" as const,
			title: `Note ${i}`,
			note: `Thought ${i}`,
			noteUpdatedAt: sql`now() - make_interval(mins => ${COUNT - i})`,
		})),
	)
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, owner))
})

const load = (query = "") =>
	loader({
		request: new Request(`https://example.com/notebook${query}`),
		params: {},
		context: {},
	} as never) as Promise<{
		items: Array<{ title: string; noteUpdatedAt: string | null; edited: string | null }>
		nextCursor: string | null
		anyNote: boolean
	}>

describe("GET /notebook", () => {
	it("pages through every note with the cursor it writes, newest first", async () => {
		const first = await load()
		expect(first.anyNote).toBe(true)
		expect(first.items).toHaveLength(NOTEBOOK_PAGE_SIZE)
		expect(first.items[0]!.title).toBe(`Note ${COUNT - 1}`)
		expect(first.items[0]!.edited).toBeTruthy()
		expect(first.nextCursor).toBeTruthy()
		const second = await load(`?cursor=${first.nextCursor}`)
		expect(second.items.map((n) => n.title)).toEqual([4, 3, 2, 1, 0].map((i) => `Note ${i}`))
		expect(second.nextCursor).toBeNull()
	})

	it("shows the first page for a cursor it did not write, and for a tag of NULs", async () => {
		expect((await load("?cursor=bogus")).items).toHaveLength(NOTEBOOK_PAGE_SIZE)
		// Postgres text cannot hold one: sent on, it would fail the query.
		expect((await load("?tag=%00")).items).toHaveLength(NOTEBOOK_PAGE_SIZE)
	})
})
