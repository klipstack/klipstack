import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { finishArticle } from "../src/pipeline"
import { sharedLink } from "../src/shared-link"
import { extractXPost } from "../src/x"

const fixture = (name: string) =>
	readFileSync(join(import.meta.dirname, "fixtures/x", `${name}.json`), "utf8")

const POST = "https://x.com/TheAtlantic/status/2099000000000000001"
const ESSAY = "https://www.theatlantic.com/technology/2026/10/openai-safety-resignation/684000/"

/** A real post's response with its text swapped for one that shares a link, as people post them. */
function wrapper(text: string, facets: object[]) {
	const body = JSON.parse(fixture("quote-tegmark"))
	const status = {
		...body.status,
		url: POST,
		id: "2099000000000000001",
		text,
		raw_text: { text, display_text_range: [0, text.length], facets },
		quote: null,
		media: null,
	}
	return JSON.stringify({ ...body, status, thread: [status] })
}

function facet(text: string, needle: string, rest: object) {
	const start = text.indexOf(needle)
	return { indices: [start, start + needle.length], ...rest }
}

const SHARE = `New in The Atlantic:

@dgrobinson resigned this week. He was among the longest-tenured employees at OpenAI—and oversaw safety reports on 12 frontier launches.

He is very worried: “The time for trial and error is over.”

You can read his essay here: https://t.co/abcdEFGH12`

const shareFacets = [
	facet(SHARE, "@dgrobinson", { type: "mention" }),
	facet(SHARE, "https://t.co/abcdEFGH12", {
		type: "url",
		original: "https://t.co/abcdEFGH12",
		replacement: ESSAY,
		display: "theatlantic.com/technology/202…",
	}),
]

describe("sharedLink", () => {
	it("finds the one page a short post passes along", () => {
		const post = extractXPost(wrapper(SHARE, shareFacets), POST)
		expect(sharedLink(post, POST)).toBe(ESSAY)
	})

	it("ignores mentions and tags, which stay on the post's site", () => {
		const text = "Read this, #ai folks, via @someone: https://t.co/x1"
		const post = extractXPost(
			wrapper(text, [
				facet(text, "#ai", { type: "hashtag" }),
				facet(text, "@someone", { type: "mention" }),
				facet(text, "https://t.co/x1", { type: "url", replacement: ESSAY, display: "x" }),
			]),
			POST,
		)
		expect(sharedLink(post, POST)).toBe(ESSAY)
	})

	it("keeps a post that says more than a few lines", () => {
		const long = `${"This is a long take on the essay. ".repeat(12)}https://t.co/x1`
		const post = extractXPost(
			wrapper(long, [facet(long, "https://t.co/x1", { type: "url", replacement: ESSAY })]),
			POST,
		)
		expect(sharedLink(post, POST)).toBeNull()
	})

	it("keeps a post that links to several pages", () => {
		const text = "Two good reads: https://t.co/a1 and https://t.co/b2"
		const post = extractXPost(
			wrapper(text, [
				facet(text, "https://t.co/a1", { type: "url", replacement: ESSAY }),
				facet(text, "https://t.co/b2", { type: "url", replacement: "https://example.com/b" }),
			]),
			POST,
		)
		expect(sharedLink(post, POST)).toBeNull()
	})

	it("counts one page linked twice, in different spellings, once", () => {
		const text = "Read https://t.co/a1 (or https://t.co/b2)"
		const post = extractXPost(
			wrapper(text, [
				facet(text, "https://t.co/a1", { type: "url", replacement: ESSAY }),
				facet(text, "https://t.co/b2", { type: "url", replacement: `${ESSAY}?utm_source=x` }),
			]),
			POST,
		)
		expect(sharedLink(post, POST)).toBe(ESSAY)
	})

	it("doesn't follow links inside a quoted post", () => {
		const post = extractXPost(
			fixture("quote-tegmark"),
			"https://x.com/tegmark/status/2098741280503144823",
		)
		expect(sharedLink(post, "https://x.com/tegmark/status/2098741280503144823")).toBeNull()
	})

	it("keeps a post with no link elsewhere", () => {
		const post = extractXPost(
			fixture("thread-jescalan"),
			"https://x.com/jescalan/status/2098166165000306728",
		)
		expect(sharedLink(post, "https://x.com/jescalan/status/2098166165000306728")).toBeNull()
	})

	it("reads any extractor's posts, and never articles", () => {
		const html = `<p>Worth a read: <a href="${ESSAY}">the essay</a> by <a href="https://social.example/@a">@a</a></p>`
		const fields = {
			title: "Worth a read",
			author: null,
			siteName: null,
			description: null,
			language: null,
			publishedAt: null,
			leadImageUrl: null,
			canonicalUrl: null,
		}
		const extractor = { name: "test", version: "1" }
		const post = finishArticle({ html, fields, extractor, type: "post", minWords: 1 })
		expect(sharedLink(post, "https://social.example/@b/1")).toBe(ESSAY)
		const article = finishArticle({ html, fields, extractor, minWords: 1 })
		expect(sharedLink(article, "https://social.example/@b/1")).toBeNull()
	})
})
