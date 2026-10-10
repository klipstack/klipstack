import { describe, expect, it } from "vitest"
import { ExtractError } from "../src/errors"
import { discoverFeedLinks, parseFeedDocument, resolveFeed } from "../src/feeds"
import type { FetchedPage } from "../src/fetch"
import { parseRetryAfter } from "../src/fetch"

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
	<title>Blog &amp; Co</title>
	<link>https://blog.example.com/</link>
	<item>
		<title>Hello world</title>
		<link>/posts/hello?utm_source=rss</link>
		<dc:creator>Ann</dc:creator>
		<pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
		<description>&lt;p&gt;First&lt;/p&gt;&lt;p&gt;paragraph &lt;b&gt;here&lt;/b&gt;&lt;/p&gt;</description>
		<content:encoded><![CDATA[<p>Full text</p>]]></content:encoded>
	</item>
	<item>
		<guid isPermaLink="false">abc-123</guid>
		<title>No date</title>
		<link>https://blog.example.com/b</link>
	</item>
	<item>
		<title>No link</title>
	</item>
</channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Atom site</title>
	<link rel="alternate" href="https://atom.example.com/"/>
	<entry>
		<id>tag:atom.example.com,2026:1</id>
		<title type="html">Using &lt;em&gt;emphasis&lt;/em&gt;</title>
		<link rel="alternate" href="https://atom.example.com/1"/>
		<updated>2026-09-02T00:00:00Z</updated>
		<summary>Short summary</summary>
		<author><name>Bob</name></author>
	</entry>
</feed>`

const JSON_FEED = JSON.stringify({
	version: "https://jsonfeed.org/version/1.1",
	title: "JSON site",
	home_page_url: "https://json.example.com/",
	items: [
		{
			id: 7,
			url: "https://json.example.com/seven",
			title: "Seven",
			content_text: "Plain   text body",
			date_published: "2026-09-03T12:00:00Z",
			authors: [{ name: "Cy" }],
		},
		{ id: "no-url", title: "Skipped" },
	],
})

const page = (html: string, finalUrl: string, contentType = "text/html"): FetchedPage => ({
	html,
	finalUrl,
	status: 200,
	contentType,
	etag: null,
	lastModified: null,
})

describe("parseFeedDocument", () => {
	it("reads RSS 2.0", () => {
		const feed = parseFeedDocument(RSS, "https://blog.example.com/feed")
		expect(feed.title).toBe("Blog & Co")
		expect(feed.siteUrl).toBe("https://blog.example.com/")
		expect(feed.entries).toEqual([
			{
				guid: "https://blog.example.com/posts/hello",
				url: "https://blog.example.com/posts/hello",
				title: "Hello world",
				author: "Ann",
				excerpt: "First paragraph here",
				publishedAt: new Date("2026-09-01T10:00:00Z"),
			},
			{
				guid: "abc-123",
				url: "https://blog.example.com/b",
				title: "No date",
				author: null,
				excerpt: null,
				publishedAt: null,
			},
		])
	})

	it("reads Atom, with HTML titles and updated as the date", () => {
		const feed = parseFeedDocument(ATOM, "https://atom.example.com/atom.xml")
		expect(feed.title).toBe("Atom site")
		expect(feed.entries[0]).toMatchObject({
			guid: "tag:atom.example.com,2026:1",
			url: "https://atom.example.com/1",
			title: "Using emphasis",
			author: "Bob",
			excerpt: "Short summary",
			publishedAt: new Date("2026-09-02T00:00:00Z"),
		})
	})

	it("reads JSON Feed", () => {
		const feed = parseFeedDocument(JSON_FEED, "https://json.example.com/feed.json")
		expect(feed.siteUrl).toBe("https://json.example.com/")
		expect(feed.entries).toEqual([
			{
				guid: "7",
				url: "https://json.example.com/seven",
				title: "Seven",
				author: "Cy",
				excerpt: "Plain text body",
				publishedAt: new Date("2026-09-03T12:00:00Z"),
			},
		])
	})

	it("drops a publish date no feed could mean", () => {
		const dated = (pubDate: string) =>
			parseFeedDocument(
				`<rss version="2.0"><channel><title>T</title><item><link>https://b.example/p</link><pubDate>${pubDate}</pubDate></item></channel></rss>`,
				"https://b.example/feed",
			).entries[0]?.publishedAt
		expect(dated("Mon, 01 Sep 2026 10:00:00 GMT")).toEqual(new Date("2026-09-01T10:00:00Z"))
		expect(dated("Mon, 01 Jan 20240 00:00:00 GMT")).toBeNull()
		expect(dated("Thu, 01 Jan 1970 00:00:00 GMT")).toBeNull()
		expect(dated("Fri, 01 Jan 2100 00:00:00 GMT")).toBeNull()
	})

	it("drops the title when the excerpt repeats it", () => {
		const xml = RSS.replace(
			"&lt;p&gt;First&lt;/p&gt;&lt;p&gt;paragraph &lt;b&gt;here&lt;/b&gt;&lt;/p&gt;",
			"&lt;h3&gt;Hello world&lt;/h3&gt;&lt;p&gt;The body.&lt;/p&gt;",
		)
		expect(parseFeedDocument(xml, "https://blog.example.com/feed").entries[0]?.excerpt).toBe(
			"The body.",
		)
	})

	it("truncates long excerpts at a word", () => {
		const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ")
		const xml = RSS.replace(
			"&lt;p&gt;First&lt;/p&gt;&lt;p&gt;paragraph &lt;b&gt;here&lt;/b&gt;&lt;/p&gt;",
			long,
		)
		const excerpt = parseFeedDocument(xml, "https://blog.example.com/feed").entries[0]?.excerpt
		expect(excerpt?.length).toBeLessThanOrEqual(281)
		expect(excerpt).toMatch(/word\d+…$/)
	})

	it("rejects HTML and other JSON", () => {
		const notFeed = (text: string) => {
			try {
				parseFeedDocument(text, "https://example.com/")
			} catch (error) {
				return error instanceof ExtractError && error.code === "not_feed"
			}
			return false
		}
		expect(notFeed("<!doctype html><html><body>Hi</body></html>")).toBe(true)
		expect(notFeed('{"hello":"world"}')).toBe(true)
		expect(notFeed("plain text")).toBe(true)
	})
})

describe("discoverFeedLinks", () => {
	it("finds alternate feed links, comment feeds last", () => {
		const html = `<html><head>
			<link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed">
			<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed">
			<link rel="alternate" type="application/rss+xml" href="/feed">
			<link rel="alternate" hreflang="es" href="/es/">
			<link rel="stylesheet" type="text/css" href="/s.css">
		</head></html>`
		expect(discoverFeedLinks(html, "https://site.example.com/about")).toEqual([
			{ url: "https://site.example.com/feed", title: "Posts" },
			{ url: "https://site.example.com/comments/feed", title: "Comments Feed" },
		])
	})
})

describe("resolveFeed", () => {
	const fetcherFor =
		(pages: Record<string, FetchedPage>) =>
		async (url: string): Promise<FetchedPage> => {
			const found = pages[url]
			if (!found) throw new ExtractError("http_error", "404", { status: 404 })
			return found
		}

	it("accepts a feed URL", async () => {
		const res = await resolveFeed(
			"https://blog.example.com/feed",
			fetcherFor({ "https://blog.example.com/feed": page(RSS, "https://blog.example.com/feed") }),
		)
		expect(res).toMatchObject({ kind: "feed", url: "https://blog.example.com/feed" })
	})

	it("follows the one feed a page links", async () => {
		const html = `<link rel="alternate" type="application/atom+xml" href="/atom.xml">
			<link rel="alternate" type="application/rss+xml" title="Comments" href="/comments.xml">`
		const res = await resolveFeed(
			"https://atom.example.com",
			fetcherFor({
				"https://atom.example.com/": page(html, "https://atom.example.com/"),
				"https://atom.example.com/atom.xml": page(ATOM, "https://atom.example.com/atom.xml"),
			}),
		)
		expect(res).toMatchObject({ kind: "feed", url: "https://atom.example.com/atom.xml" })
	})

	it("offers a choice when a page links several feeds", async () => {
		const html = `<link rel="alternate" type="application/rss+xml" title="All" href="/all.xml">
			<link rel="alternate" type="application/rss+xml" title="Tech" href="/tech.xml">`
		const res = await resolveFeed(
			"https://many.example.com/",
			fetcherFor({ "https://many.example.com/": page(html, "https://many.example.com/") }),
		)
		expect(res).toEqual({
			kind: "choices",
			links: [
				{ url: "https://many.example.com/all.xml", title: "All" },
				{ url: "https://many.example.com/tech.xml", title: "Tech" },
			],
		})
	})

	it("takes the first when the feeds are one feed in several formats", async () => {
		const pages = (titles: [string | null, string | null]) => {
			const attr = (t: string | null) => (t ? ` title="${t}"` : "")
			const html = `<link rel="alternate" type="application/atom+xml"${attr(titles[0])} href="/atom.xml">
				<link rel="alternate" type="application/rss+xml"${attr(titles[1])} href="/rss.xml">`
			return fetcherFor({
				"https://atom.example.com/": page(html, "https://atom.example.com/"),
				"https://atom.example.com/atom.xml": page(ATOM, "https://atom.example.com/atom.xml"),
			})
		}
		for (const titles of [
			[null, null],
			["Blog (Atom)", "Blog (RSS 2.0)"],
		] as [string | null, string | null][]) {
			const res = await resolveFeed("https://atom.example.com/", pages(titles))
			expect(res).toMatchObject({ kind: "feed", url: "https://atom.example.com/atom.xml" })
		}
	})

	it("follows a plain link to a feed when the page has no feed <link>", async () => {
		const html = `<p>Subscribe via <a href="/about">about</a> or the
			<a href="https://elsewhere.example.org/2002/feeds/essays.rss">feed</a>.</p>
			<!-- <a href="https://old.example.org/gone.rss">old feed</a> -->`
		const res = await resolveFeed(
			"https://blog.example.com/rss.html",
			fetcherFor({
				"https://blog.example.com/rss.html": page(html, "https://blog.example.com/rss.html"),
				"https://elsewhere.example.org/2002/feeds/essays.rss": page(
					RSS,
					"https://elsewhere.example.org/2002/feeds/essays.rss",
				),
			}),
		)
		expect(res).toMatchObject({
			kind: "feed",
			url: "https://elsewhere.example.org/2002/feeds/essays.rss",
		})
	})

	it("tries common paths when the page links none", async () => {
		const res = await resolveFeed(
			"https://blog.example.com/about",
			fetcherFor({
				"https://blog.example.com/about": page("<html></html>", "https://blog.example.com/about"),
				"https://blog.example.com/rss.xml": page(RSS, "https://blog.example.com/rss.xml"),
			}),
		)
		expect(res).toMatchObject({ kind: "feed", url: "https://blog.example.com/rss.xml" })
	})

	it("fails when there is no feed", async () => {
		await expect(
			resolveFeed(
				"https://none.example.com/",
				fetcherFor({
					"https://none.example.com/": page("<html></html>", "https://none.example.com/"),
				}),
			),
		).rejects.toMatchObject({ code: "not_feed" })
	})
})

describe("parseRetryAfter", () => {
	it("reads seconds and dates", () => {
		const now = Date.parse("2026-09-14T10:00:00Z")
		expect(parseRetryAfter("120", now)).toBe(120)
		expect(parseRetryAfter("Mon, 14 Sep 2026 10:05:00 GMT", now)).toBe(300)
		expect(parseRetryAfter("soon", now)).toBeNull()
		expect(parseRetryAfter(null, now)).toBeNull()
	})
})
