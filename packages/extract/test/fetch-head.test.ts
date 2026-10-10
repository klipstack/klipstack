import { fetch as undiciFetch } from "undici"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchPage } from "../src/fetch"

vi.mock("undici", async (original) => ({
	...(await original<typeof import("undici")>()),
	fetch: vi.fn(),
}))

const fetchMock = vi.mocked(undiciFetch)
function respond(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
	fetchMock.mockResolvedValueOnce(
		new Response(body, { headers: { "content-type": "text/html", ...headers } }) as never,
	)
}

beforeEach(() => fetchMock.mockReset())

describe("metadata-only fetches", () => {
	it("stops at a split head boundary without requesting the article body", async () => {
		const chunks = ["<head><title>A title</title></he", "ad>", "<body>Long article</body>"]
		const cancel = vi.fn()
		let reads = 0
		respond(
			new ReadableStream(
				{
					pull(controller) {
						controller.enqueue(new TextEncoder().encode(chunks[reads++]))
					},
					cancel,
				},
				{ highWaterMark: 0 },
			),
			{ "content-length": "1000000" },
		)
		const page = await fetchPage("https://example.com/page", { headOnly: true, maxBytes: 1024 })
		expect(page.html).toBe("<head><title>A title</title>")
		expect(reads).toBe(2)
		expect(cancel).toHaveBeenCalledOnce()
	})

	it("returns the bounded prefix of a large head instead of failing the preview", async () => {
		respond(`<title>Small title</title>${" ".repeat(1000)}`)
		const page = await fetchPage("https://example.com/page", { headOnly: true, maxBytes: 64 })
		expect(page.html).toHaveLength(64)
		expect(page.html).toContain("Small title")
	})

	it("stops at the body when the closing head tag is omitted", async () => {
		respond("<title>Title</title><BODY class='article'><h1>Body title</h1>")
		expect((await fetchPage("https://example.com", { headOnly: true })).html).toBe(
			"<title>Title</title>",
		)
	})

	it("still rejects oversized full-page fetches", async () => {
		respond("x".repeat(100), { "content-length": "100" })
		await expect(fetchPage("https://example.com", { maxBytes: 64 })).rejects.toMatchObject({
			code: "too_large",
		})
		respond("x".repeat(100))
		await expect(fetchPage("https://example.com", { maxBytes: 64 })).rejects.toMatchObject({
			code: "too_large",
		})
	})

	it("validates redirect destinations before a second request", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "http://127.0.0.1/secret" },
			}) as never,
		)
		await expect(fetchPage("https://example.com", { headOnly: true })).rejects.toMatchObject({
			code: "blocked_host",
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it("retains the final public URL and rejects non-HTML responses", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: "/final/page" } }) as never,
		)
		respond("<title>Final</title></head>")
		expect((await fetchPage("https://example.com", { headOnly: true })).finalUrl).toBe(
			"https://example.com/final/page",
		)
		respond("%PDF", { "content-type": "application/pdf" })
		await expect(
			fetchPage("https://example.com", { headOnly: true, contentTypes: /^text\/html/i }),
		).rejects.toMatchObject({ code: "not_html" })
	})
})
