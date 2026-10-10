import { describe, expect, it } from "vitest"
import { buildOpml, parseOpml } from "../src/opml"

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
	<head><title>My feeds</title></head>
	<body>
		<outline text="Tech" title="Tech">
			<outline type="rss" text="Blog &amp; Co" title="Blog &amp; Co" xmlUrl="https://blog.example.com/feed?a=1&amp;b=2" htmlUrl="https://blog.example.com/"/>
			<outline text="Nested">
				<outline type="rss" text="Deep" xmlUrl="https://deep.example.com/rss"></outline>
			</outline>
		</outline>
		<outline type="rss" text="  Text   only " xmlurl="https://lower.example.com/atom.xml"/>
		<outline type="rss" text="2026" xmlUrl="https://year.example.com/feed"/>
		<outline type="link" text="Not a feed" url="https://example.com/"/>
	</body>
</opml>`

describe("parseOpml", () => {
	it("lists every feed in order, whatever its folder", () => {
		expect(parseOpml(OPML)).toEqual([
			{
				xmlUrl: "https://blog.example.com/feed?a=1&b=2",
				title: "Blog & Co",
				htmlUrl: "https://blog.example.com/",
			},
			{ xmlUrl: "https://deep.example.com/rss", title: "Deep", htmlUrl: null },
			{ xmlUrl: "https://lower.example.com/atom.xml", title: "Text only", htmlUrl: null },
			{ xmlUrl: "https://year.example.com/feed", title: "2026", htmlUrl: null },
		])
	})

	it("reads a file with no feeds as empty", () => {
		expect(parseOpml('<opml version="2.0"><head/><body/></opml>')).toEqual([])
	})

	it("tolerates a bare ampersand", () => {
		const feeds = parseOpml(
			'<opml><body><outline text="Q & A" xmlUrl="https://qa.example.com/feed"/></body></opml>',
		)
		expect(feeds).toEqual([
			{ xmlUrl: "https://qa.example.com/feed", title: "Q & A", htmlUrl: null },
		])
	})

	it("refuses what is not OPML", () => {
		for (const input of ["", "hello", '{"a":1}', "<rss><channel/></rss>", "<html><body/></html>"])
			expect(() => parseOpml(input)).toThrowError(
				expect.objectContaining({ name: "ExtractError", code: "not_opml" }),
			)
	})
})

describe("buildOpml", () => {
	it("round-trips through parseOpml", () => {
		const feeds = [
			{ xmlUrl: "https://a.example.com/feed?x=1&y=2", title: 'A "quoted" <blog>', htmlUrl: null },
			{ xmlUrl: "https://b.example.com/rss", title: null, htmlUrl: "https://b.example.com/" },
		]
		const xml = buildOpml("Klipstack feeds", feeds, new Date(Date.UTC(2026, 8, 21)))
		expect(xml).toContain("<dateCreated>Mon, 21 Sep 2026 00:00:00 GMT</dateCreated>")
		expect(parseOpml(xml)).toEqual([
			feeds[0],
			// An untitled feed is named by its address.
			{ ...feeds[1], title: "https://b.example.com/rss" },
		])
	})

	it("drops characters XML does not allow", () => {
		const xml = buildOpml("x", [
			{ xmlUrl: "https://a.example.com/", title: "a\u0000b\u000Bc", htmlUrl: null },
		])
		expect(xml).toContain('text="abc"')
	})
})
