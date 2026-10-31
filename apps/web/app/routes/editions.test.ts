import { db, documents, eq, inArray, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
	deleteEdition,
	publishEdition,
	unpublishEdition,
	addItem,
	createEmptyEdition as createEdition,
} from "~/commands/editions.server"
import { getEdition, listEditions, listShortlist } from "~/services/editions.server"
import { action as createAction, loader as listLoader } from "./editions"
import { action as editAction, loader as editLoader } from "./editions.edit"
import { loader as articleLoader } from "./editions.item-article"
import { loader as previewLoader } from "./editions.preview"
import { action as saveAction } from "./editions.save"

const session = vi.hoisted(() => ({ user: { id: "", name: "", locale: "en" } }))
vi.mock("~/lib/session.server", () => ({ requireUser: () => session.user }))
vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})

const ownerId = `test-editions-routes-${Date.now()}`
const otherId = `${ownerId}-other`
const owner = { id: ownerId, name: "Ada Reader", locale: "en" }
const other = { id: otherId, name: "Other", locale: "es" }
let documentId: string

const as = (user: typeof owner) => {
	session.user = user
}

/** What a loader or action throws, as a status and a redirect target. */
async function thrown(promise: Promise<unknown>) {
	const error: unknown = await promise.then(
		() => null,
		(e: unknown) => e,
	)
	if (error instanceof Response)
		return { status: error.status, location: error.headers.get("Location") }
	return { status: (error as { init?: { status?: number } } | null)?.init?.status }
}

function create() {
	return createAction({
		request: new Request("http://localhost/editions", {
			method: "POST",
			body: new URLSearchParams(),
			headers: { cookie: "klip_tz=Europe%2FMadrid" },
		}),
		context: {},
		params: {},
	} as never)
}

/** Posts an intent as the editor does: JSON to the page, or to the autosave route. */
function post(id: string, body: Record<string, unknown>, route: "page" | "save" = "page") {
	const run = route === "page" ? editAction : saveAction
	return run({
		request: new Request(`http://localhost/editions/${id}`, {
			method: "POST",
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
		}),
		context: {},
		params: { id },
	} as never) as Promise<{ data: unknown; init: { status?: number } | null }>
}

const load = (id: string) =>
	editLoader({ request: new Request("http://localhost"), context: {}, params: { id } } as never)
const preview = (id: string) =>
	previewLoader({ request: new Request("http://localhost"), context: {}, params: { id } } as never)

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: ownerId, name: owner.name, email: `${ownerId}@x.test`, prefs: { editions: "on" } },
		{
			id: otherId,
			name: other.name,
			email: `${otherId}@x.test`,
			locale: "es",
			prefs: { editions: "on" },
		},
	])
	const [doc] = await db
		.insert(documents)
		.values({
			userId: ownerId,
			sourceUrl: "https://a.example/one",
			urlHash: ownerId,
			title: "One",
			status: "ready",
		})
		.returning({ id: documents.id })
	documentId = doc!.id
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [ownerId, otherId]))
})

describe("editions turned off", () => {
	it("refuse Start, hide the editor, refuse its actions; turned on, the same account makes one", async () => {
		const offId = `${ownerId}-off`
		await db.insert(userTable).values({ id: offId, name: "Off", email: `${offId}@x.test` })
		try {
			as(owner)
			await thrown(create())
			const [edition] = await listEditions(ownerId)
			// The owner turns them off: nothing is deleted, and nothing of them answers.
			await db.update(userTable).set({ prefs: {} }).where(eq(userTable.id, ownerId))
			expect((await thrown(load(edition!.id))).status).toBe(404)
			expect((await thrown(preview(edition!.id))).status).toBe(404)
			const change = await post(edition!.id, { intent: "add-item", documentId })
			expect([
				change.init?.status,
				(change.data as { error: { code: string } }).error.code,
			]).toEqual([403, "forbidden"])
			expect((await post(edition!.id, { intent: "delete" }, "save")).init?.status).toBe(403)
			expect((await getEdition(ownerId, edition!.id)).edition.id).toBe(edition!.id)

			// A new account starts with them off: Start is refused, then works once turned on.
			as({ id: offId, name: "Off", locale: "en" })
			const refused = (await create()) as { data: { ok: boolean; error: { code: string } } }
			expect(refused.data).toMatchObject({ ok: false, error: { code: "forbidden" } })
			expect(await listEditions(offId)).toEqual([])
			await db
				.update(userTable)
				.set({ prefs: { editions: "on" } })
				.where(eq(userTable.id, offId))
			expect((await thrown(create())).status).toBe(302)
			expect(await listEditions(offId)).toHaveLength(1)
		} finally {
			await db
				.update(userTable)
				.set({ prefs: { editions: "on" } })
				.where(eq(userTable.id, ownerId))
			await db.delete(userTable).where(inArray(userTable.id, [offId]))
		}
	})
})

describe("POST /editions", () => {
	it("creates an untitled draft in the reader's language and time zone", async () => {
		as(owner)
		const result = await thrown(create())
		expect(result.status).toBe(302)
		const { edition, items } = await getEdition(ownerId, result.location!.split("/").pop()!)
		expect(edition).toMatchObject({ title: null, locale: "en", timeZone: "Europe/Madrid" })
		expect(items).toEqual([])
		as(other)
		const es = await thrown(create())
		expect((await getEdition(otherId, es.location!.split("/").pop()!)).edition.locale).toBe("es")
	})
})

describe("the editor", () => {
	it("adds, includes, publishes and deletes through its intents", async () => {
		as(owner)
		const [edition] = await listEditions(ownerId)
		const id = edition!.id
		expect((await post(id, { intent: "publish" })).init?.status).toBe(422)
		expect(await post(id, { intent: "add-item", documentId })).toMatchObject({ ok: true })
		expect(await post(id, { intent: "add-item", documentId })).toMatchObject({
			data: { ok: false, error: { code: "already_added" } },
			init: { status: 409 },
		})
		// Autosave goes through its own route, with the same intents.
		expect(await post(id, { intent: "update", intro: "Hello." }, "save")).toMatchObject({
			ok: true,
		})
		expect((await post(id, { intent: "update", locale: "fr" })).init?.status).toBe(400)
		expect((await post(id, { intent: "update", cover: "poster" })).init?.status).toBe(400)
		expect(await post(id, { intent: "update", cover: "shelf" })).toMatchObject({ ok: true })
		expect((await load(id)).edition.cover).toBe("shelf")
		expect(await post(id, { intent: "publish" })).toEqual({ ok: true })
		const data = await load(id)
		expect(data).toMatchObject({ state: "live", changes: false })
		// No title: the date of the first publish is the title, and the address's slug.
		expect(data.publicUrl).toMatch(new RegExp(`/e/${data.edition.publicId}/\\d{4}-\\d{2}-\\d{2}$`))
		expect(data.publishedOn).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
		expect(data.items.map((item) => item.url)).toEqual(["https://a.example/one"])
		expect((await preview(id)).view).toMatchObject({
			title: data.publishedOn,
			date: null,
			intro: "Hello.",
		})
		await post(id, { intent: "update", title: "  Good   reads " })
		expect(await post(id, { intent: "publish" })).toEqual({ ok: true })
		const titled = await load(id)
		expect(titled.publicUrl).toMatch(/\/good-reads$/)
		expect(titled.view).toMatchObject({ title: "Good reads", date: data.publishedOn })
		await post(id, { intent: "update", title: "" })
		expect((await load(id)).edition.title).toBeNull()
		expect(await thrown(post(id, { intent: "delete" }))).toEqual({
			status: 302,
			location: "/editions",
		})
		expect((await thrown(load(id))).status).toBe(404)
	})

	it("is not found for another user, its preview and its actions too", async () => {
		as(owner)
		await thrown(create())
		const [edition] = await listEditions(ownerId)
		as(other)
		expect((await thrown(load(edition!.id))).status).toBe(404)
		expect((await thrown(preview(edition!.id))).status).toBe(404)
		expect((await post(edition!.id, { intent: "add-item", documentId })).init?.status).toBe(404)
		expect((await post(edition!.id, { intent: "delete" }, "save")).init?.status).toBe(404)
		expect((await thrown(load("not-a-uuid"))).status).toBe(404)
		as(owner)
		expect((await getEdition(ownerId, edition!.id)).items).toEqual([])
	})

	it("reads an item's article for its owner only", async () => {
		as(owner)
		const id = (await thrown(create())).location!.split("/").pop()!
		await post(id, { intent: "add-item", documentId })
		const [item] = (await getEdition(ownerId, id)).items
		const read = (itemId: string) =>
			articleLoader({
				request: new Request("http://localhost"),
				context: {},
				params: { id, itemId },
			} as never) as Promise<{ ok?: boolean; article?: unknown; init?: { status?: number } }>
		expect(await read(item!.id)).toMatchObject({
			ok: true,
			// Not extracted yet: nothing to read, but the article is there.
			article: { documentId, title: "One", html: null, highlights: [] },
		})
		expect((await read("not-a-uuid")).init?.status).toBe(404)
		as(other)
		expect((await read(item!.id)).init?.status).toBe(404)
	})

	it("starts with the shortlist, shows the draft instead of it, and opens it again on Start", async () => {
		as(owner)
		const page = () =>
			listLoader({
				request: new Request("http://localhost/editions"),
				context: {},
				params: {},
			} as never)
		// No draft in progress: the page offers the marked articles.
		for (const edition of await listEditions(ownerId))
			if (!edition.publishedAt) await post(edition.id, { intent: "delete" }).catch(() => null)
		const marked = new Date("2026-09-03T10:00:00Z")
		await db.update(documents).set({ shortlistedAt: marked }).where(eq(documents.id, documentId))
		expect(await page()).toMatchObject({ desk: null, shortlist: [{ id: documentId }] })
		const id = (await thrown(create())).location!.split("/").pop()!
		try {
			// Started: the draft takes the shortlist's place, and Start opens it again.
			expect(await page()).toMatchObject({
				desk: { id, title: null, itemCount: 1, items: [{ title: "One" }], problems: 0 },
				shortlist: [],
				otherDrafts: [],
			})
			expect((await thrown(create())).location).toBe(`/editions/${id}`)
			const { items } = await getEdition(ownerId, id)
			// Set aside, it is not one of the draft's articles, and nothing is left to publish.
			await post(id, { intent: "update-item", itemId: items[0]!.id, included: false })
			expect(await page()).toMatchObject({ desk: { itemCount: 0, items: [], problems: 1 } })
			await post(id, { intent: "update-item", itemId: items[0]!.id, included: true })
			expect(items.map((item) => item.documentId)).toEqual([documentId])
			const removed = (await post(id, {
				intent: "remove-item",
				itemId: items[0]!.id,
			})) as unknown as {
				ok: true
				undo: string
				unmarked: boolean
			}
			expect(removed).toMatchObject({ ok: true, unmarked: true })
			expect(await listShortlist(ownerId)).toEqual([])
			// Only the signed undo, and only its user's.
			expect((await post(id, { intent: "restore-item", token: "forged" })).init?.status).toBe(400)
			as(other)
			expect((await post(id, { intent: "restore-item", token: removed.undo })).init?.status).toBe(
				400,
			)
			as(owner)
			expect(await post(id, { intent: "restore-item", token: removed.undo })).toEqual({ ok: true })
			expect((await getEdition(ownerId, id)).items).toEqual(items)
			expect((await listShortlist(ownerId)).map((entry) => entry.id)).toEqual([documentId])
		} finally {
			await post(id, { intent: "delete" }).catch(() => null)
			await db.update(documents).set({ shortlistedAt: null }).where(eq(documents.id, documentId))
		}
	})

	it("lists the other drafts, and past editions by year, with a link only while public", async () => {
		as(owner)
		const input = { locale: "en", timeZone: "Europe/Madrid" }
		const made: string[] = []
		try {
			const publish = async () => {
				const edition = await createEdition(ownerId, input)
				made.push(edition.id)
				await addItem(ownerId, edition.id, documentId)
				expect((await publishEdition(ownerId, edition.id)).ok).toBe(true)
				return edition.id
			}
			const live = await publish()
			const hidden = await publish()
			await unpublishEdition(ownerId, hidden)
			const older = await createEdition(ownerId, input)
			const newer = await createEdition(ownerId, input)
			made.push(older.id, newer.id)
			const data = await listLoader({
				request: new Request("http://localhost/editions"),
				context: {},
				params: {},
			} as never)
			expect(data.desk?.id).toBe(newer.id)
			expect(data.otherDrafts.map((draft) => draft.id)).toContain(older.id)
			const past = (id: string) => data.past.find((edition) => edition.id === id)
			expect(past(live)).toMatchObject({
				state: "live",
				year: expect.stringMatching(/^\d{4}$/),
				publicUrl: expect.stringMatching(/\/e\/[0-9A-Za-z]+\//),
			})
			expect(past(hidden)).toMatchObject({ state: "unpublished", publicUrl: null })
		} finally {
			for (const id of made) await deleteEdition(ownerId, id)
		}
	})

	it("refuses a body that is not an intent", async () => {
		as(owner)
		const id = (await thrown(create())).location!.split("/").pop()!
		expect((await post(id, { intent: "explode" })).init?.status).toBe(400)
	})
})
