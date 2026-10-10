import { randomUUID } from "node:crypto"
import { db, documents, documentVersions, eq, highlights, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { action } from "./documents.highlights"

// The route over the real services and database; only the session stands in.
const owner = `test-hl-route-${randomUUID()}`
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: owner }) }))

let documentId: string
let highlightId: string

beforeAll(async () => {
	await db.insert(userTable).values({ id: owner, name: "HL", email: `${owner}@example.com` })
	const text = "Alpha bravo charlie delta."
	const [doc] = await db
		.insert(documents)
		.values({ userId: owner, sourceUrl: "https://example.com/hl", urlHash: owner, status: "ready" })
		.returning({ id: documents.id })
	documentId = doc!.id
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId,
			version: 1,
			html: `<p>${text}</p>`,
			text,
			textHash: "hl",
			extractor: "test",
			extractorVersion: "1",
		})
		.returning({ id: documentVersions.id })
	await db
		.update(documents)
		.set({ currentVersionId: version!.id })
		.where(eq(documents.id, documentId))
	const [highlight] = await db
		.insert(highlights)
		.values({
			userId: owner,
			documentId,
			versionId: version!.id,
			startOffset: 6,
			endOffset: 19,
			exact: "bravo charlie",
			note: "Keep me.",
		})
		.returning({ id: highlights.id })
	highlightId = highlight!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, owner))
})

const post = (body: unknown) =>
	action({
		request: new Request(`https://example.com/documents/${documentId}/highlights`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		params: { id: documentId },
		context: {},
	} as Parameters<typeof action>[0])

const stored = async () =>
	(await db.query.highlights.findFirst({ where: eq(highlights.id, highlightId) }))!

describe("POST /documents/:id/highlights", () => {
	it("changes a color without touching the note, and a note without touching the color", async () => {
		await post({ intent: "update", id: highlightId, color: 3 })
		expect(await stored()).toMatchObject({ color: 3, note: "Keep me." })
		await post({ intent: "update", id: highlightId, note: null })
		expect(await stored()).toMatchObject({ color: 3, note: null })
	})

	it("refuses a malformed resize before touching anything", async () => {
		const before = await stored()
		const result = await post({
			intent: "resize",
			id: highlightId,
			versionId: randomUUID(),
			previous: { start: "6", end: 19, exact: "bravo charlie" },
			selector: {},
		})
		expect(result).toMatchObject({ init: { status: 400 } })
		expect(await stored()).toEqual(before)
	})
})
