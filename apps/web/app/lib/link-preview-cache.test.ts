import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createLinkPreviewCache } from "./link-preview-cache"

const preview = {
	title: "Page title",
	description: null,
	author: null,
	siteName: "Example",
	imageUrl: null,
}
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
	fetchMock.mockReset()
	vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

it("shares a hover request with a click, other fragments and later opens", async () => {
	let resolve!: (response: Response) => void
	fetchMock.mockReturnValueOnce(
		new Promise((done) => {
			resolve = done
		}),
	)
	const cache = createLinkPreviewCache()
	cache.prefetch("https://example.com/page#one")
	const clicked = cache.load("https://example.com/page#two")
	expect(clicked.value).toBeUndefined()
	expect(fetchMock).toHaveBeenCalledOnce()
	resolve(Response.json({ preview }))
	expect(await clicked.result).toEqual(preview)
	expect(cache.peek("https://example.com/page")?.value).toEqual(preview)
	expect(cache.load("https://example.com/page")).toBe(clicked)
	expect(fetchMock).toHaveBeenCalledOnce()
})

it("limits speculative requests while allowing a clicked link to load", async () => {
	fetchMock.mockImplementation(async () => Response.json({ preview }))
	const cache = createLinkPreviewCache()
	cache.prefetch("https://example.com/one")
	cache.prefetch("https://example.com/two")
	cache.prefetch("https://example.com/three")
	expect(fetchMock).toHaveBeenCalledTimes(2)
	await cache.load("https://example.com/three").result
	expect(fetchMock).toHaveBeenCalledTimes(3)
	cache.prefetch("https://example.com/four")
	await cache.load("https://example.com/four").result
	expect(fetchMock).toHaveBeenCalledTimes(4)
})

it("caches failures briefly and retries after they expire", async () => {
	const clock = vi.spyOn(Date, "now").mockReturnValue(1000)
	fetchMock.mockRejectedValueOnce(new Error("Offline"))
	const cache = createLinkPreviewCache()
	expect(await cache.load("https://example.com/page").result).toBeNull()
	expect(cache.peek("https://example.com/page")?.value).toBeNull()
	await cache.load("https://example.com/page").result
	expect(fetchMock).toHaveBeenCalledOnce()
	clock.mockReturnValue(62_000)
	expect(cache.peek("https://example.com/page")).toBeUndefined()
	fetchMock.mockResolvedValueOnce(Response.json({ preview }))
	expect(await cache.load("https://example.com/page").result).toEqual(preview)
})

it("treats HTTP and malformed response failures as completed unavailable previews", async () => {
	fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
	fetchMock.mockResolvedValueOnce(new Response("not JSON"))
	const cache = createLinkPreviewCache()
	expect(await cache.load("https://example.com/http-error").result).toBeNull()
	expect(await cache.load("https://example.com/json-error").result).toBeNull()
})

it("leaves malformed article links to the endpoint instead of throwing during card rendering", async () => {
	fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }))
	const cache = createLinkPreviewCache()
	expect(cache.peek("https://")).toBeUndefined()
	expect(await cache.load("https://").result).toBeNull()
})

it("keeps only a bounded number of previews and scopes them to one reader", async () => {
	fetchMock.mockImplementation(async () => Response.json({ preview }))
	const cache = createLinkPreviewCache()
	for (let i = 0; i <= 50; i++) await cache.load(`https://example.com/${i}`).result
	expect(cache.peek("https://example.com/0")).toBeUndefined()
	expect(cache.peek("https://example.com/50")?.value).toEqual(preview)
	expect(createLinkPreviewCache().peek("https://example.com/50")).toBeUndefined()
})
