import { describe, expect, it } from "vitest"
import { articleOutlinks, OUTLINKS_MAX, outlinkHashes } from "../src/outlinks"
import { normalizeUrl, urlHash } from "../src/url"

const hashOf = (url: string) => urlHash(normalizeUrl(url))
const BASE = "https://blog.example/posts/one"

describe("outlinkHashes", () => {
	it("hashes links the way saving hashes an address", () => {
		const html = `<p><a href="https://Other.example/a/?utm_source=x#top">a</a>
			<a class="x" href="https://other.example/b?x=1&amp;y=2">b</a></p>`
		expect(outlinkHashes(html, BASE)).toEqual([
			hashOf("https://other.example/a"),
			hashOf("https://other.example/b?x=1&y=2"),
		])
	})
	it("keeps one hash for several spellings of one address", () => {
		const html = `<a href="https://other.example/a">1</a><a href="https://other.example/a/#s">2</a>`
		expect(outlinkHashes(html, BASE)).toEqual([hashOf("https://other.example/a")])
	})
	it("resolves relative links and skips in-page, mail and unparsable ones", () => {
		const html = `<a href="/posts/two">2</a><a href="#note-1">n</a>
			<a href="mailto:me@example.com">m</a><a href="http://[bad">x</a>`
		expect(outlinkHashes(html, BASE)).toEqual([hashOf("https://blog.example/posts/two")])
	})
	it("stops at the cap", () => {
		const html = Array.from(
			{ length: OUTLINKS_MAX + 20 },
			(_, i) => `<a href="https://other.example/${i}">${i}</a>`,
		).join("")
		expect(outlinkHashes(html, BASE)).toHaveLength(OUTLINKS_MAX)
	})
})

describe("articleOutlinks", () => {
	it("keeps each href as written beside its hash, once per href", () => {
		const html = `<a href="https://other.example/a/#s">1</a><a href="/posts/two">2</a>
			<a href="https://other.example/a/#s">3</a><a href="https://other.example/a">4</a><a href="#n">n</a>`
		expect(articleOutlinks(html, BASE)).toEqual([
			{ href: "https://other.example/a/#s", hash: hashOf("https://other.example/a") },
			{ href: "/posts/two", hash: hashOf("https://blog.example/posts/two") },
			{ href: "https://other.example/a", hash: hashOf("https://other.example/a") },
		])
	})
})
