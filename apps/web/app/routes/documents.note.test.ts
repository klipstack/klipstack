import { randomUUID } from "node:crypto"
import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { action } from "./documents.note"

// The route over the real command and database; only the session stands in.
const owner = `test-note-route-${randomUUID()}`
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: owner }) }))

let documentId: string

beforeAll(async () => {
	await db.insert(userTable).values({ id: owner, name: "Owner", email: `${owner}@example.com` })
	const [doc] = await db
		.insert(documents)
		.values({ userId: owner, sourceUrl: "https://example.com/n", urlHash: owner, status: "ready" })
		.returning({ id: documents.id })
	documentId = doc!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, owner))
})

type Answer = { ok: boolean; noteUpdatedAt?: Date; error?: { code: string; details?: unknown } }

/** The action's answer, and its status: `data()` wraps a refusal, a success is the body itself. */
async function post(body: object) {
	const result = (await action({
		request: new Request(`https://example.com/documents/${documentId}/note`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		params: { id: documentId },
		context: {},
	} as Parameters<typeof action>[0])) as unknown
	if (result && typeof result === "object" && "init" in result) {
		const { data, init } = result as { data: Answer; init: { status: number } }
		return { status: init.status, body: data }
	}
	return { status: 200, body: result as Answer }
}

describe("POST /documents/:id/note", () => {
	it("writes over whatever is there without expectedUpdatedAt: the reader's autosave", async () => {
		expect((await post({ note: "One" })).body.ok).toBe(true)
		expect((await post({ note: "Two" })).body.ok).toBe(true)
	})

	it("with expectedUpdatedAt, refuses a note that changed since, and carries the current one", async () => {
		const read = await post({ note: "Read here" })
		const at = read.body.noteUpdatedAt!.toISOString()
		const elsewhere = await post({ note: "Written elsewhere", expectedUpdatedAt: at })
		expect(elsewhere.body.ok).toBe(true)
		const stale = await post({ note: "Typed here", expectedUpdatedAt: at })
		expect(stale.status).toBe(409)
		expect(stale.body.error).toMatchObject({
			code: "note_changed",
			details: { note: "Written elsewhere" },
		})
		const stored = await db.query.documents.findFirst({ where: eq(documents.id, documentId) })
		expect(stored!.note).toBe("Written elsewhere")
	})
})
