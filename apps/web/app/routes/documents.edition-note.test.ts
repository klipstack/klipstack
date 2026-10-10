import { randomUUID } from "node:crypto"
import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { action } from "./documents.edition-note"

// The route over the real command and database; only the session stands in.
const owner = `test-edition-note-route-${randomUUID()}`
const other = `${owner}-other`
let signedIn = owner
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: signedIn }) }))

let documentId: string

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: owner, name: "Owner", email: `${owner}@example.com` },
		{ id: other, name: "Other", email: `${other}@example.com` },
	])
	const [doc] = await db
		.insert(documents)
		.values({ userId: owner, sourceUrl: "https://example.com/n", urlHash: owner, status: "ready" })
		.returning({ id: documents.id })
	documentId = doc!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, owner))
	await db.delete(userTable).where(eq(userTable.id, other))
})

const post = (body: BodyInit, type: string) =>
	action({
		request: new Request(`https://example.com/documents/${documentId}/edition-note`, {
			method: "POST",
			headers: { "Content-Type": type },
			body,
		}),
		params: { id: documentId },
		context: {},
	} as Parameters<typeof action>[0])

const stored = async () =>
	(await db.query.documents.findFirst({ where: eq(documents.id, documentId) }))!.editionNote

describe("POST /documents/:id/edition-note", () => {
	it("saves JSON and form bodies, and clears with blank", async () => {
		expect(await post(JSON.stringify({ note: " Why. " }), "application/json")).toEqual({
			ok: true,
			editionNote: "Why.",
		})
		expect(await stored()).toBe("Why.")
		await post(new URLSearchParams({ note: "From a form." }), "application/x-www-form-urlencoded")
		expect(await stored()).toBe("From a form.")
		await post(JSON.stringify({ note: "" }), "application/json")
		expect(await stored()).toBeNull()
	})

	it("refuses a body without a note, malformed JSON, and another user's article", async () => {
		await post(JSON.stringify({ note: "Kept." }), "application/json")
		for (const body of [JSON.stringify({}), "{"])
			expect(await post(body, "application/json")).toMatchObject({ init: { status: 400 } })
		signedIn = other
		expect(await post(JSON.stringify({ note: "Mine?" }), "application/json")).toMatchObject({
			init: { status: 404 },
		})
		signedIn = owner
		expect(await stored()).toBe("Kept.")
	})
})
