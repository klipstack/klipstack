import { randomUUID } from "node:crypto"
import {
	db,
	documents,
	documentVersions,
	eq,
	highlightResurfacing,
	highlights,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { action } from "./home.highlights"

// The route over the real command and database; only the session stands in.
const owner = `test-home-hl-route-${randomUUID()}`
vi.mock("~/lib/session.server", () => ({ requireUser: () => ({ id: owner }) }))

let highlightId: string

beforeAll(async () => {
	await db.insert(userTable).values({ id: owner, name: "HL", email: `${owner}@example.com` })
	const [doc] = await db
		.insert(documents)
		.values({ userId: owner, sourceUrl: "https://example.com/h", urlHash: owner, status: "ready" })
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html: "<p>Text</p>",
			text: "Text",
			textHash: owner,
			extractor: "test",
			extractorVersion: "1",
		})
		.returning({ id: documentVersions.id })
	const [h] = await db
		.insert(highlights)
		.values({
			userId: owner,
			documentId: doc!.id,
			versionId: version!.id,
			startOffset: 0,
			endOffset: 4,
			exact: "Text",
		})
		.returning({ id: highlights.id })
	highlightId = h!.id
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, owner))
})

const post = (fields: Record<string, string>) =>
	action({
		request: new Request("https://example.com/home/highlights", {
			method: "POST",
			body: new URLSearchParams(fields),
		}),
		params: {},
		context: {},
	} as Parameters<typeof action>[0])

const dismissedAt = async () =>
	(
		await db.query.highlightResurfacing.findFirst({
			where: eq(highlightResurfacing.highlightId, highlightId),
		})
	)?.dismissedAt ?? null

describe("POST /home/highlights", () => {
	it("dismisses and restores, and refuses an unknown intent or highlight", async () => {
		expect(await post({ intent: "dismiss", id: highlightId })).toMatchObject({
			ok: true,
			id: highlightId,
		})
		expect(await dismissedAt()).toBeInstanceOf(Date)
		expect(await post({ intent: "restore", id: highlightId })).toMatchObject({ ok: true })
		expect(await dismissedAt()).toBeNull()
		expect(await post({ intent: "delete", id: highlightId })).toMatchObject({
			data: { ok: false, error: { code: "invalid_request" } },
		})
		expect(await post({ intent: "dismiss", id: randomUUID() })).toMatchObject({
			data: { ok: false, error: { code: "not_found" } },
		})
	})
})
