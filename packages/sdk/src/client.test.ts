import { endpoints } from "@klipstack/api-contract"
import { describe, expect, it } from "vitest"
import { createClient, FACADE } from "./client"
import { errorDetails } from "./errors"

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

function fakeClient(respond: (url: URL, body: unknown) => Response) {
	const requests: { url: URL; body: unknown }[] = []
	const client = createClient({
		baseUrl: "https://klipstack.test",
		token: () => "t",
		fetch: async (input, init) => {
			const url = new URL(String(input))
			const body =
				init?.body instanceof Uint8Array
					? JSON.parse(new TextDecoder().decode(init.body))
					: undefined
			requests.push({ url, body })
			return respond(url, body)
		},
	})
	return { client, requests }
}

describe("facade", () => {
	it("has a method for every endpoint", () => {
		const { client } = fakeClient(() => new Response())
		for (const id of Object.keys(endpoints)) {
			const path = FACADE[id as keyof typeof endpoints]
			const target = path
				.split(".")
				.reduce<unknown>((o, key) => (o as Record<string, unknown>)?.[key], client)
			expect(typeof target, `${id} → client.${path}`).toBe("function")
		}
	})

	it("follows every page with all()", async () => {
		const summary = (n: number) => ({
			id: ID,
			title: `A${n}`,
			author: null,
			site: null,
			description: null,
			url: "https://x.test",
			readerUrl: "https://klipstack.test/read/x",
			savedAt: "2026-09-01T00:00:00.000Z",
			publishedAt: null,
			location: "inbox",
			archivedAt: null,
			starred: false,
			shortlisted: false,
			opened: false,
			progress: 0,
			finished: false,
			finishedAt: null,
			readingMinutes: 3,
			status: "ready",
			failure: null,
			trashedAt: null,
			tags: [],
		})
		const { client, requests } = fakeClient((url) =>
			Response.json(
				url.searchParams.get("cursor") === "p2"
					? { items: [summary(2)], nextCursor: null }
					: { items: [summary(1)], nextCursor: "p2" },
			),
		)
		const titles: (string | null)[] = []
		for await (const a of client.articles.all({ view: "archive", limit: 1 })) titles.push(a.title)
		expect(titles).toEqual(["A1", "A2"])
		expect(requests.map((r) => r.url.search)).toEqual([
			"?view=archive&limit=1",
			"?view=archive&limit=1&cursor=p2",
		])
	})

	it("follows one feed's posts with feed.posts()", async () => {
		const section = (n: number, nextCursor: string | null) => ({
			id: ID,
			title: "Blog",
			siteUrl: "https://blog.test",
			notUpdating: false,
			newCount: 2,
			items: [
				{
					id: ID,
					title: `P${n}`,
					url: `https://blog.test/${n}`,
					author: null,
					excerpt: null,
					publishedAt: null,
					new: true,
					savedArticleId: null,
				},
			],
			moreItems: nextCursor ? 1 : 0,
			nextCursor,
		})
		const { client, requests } = fakeClient((url) =>
			Response.json({
				listedAt: "2026-09-01T00:00:00.000Z",
				feeds: [url.searchParams.get("cursor") === "c2" ? section(2, null) : section(1, "c2")],
				quietFeeds: [],
			}),
		)
		const titles: (string | null)[] = []
		for await (const post of client.feed.posts(ID, { newOnly: true, perFeed: 1 }))
			titles.push(post.title)
		expect(titles).toEqual(["P1", "P2"])
		expect(requests.map((r) => r.url.search)).toEqual([
			`?newOnly=true&perFeed=1&feed=${ID}`,
			`?newOnly=true&perFeed=1&feed=${ID}&cursor=c2`,
		])
	})

	it("updates any number of articles, merging what each request reports", async () => {
		const { client, requests } = fakeClient((_url, body) =>
			Response.json({ items: [], notFound: (body as { ids: string[] }).ids.slice(0, 1) }),
		)
		const ids = Array.from(
			{ length: 120 },
			(_, i) => `0190a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, "0")}`,
		)
		const result = await client.articles.update(ids, { starred: true })
		expect(result).toEqual({ items: [], notFound: [ids[0], ids[100]] })
		expect(requests.map((r) => r.body)).toEqual([
			{ starred: true, ids: ids.slice(0, 100) },
			{ starred: true, ids: ids.slice(100) },
		])
		// The contract's checks run on each request: no field to change is refused before sending.
		await expect(client.articles.update(ids, {})).rejects.toMatchObject({
			name: "KlipstackInputError",
		})
		expect(requests).toHaveLength(2)
	})

	it("returns binary responses as they are", async () => {
		const { client, requests } = fakeClient(
			() => new Response("zip", { headers: { "content-type": "application/zip" } }),
		)
		const res = await client.export()
		expect(res.headers.get("content-type")).toBe("application/zip")
		expect(await res.text()).toBe("zip")
		expect(requests[0]?.url.pathname + requests[0]!.url.search).toBe("/api/v1/export?format=zip")
	})

	it("reads the article's HTML, and highlights a passage by its place", async () => {
		const highlight = {
			id: ID,
			quote: "ends.Next",
			note: null,
			color: "yellow",
			createdAt: "2026-09-01T00:00:00.000Z",
			article: { id: ID, title: null, site: null, url: "https://x.test" },
			prefix: "It ",
			suffix: " one.",
			start: 3,
			end: 12,
		}
		const { client, requests } = fakeClient((url) =>
			url.pathname.endsWith("/html")
				? Response.json({ versionId: ID, html: "<p>It ends.</p><p>Next one.</p>" })
				: Response.json({ highlight }, { status: 201 }),
		)
		expect(await client.articles.html(ID)).toEqual({
			versionId: ID,
			html: "<p>It ends.</p><p>Next one.</p>",
		})
		expect(requests[0]?.url.pathname).toBe(`/api/v1/articles/${ID}/html`)
		const place = { quote: "ends.Next", start: 3, end: 12, prefix: "It ", suffix: " one." }
		expect(await client.highlights.create(ID, place)).toEqual({ highlight })
		expect(requests[1]?.body).toEqual(place)
		// Offsets are whole and not negative, checked before sending.
		await expect(client.highlights.create(ID, { ...place, start: -1 })).rejects.toMatchObject({
			name: "KlipstackInputError",
		})
		expect(requests).toHaveLength(2)
	})
})

describe("errorDetails", () => {
	it("types the details of the codes that carry them", async () => {
		const { client } = fakeClient(() =>
			Response.json(
				{
					error: {
						code: "ambiguous_quote",
						message: "Twice",
						details: {
							candidates: [{ occurrence: 1, context: "…[a]…", start: 4, end: 5, extra: true }],
						},
					},
				},
				{ status: 409 },
			),
		)
		const error = await client.highlights
			.create("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", { quote: "a" })
			.catch((e: unknown) => e)
		expect(errorDetails(error, "ambiguous_quote")).toEqual({
			candidates: [{ occurrence: 1, context: "…[a]…", start: 4, end: 5 }],
		})
		expect(errorDetails(error, "note_changed")).toBeNull()
		expect(errorDetails(new Error("x"), "ambiguous_quote")).toBeNull()
	})
})
