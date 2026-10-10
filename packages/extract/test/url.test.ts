import { describe, expect, it } from "vitest"
import { ExtractError } from "../src/errors"
import { decodeBody, isPrivateAddress } from "../src/fetch"
import { htmlToMarkdown } from "../src/markdown"
import { cleanTitle } from "../src/metadata"
import { normalizeUrl, parseXStatusUrl, unsupportedReason, urlHash } from "../src/url"

describe("normalizeUrl", () => {
	it("strips tracking params, fragments, default ports, trailing slashes", () => {
		expect(normalizeUrl("HTTPS://Example.com:443/a/b/?utm_source=x&id=1&fbclid=zz#frag")).toBe(
			"https://example.com/a/b?id=1",
		)
		expect(normalizeUrl("http://example.com/")).toBe("http://example.com/")
		expect(normalizeUrl("https://example.com/post?utm_campaign=c")).toBe("https://example.com/post")
	})
	it("rejects non-http urls", () => {
		expect(() => normalizeUrl("ftp://example.com/x")).toThrow(ExtractError)
		expect(() => normalizeUrl("javascript:alert(1)")).toThrow(ExtractError)
		expect(() => normalizeUrl("not a url")).toThrow(ExtractError)
	})
	it("hashes deterministically", () => {
		expect(urlHash("https://example.com/a")).toBe(urlHash("https://example.com/a"))
		expect(urlHash("https://example.com/a")).toHaveLength(64)
	})
})

describe("posts on X", () => {
	it("normalizes every form of a post link to one URL", () => {
		const canonical = "https://x.com/jescalan/status/2098166165000306728"
		for (const url of [
			"https://x.com/jescalan/status/2098166165000306728?s=20",
			"https://twitter.com/JEscalan/status/2098166165000306728/",
			"https://mobile.twitter.com/jescalan/status/2098166165000306728/photo/1",
			"https://fxtwitter.com/jescalan/status/2098166165000306728#m",
			"https://x.com/jescalan/status/2098166165000306728/?s=12&rw_tt_thread=True",
		])
			expect(normalizeUrl(url), url).toBe(canonical)
		expect(normalizeUrl("https://x.com/i/web/status/123")).toBe("https://x.com/i/status/123")
	})
	it("parses post links only", () => {
		expect(parseXStatusUrl("https://x.com/a_b/status/42")).toEqual({ handle: "a_b", id: "42" })
		expect(parseXStatusUrl("https://x.com/a_b")).toBeNull()
		expect(parseXStatusUrl("https://x.com/a/status/abc")).toBeNull()
		expect(parseXStatusUrl("https://example.com/a/status/42")).toBeNull()
	})
})

describe("unsupportedReason", () => {
	it("flags X links that are not posts, and youtube", () => {
		expect(unsupportedReason("https://x.com/user/status/1")).toBeNull()
		expect(unsupportedReason("https://x.com/user")).toBe("twitter")
		expect(unsupportedReason("https://twitter.com/home")).toBe("twitter")
		expect(unsupportedReason("https://www.youtube.com/watch?v=abc")).toBe("youtube")
		expect(unsupportedReason("https://youtu.be/abc")).toBe("youtube")
		expect(unsupportedReason("https://example.com")).toBeNull()
	})
})

describe("isPrivateAddress", () => {
	it("blocks private, loopback, link-local, metadata and mapped addresses", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254",
			"0.0.0.0",
			"100.64.0.1",
			"224.0.0.1",
			"::1",
			"fe80::1",
			"fd00::1",
			"::ffff:127.0.0.1",
			"::ffff:10.0.0.1",
			"::ffff:7f00:1",
			"::127.0.0.1",
			"64:ff9b::a00:1",
			"2002:a00:1::1",
			"2001::1",
			"198.18.0.1",
			"255.255.255.255",
			"not an address",
		]) {
			expect(isPrivateAddress(ip), ip).toBe(true)
		}
	})
	it("allows public addresses", () => {
		for (const ip of [
			"8.8.8.8",
			"1.1.1.1",
			"172.32.0.1",
			"2606:4700:4700::1111",
			"2001:4860:4860::8888",
			"::ffff:8.8.8.8",
			"::ffff:808:808",
			"223.255.255.255",
		]) {
			expect(isPrivateAddress(ip), ip).toBe(false)
		}
	})
})

describe("cleanTitle", () => {
	it("removes site suffixes and prefixes", () => {
		expect(
			cleanTitle(
				"The Joel Test: 12 Steps to Better Code – Joel on Software",
				"Joel on Software",
				"www.joelonsoftware.com",
			),
		).toBe("The Joel Test: 12 Steps to Better Code")
		expect(cleanTitle("Readability - Wikipedia", null, "en.wikipedia.org")).toBe("Readability")
		expect(cleanTitle("Aeon | Treasure your friends", "Aeon", "aeon.co")).toBe(
			"Treasure your friends",
		)
		expect(cleanTitle("A plain title", "Site", "site.com")).toBe("A plain title")
	})
})

describe("decodeBody", () => {
	it("uses the declared charset", () => {
		expect(decodeBody(Buffer.from("caf\u00e9", "utf8"), "text/html; charset=utf-8")).toBe("café")
		expect(decodeBody(Buffer.from([0x63, 0x61, 0x66, 0xe9]), "text/html; charset=iso-8859-1")).toBe(
			"café",
		)
	})
	it("sniffs a meta charset", () => {
		const html = Buffer.concat([
			Buffer.from('<html><head><meta charset="windows-1252"></head><body>'),
			Buffer.from([0x97]),
			Buffer.from(" x</body></html>"),
		])
		expect(decodeBody(html, "text/html")).toContain("— x")
	})
	it("falls back to windows-1252 when undeclared bytes are not valid utf-8", () => {
		expect(decodeBody(Buffer.from([0x97, 0x20, 0x43]), "text/html")).toBe("— C")
		expect(decodeBody(Buffer.from("— C", "utf8"), "text/html")).toBe("— C")
	})
})

describe("htmlToMarkdown", () => {
	it("renders headings, links, code and images", () => {
		const md = htmlToMarkdown(
			'<h2>Title</h2><p>Some <a href="https://x.com/a">link</a> and <code>x</code>.</p><pre><code class="language-ts">const a = 1\n</code></pre><figure><img src="/assets/1" data-original-src="https://x.com/i.png" alt="pic"><figcaption>Cap</figcaption></figure>',
		)
		expect(md).toContain("## Title")
		expect(md).toContain("[link](https://x.com/a)")
		expect(md).toContain("```ts\nconst a = 1\n```")
		expect(md).toContain("![pic](https://x.com/i.png)")
		expect(md).toContain("_Cap_")
	})

	it("escapes text that would read as HTML", () => {
		const md = htmlToMarkdown(
			'<p>The &lt;marquee&gt; tag, &lt;/p&gt;, &lt;!-- --&gt;, &amp;copy; and a &lt; b &amp; c. <code>&lt;div&gt;</code></p><figure><img src="https://x.com/i.png"><figcaption>A &lt;blink&gt; tag</figcaption></figure>',
		)
		expect(md).toContain("The \\<marquee> tag, \\</p>, \\<!-- -->, \\&copy; and a < b & c. `<div>`")
		expect(md).toContain("_A \\<blink> tag_")
	})

	it("keeps an image URL whole, so its parentheses can't start a link", () => {
		const md = htmlToMarkdown(
			'<p><img src="https://x.com/a)[Tap](javascript:alert(1)" alt="a"></p>' +
				'<figure><img src="https://x.com/Foo_(bar).png" data-original-src="https://x.com/b\\) c"></figure>',
		)
		expect(md).toContain("![a](https://x.com/a\\)[Tap]\\(javascript:alert\\(1\\))")
		expect(md).toContain("![](https://x.com/b\\\\\\)%20c)")
	})
})
