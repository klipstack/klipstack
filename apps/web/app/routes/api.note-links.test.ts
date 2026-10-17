import { db, documents, eq, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { getUser } from "~/lib/session.server"
import { loader } from "./api.note-links"

vi.mock("~/lib/session.server", () => ({ getUser: vi.fn() }))

const userId = `test-note-links-${Date.now()}`
const otherUserId = `${userId}-other`
let mine: string
let trashed: string
let foreign: string

async function addDocument(uid: string, name: string, deleted = false): Promise<string> {
	const [d] = await db
		.insert(documents)
		.values({
			userId: uid,
			sourceUrl: `https://example.com/${name}`,
			urlHash: `${uid}-${name}`,
			title: name,
			status: "ready",
			deletedAt: deleted ? new Date() : null,
		})
		.returning({ id: documents.id })
	return d!.id
}

function load(ids: string[]) {
	const query = new URLSearchParams(ids.map((id) => ["id", id]))
	return loader({ request: new Request(`http://localhost/api/note-links?${query}`) } as never)
}

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Links", email: `${userId}@example.com` },
		{ id: otherUserId, name: "Other", email: `${otherUserId}@example.com` },
	])
	mine = await addDocument(userId, "mine")
	trashed = await addDocument(userId, "trashed", true)
	foreign = await addDocument(otherUserId, "foreign")
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	await db.delete(userTable).where(eq(userTable.id, otherUserId))
})

beforeEach(() => {
	vi.mocked(getUser).mockReturnValue({ id: userId } as never)
})

it("gives the original address of the reader's own linked articles, and nobody else's", async () => {
	expect(await load([mine, trashed, foreign, "not-an-id"])).toEqual({
		urls: { [mine]: "https://example.com/mine", [trashed]: "https://example.com/trashed" },
	})
})

it("requires a browser session", async () => {
	vi.mocked(getUser).mockReturnValue(null)
	expect(await load([mine])).toMatchObject({ init: { status: 401 } })
})

it("refuses more ids than a note can hold links", async () => {
	expect(await load(Array.from({ length: 500 }, () => mine))).toEqual({
		urls: { [mine]: "https://example.com/mine" },
	})
	expect(await load(Array.from({ length: 501 }, () => mine))).toMatchObject({
		init: { status: 400 },
	})
})
