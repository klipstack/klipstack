import { fetchPage } from "@klipstack/extract"
import { beforeEach, expect, it, vi } from "vitest"
import { getLinkPreview, previewableUrl } from "./link-preview.server"

vi.mock("@klipstack/extract", async (original) => ({
	...(await original<typeof import("@klipstack/extract")>()),
	fetchPage: vi.fn(),
}))

const fetchMock = vi.mocked(fetchPage)
function respond(html: string, finalUrl = "https://example.com/final/page") {
	fetchMock.mockResolvedValueOnce({
		html,
		finalUrl,
		status: 200,
		contentType: "text/html",
		etag: null,
		lastModified: null,
	})
}
beforeEach(() => fetchMock.mockReset())

it("reads and bounds page metadata, resolving an OG image against the final URL", async () => {
	respond(`<head>
		<title>Fallback</title><meta property="og:title" content="Actual title | Example">
		<meta property="og:site_name" content="Example"><meta name="author" content=" A. Writer ">
		<meta property="og:description" content="${"Useful detail. ".repeat(80)}">
		<meta property="og:image" content="../cover.jpg">
	</head>`)
	const preview = await getLinkPreview("https://example.com/metadata")
	expect(preview).toMatchObject({
		title: "Actual title",
		author: "A. Writer",
		siteName: "Example",
		imageUrl: "https://example.com/cover.jpg",
	})
	expect(preview?.description).toHaveLength(600)
	expect(fetchMock).toHaveBeenCalledWith(
		"https://example.com/metadata",
		expect.objectContaining({
			headOnly: true,
			maxBytes: 256 * 1024,
			timeoutMs: 5_000,
		}),
	)
})

it("uses Twitter and structured metadata when OG and author tags are absent", async () => {
	respond(`<meta name="twitter:title" content="From Twitter"><meta name="twitter:image" content="/twitter.jpg">
		<script type="application/ld+json">{"@type":"Article","author":[{"name":"First"},{"name":"Second"}],"description":"From JSON-LD"}</script>`)
	expect(await getLinkPreview("https://example.com/fallbacks")).toMatchObject({
		title: "From Twitter",
		author: "First, Second",
		description: "From JSON-LD",
		imageUrl: "https://example.com/twitter.jpg",
	})
})

it("survives malformed structured metadata and unsafe image URLs", async () => {
	for (const [i, image] of [
		"javascript:alert(1)",
		"http://127.0.0.1/private",
		"https://user:pass@example.com/image",
	].entries()) {
		respond(`<title>Real title</title><meta property="og:image" content="${image}">
			<script type="application/ld+json">{"@type":"Article","headline":{},"datePublished":[]}</script>`)
		expect(await getLinkPreview(`https://example.com/malformed-${i}`)).toMatchObject({
			title: "Real title",
			imageUrl: null,
		})
	}
})

it("leaves absent metadata empty", async () => {
	respond("<head></head>")
	expect(await getLinkPreview("https://example.com/empty")).toEqual({
		title: null,
		description: null,
		author: null,
		siteName: "example.com",
		imageUrl: null,
	})
})

it("shares concurrent fetches and reuses recent previews", async () => {
	respond("<title>Cached</title>")
	const url = "https://example.com/cached"
	const [first, second] = await Promise.all([getLinkPreview(url), getLinkPreview(url)])
	expect(first).toEqual(second)
	expect(await getLinkPreview(url)).toEqual(first)
	expect(fetchMock).toHaveBeenCalledOnce()
})

it("falls back on failure, caches briefly, then retries", async () => {
	const now = Date.now()
	const clock = vi.spyOn(Date, "now").mockReturnValue(now)
	try {
		fetchMock.mockRejectedValueOnce(new Error("Timed out"))
		const url = "https://example.com/unavailable"
		expect(await getLinkPreview(url)).toBeNull()
		expect(await getLinkPreview(url)).toBeNull()
		expect(fetchMock).toHaveBeenCalledOnce()
		clock.mockReturnValue(now + 61_000)
		respond("<title>Available now</title>")
		expect(await getLinkPreview(url)).toMatchObject({ title: "Available now" })
	} finally {
		clock.mockRestore()
	}
})

it("previews only http(s) URLs without credentials, and drops the fragment", () => {
	expect(previewableUrl("https://example.com/a?b=1#c")?.href).toBe("https://example.com/a?b=1")
	expect(previewableUrl("http://example.com/")?.href).toBe("http://example.com/")
	for (const raw of [
		"ftp://example.com/",
		"javascript:alert(1)",
		"https://user:pass@example.com/",
		"not a url",
		`https://example.com/${"a".repeat(4096)}`,
	])
		expect(previewableUrl(raw), raw).toBeNull()
})
