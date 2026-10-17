import { randomUUID } from "node:crypto"
import { db, documents, eq, inArray, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { action } from "./documents.bulk"

// The route over the real command and database; only the session stands in.
const owner = `test-bulk-route-${randomUUID()}`
const other = `test-bulk-other-${randomUUID()}`
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: owner }) }))

const ids: Record<"trashed" | "live" | "foreign", string> = { trashed: "", live: "", foreign: "" }

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: owner, name: "Owner", email: `${owner}@example.com` },
		{ id: other, name: "Other", email: `${other}@example.com` },
	])
	const row = (userId: string, name: string, deletedAt: Date | null) => ({
		userId,
		sourceUrl: `https://example.com/${name}`,
		urlHash: `${userId}-${name}`,
		status: "ready" as const,
		deletedAt,
	})
	const [trashed, live, foreign] = await db
		.insert(documents)
		.values([
			row(owner, "trashed", new Date()),
			row(owner, "live", null),
			row(other, "foreign", new Date()),
		])
		.returning({ id: documents.id })
	ids.trashed = trashed!.id
	ids.live = live!.id
	ids.foreign = foreign!.id
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [owner, other]))
})

async function post(fields: Record<string, string>) {
	return (await action({
		request: new Request("https://example.com/documents/bulk", {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
		params: {},
		context: {},
	} as Parameters<typeof action>[0])) as { ok: boolean; changed: string[]; undo: unknown }
}

describe("POST /documents/bulk, intent=purge", () => {
	it("deletes for good only the reader's own articles in the trash, with no undo", async () => {
		const done = await post({
			intent: "purge",
			ids: [ids.trashed, ids.live, ids.foreign].join(","),
		})
		expect(done).toMatchObject({ ok: true, changed: [ids.trashed], undo: null })
		const left = await db
			.select({ id: documents.id })
			.from(documents)
			.where(inArray(documents.id, [ids.trashed, ids.live, ids.foreign]))
		expect(left.map((r) => r.id).sort()).toEqual([ids.live, ids.foreign].sort())
		// The live article is untouched: still out of the trash.
		const live = await db.query.documents.findFirst({ where: eq(documents.id, ids.live) })
		expect(live?.deletedAt).toBeNull()
	})
})
