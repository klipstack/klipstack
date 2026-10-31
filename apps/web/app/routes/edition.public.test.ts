import { db, documents, editions, eq, inArray, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { publishEdition, unpublishEdition, addItem } from "~/commands/editions.server"
import { env } from "~/lib/env.server"
import {
	createEdition,
	type EditionRow,
	type EditionSnapshot,
	updateEdition,
} from "~/services/editions.server"
import { loader as cardLoader } from "./edition.og"
import { headers, loader, meta } from "./edition.public"

vi.mock("~/lib/i18n.server", async () => {
	const { createInstance } = await import("i18next")
	const { resources } = await import("@klipstack/i18n")
	const i18n = createInstance()
	await i18n.init({ resources, fallbackLng: "en", interpolation: { escapeValue: false } })
	return { getInstance: () => i18n }
})

const userId = `test-edition-page-${Date.now()}`
const input = { locale: "en", timeZone: "UTC" }
let live: EditionRow
let draft: EditionRow
let documentOf: string

/** Runs the loader as the router would for this path. */
function load(path: string) {
	const [publicId, slug] = new URL(path, "http://localhost").pathname.split("/").slice(2)
	return loader({
		params: { publicId: publicId!, slug },
		request: new Request(`http://localhost${path}`),
		context: {},
	} as never)
}

/** The status of what the loader throws: a response for a redirect, data for an error. */
async function failure(path: string) {
	const thrown: unknown = await load(path).then(
		() => null,
		(error: unknown) => error,
	)
	if (thrown instanceof Response)
		return { status: thrown.status, location: thrown.headers.get("Location") }
	return { status: (thrown as { init?: { status?: number } } | null)?.init?.status }
}

beforeAll(async () => {
	await db.insert(userTable).values({ id: userId, name: "Ada Reader", email: `${userId}@x.test` })
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: "https://a.example/one",
			urlHash: userId,
			title: "One",
			leadImageUrl: "https://img.example/1.jpg",
			status: "ready",
		})
		.returning({ id: documents.id })
	documentOf = doc!.id
	live = await createEdition(userId, input)
	await updateEdition(userId, live.id, { title: "Good reads, autumn" })
	await addItem(userId, live.id, doc!.id)
	expect((await publishEdition(userId, live.id)).ok).toBe(true)
	draft = await createEdition(userId, input)
	await addItem(userId, draft.id, doc!.id)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId]))
})

describe("the public edition page", () => {
	it("renders the snapshot at its address", async () => {
		const data = await load(`/e/${live.publicId}/good-reads-autumn`)
		expect(data.url).toBe(`${env.APP_URL}/e/${live.publicId}/good-reads-autumn`)
		expect(data.view).toMatchObject({ title: "Good reads, autumn", authorName: "Ada Reader" })
		// The date of the first publish, beside the author.
		expect(data.view.date).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
		expect(data.view.items.map((i) => i.url)).toEqual(["https://a.example/one"])
		// Its own card, never an article's image: the address changes with each Update.
		expect(data.image).toMatch(
			new RegExp(`^${env.APP_URL}/e/${live.publicId}/og\\.png\\?v=[0-9a-z]+$`),
		)
		expect(data.description).toBe("1 article")
	})

	it("sends a missing or old slug to the current one, for good", async () => {
		const current = `/e/${live.publicId}/good-reads-autumn`
		expect(await failure(`/e/${live.publicId}`)).toEqual({ status: 301, location: current })
		expect(await failure(`/e/${live.publicId}/old-title?ref=x`)).toEqual({
			status: 301,
			location: `${current}?ref=x`,
		})
	})

	it("follows the published title, not the working copy's", async () => {
		await updateEdition(userId, live.id, { title: "Renamed" })
		expect((await load(`/e/${live.publicId}/good-reads-autumn`)).view.title).toBe(
			"Good reads, autumn",
		)
		await publishEdition(userId, live.id)
		expect(await failure(`/e/${live.publicId}/good-reads-autumn`)).toEqual({
			status: 301,
			location: `/e/${live.publicId}/renamed`,
		})
	})

	it("without a title, is called by its date, at an address made of its day", async () => {
		const untitled = await createEdition(userId, input)
		await addItem(userId, untitled.id, documentOf)
		const published = await publishEdition(userId, untitled.id)
		if (!published.ok) throw new Error("not published")
		const day = published.edition.publishedAt!.toISOString().slice(0, 10)
		expect(await failure(`/e/${untitled.publicId}`)).toEqual({
			status: 301,
			location: `/e/${untitled.publicId}/${day}`,
		})
		const loaderData = await load(`/e/${untitled.publicId}/${day}`)
		expect(loaderData.view.date).toBeNull()
		expect(loaderData.view.title).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
		expect(meta({ loaderData } as never)).toContainEqual({
			title: `${loaderData.view.title} · Ada Reader`,
		})
		// Its own picture, with the date for a title.
		expect(loaderData.image).toMatch(/\/og\.png\?v=/)
	})

	it("is not found for a draft or an unknown id", async () => {
		expect((await failure(`/e/${draft.publicId}/draft`)).status).toBe(404)
		expect((await failure("/e/AAAAAAAAAAAA/x")).status).toBe(404)
		expect((await failure("/e/not-an-id/x")).status).toBe(404)
	})

	it("is gone once unpublished, and back when published again", async () => {
		await unpublishEdition(userId, live.id)
		expect((await failure(`/e/${live.publicId}/renamed`)).status).toBe(410)
		await publishEdition(userId, live.id)
		expect((await load(`/e/${live.publicId}/renamed`)).view.title).toBe("Renamed")
	})

	it("shows at most 100 words or 600 characters of each note, and keeps the whole for its owner", async () => {
		const words = (from: number, to: number) =>
			Array.from({ length: to - from }, (_, i) => `w${from + i + 1}`).join(" ")
		const link = (text: string) => `[${text}](https://b.example/(x))`
		// The link's text holds words 96 to 105: the cut falls inside it, so it goes whole.
		const long = `${words(0, 10)}\n\n${words(10, 95)} ${link(words(95, 105))} ${words(105, 130)}`
		const short = `${words(0, 3)} ${link("kept")}\n\n${words(3, 6)}`
		const edition = await createEdition(userId, input)
		await addItem(userId, edition.id, documentOf)
		expect((await publishEdition(userId, edition.id)).ok).toBe(true)
		// Written as an edition published before the cut was: it is cut on the way out.
		const [row] = await db
			.select({ published: editions.published })
			.from(editions)
			.where(eq(editions.id, edition.id))
		const published = row!.published as EditionSnapshot
		const item = published.items[0]!
		const snapshot = {
			...published,
			items: [
				{ ...item, note: long, highlights: [{ exact: "A quote.", note: "あ".repeat(700) }] },
				{ ...item, note: short, highlights: [{ exact: "Another.", note: null }] },
			],
		}
		await db.update(editions).set({ published: snapshot }).where(eq(editions.id, edition.id))

		const { view } = await load(`/e/${edition.publicId}`).catch(async (thrown: Response) =>
			load(thrown.headers.get("Location")!),
		)
		expect(view.items[0]!.note).toBe(`${words(0, 10)}\n\n${words(10, 95)} …`)
		expect(view.items[0]!.highlights[0]!.note).toBe(`${"あ".repeat(600)}…`)
		expect(view.items[1]!.note).toBe(short)
		expect(view.items[1]!.highlights[0]!.note).toBeNull()
		const [stored] = await db
			.select({ published: editions.published })
			.from(editions)
			.where(eq(editions.id, edition.id))
		expect(stored!.published).toEqual(snapshot)
	})

	it("keeps out of search results and keeps its address from the sites it links to", () => {
		expect(headers()).toEqual({
			"X-Robots-Tag": "noindex",
			"Referrer-Policy": "strict-origin-when-cross-origin",
		})
	})

	it("describes itself for link previews, and to crawlers as noindex", async () => {
		const loaderData = await load(`/e/${live.publicId}/renamed`)
		const tags = meta({ loaderData } as never)
		expect(tags).toEqual(
			expect.arrayContaining([
				// The date is in the window's title, after the author.
				{ title: `Renamed · Ada Reader · ${loaderData.view.date}` },
				{ name: "robots", content: "noindex" },
				{ property: "og:title", content: "Renamed" },
				{ property: "og:type", content: "article" },
				{ property: "og:url", content: loaderData.url },
				{ property: "og:description", content: "1 article" },
				{ property: "og:image", content: loaderData.image },
				{ property: "og:image:width", content: "1200" },
				{ property: "og:image:height", content: "630" },
				{ property: "og:image:alt", content: "Renamed" },
				{ name: "twitter:card", content: "summary_large_image" },
			]),
		)
		expect(meta({ loaderData: undefined } as never)).toContainEqual({
			name: "robots",
			content: "noindex",
		})
	})
})

describe("the edition's picture for link previews", () => {
	const card = (publicId: string) =>
		cardLoader({ params: { publicId }, context: {} } as never).then(
			(response) => response,
			(thrown: unknown) => thrown,
		)
	const status = (thrown: unknown) =>
		thrown instanceof Response
			? thrown.status
			: (thrown as { init?: { status?: number } }).init?.status

	it("is a PNG drawn from the published snapshot", async () => {
		const response = (await card(live.publicId)) as Response
		expect(response.headers.get("Content-Type")).toBe("image/png")
		const bytes = new Uint8Array(await response.arrayBuffer())
		// The PNG signature, then the size in the header chunk.
		expect(new TextDecoder().decode(bytes.subarray(1, 4))).toBe("PNG")
		const size = new DataView(bytes.buffer, bytes.byteOffset + 16, 8)
		expect([size.getUint32(0), size.getUint32(4)]).toEqual([1200, 630])
	})

	it("is there exactly when the page is", async () => {
		expect(status(await card(draft.publicId))).toBe(404)
		expect(status(await card("AAAAAAAAAAAA"))).toBe(404)
		await unpublishEdition(userId, live.id)
		expect(status(await card(live.publicId))).toBe(410)
		await publishEdition(userId, live.id)
		expect(await card(live.publicId)).toBeInstanceOf(Response)
	})

	it("is the Klipstack card for a title the font cannot draw", async () => {
		await updateEdition(userId, live.id, { title: "我读了什么" })
		await publishEdition(userId, live.id)
		const thrown = (await card(live.publicId)) as Response
		expect(thrown.status).toBe(302)
		expect(thrown.headers.get("Location")).toMatch(/\/icons\/share-en\.png/)
		// The page points there itself.
		const { location } = await failure(`/e/${live.publicId}`)
		expect((await load(location!)).image).toMatch(/\/icons\/share-en\.png/)
	})
})
