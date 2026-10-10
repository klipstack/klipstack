import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalText } from "@klipstack/anchor"
import { JSDOM } from "jsdom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ExtractError } from "../src/errors"
import { extractXPost, fetchXPost } from "../src/x"

// Real FxTwitter /2/thread responses.
const fixture = (name: string) =>
	readFileSync(join(import.meta.dirname, "fixtures/x", `${name}.json`), "utf8")
const bodyOf = (html: string) =>
	new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body

describe("extractXPost", () => {
	it("joins a thread into one document, in order", () => {
		const a = extractXPost(
			fixture("thread-jescalan"),
			"https://x.com/jescalan/status/2098166165000306728",
		)
		expect(a.title).toBe("Rant time 😈")
		expect(a.author).toBe("Jeff Escalante")
		expect(a.siteName).toBe("X.com")
		expect(a.type).toBe("post")
		expect(a.canonicalUrl).toBe("https://x.com/jescalan/status/2098166165000306728")
		expect(a.publishedAt).toBeInstanceOf(Date)
		const text = a.text
		const first = text.indexOf("I implemented and shipped support for MCP at Clerk")
		const last = text.indexOf("I REALLY appreciate all the replies")
		expect(first).toBeGreaterThan(-1)
		expect(last).toBeGreaterThan(first)
		expect(a.wordCount).toBeGreaterThan(1500)
		const body = bodyOf(a.html)
		expect(body.querySelector("em")?.textContent).toBe("Rant time 😈")
		expect(body.querySelector("strong")?.textContent).toBe("very strongly against MCP")
	})

	it("renders a quoted post as a blockquote with its author", () => {
		const a = extractXPost(
			fixture("quote-tegmark"),
			"https://x.com/tegmark/status/2098741280503144823",
		)
		const quote = bodyOf(a.html).querySelector("blockquote")
		expect(quote?.textContent).toContain("Dwarkesh Patel @dwarkesh_sp")
		expect(quote?.textContent).toContain("3 consecutive secret AI civilizations")
		const link = quote?.querySelector('a[href="https://www.dwarkesh.com/p/openai-huggingface"]')
		expect(link?.textContent).toBe("dwarkesh.com/p/openai-huggi…")
		expect(a.text.indexOf("stochastic parrots")).toBeLessThan(a.text.indexOf("civilizations"))
	})

	it("renders a long-form article with structure and images", () => {
		const a = extractXPost(
			fixture("article-thedankoe"),
			"https://x.com/thedankoe/status/2010751592346030461",
		)
		expect(a.title).toBe("How to fix your entire life in 1 day")
		expect(a.type).toBe("article")
		expect(a.leadImageUrl).toBe("https://pbs.twimg.com/media/G-efypCbQAEEi8a.jpg")
		const body = bodyOf(a.html)
		expect(body.querySelectorAll("h2").length).toBeGreaterThanOrEqual(7)
		expect(body.querySelectorAll("blockquote").length).toBeGreaterThan(0)
		expect(body.querySelectorAll("ul li, ol li").length).toBeGreaterThan(0)
		expect(body.querySelectorAll("img").length).toBe(3)
		expect(body.querySelector("hr")).not.toBeNull()
		expect(body.querySelector('a[href="https://letters.thedankoe.com/"]')?.textContent).toBe(
			"join here.",
		)
		expect(a.wordCount).toBeGreaterThan(5000)
	})

	it("keeps photos and drops the pic.x.com link", () => {
		const a = extractXPost(
			fixture("photo-ellen"),
			"https://x.com/TheEllenShow/status/440322224407314432",
		)
		const body = bodyOf(a.html)
		expect(body.querySelector("img")?.getAttribute("src")).toContain("pbs.twimg.com/media/")
		expect(a.text).not.toContain("t.co")
		expect(a.text).not.toContain("pic.x.com")
		expect(body.querySelector('a[href="https://x.com/hashtag/oscars"]')?.textContent).toBe(
			"#oscars",
		)
		expect(a.leadImageUrl).toContain("pbs.twimg.com/media/")
	})

	it("produces safe HTML whose canonical text round-trips", () => {
		for (const name of ["thread-jescalan", "quote-tegmark", "article-iampascio", "photo-ellen"]) {
			const a = extractXPost(fixture(name), "https://x.com/i/status/1")
			const body = bodyOf(a.html)
			expect(body.querySelector("script, iframe, h1"), name).toBeNull()
			expect(canonicalText(body), name).toBe(a.text)
		}
	})

	it("escapes post text", () => {
		const json = JSON.stringify({
			code: 200,
			status: {
				id: "1",
				text: "<img src=x onerror=alert(1)> & friends",
				author: { id: "9", name: "A", screen_name: "a" },
			},
			thread: null,
		})
		const a = extractXPost(json, "https://x.com/a/status/1")
		expect(bodyOf(a.html).querySelector("img")).toBeNull()
		expect(a.text).toContain("<img src=x onerror=alert(1)> & friends")
	})
})

describe("fetchXPost", () => {
	afterEach(() => vi.unstubAllGlobals())

	it("maps deleted and protected posts to permanent http errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ code: 404, status: null }), { status: 200 })),
		)
		const error = await fetchXPost("https://x.com/a/status/1").catch((e) => e)
		expect(error).toBeInstanceOf(ExtractError)
		expect(error).toMatchObject({ code: "http_error", status: 404 })
	})

	it("asks the thread endpoint by post id", async () => {
		const fetchMock = vi.fn(async () => new Response(fixture("photo-ellen"), { status: 200 }))
		vi.stubGlobal("fetch", fetchMock)
		const r = await fetchXPost("https://twitter.com/TheEllenShow/status/440322224407314432?s=20")
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
			"https://api.fxtwitter.com/2/thread/440322224407314432",
		)
		expect(r.threadComplete).toBe(true)
	})

	it("retries a failed thread lookup, then settles for the opening post", async () => {
		// quote-tegmark was captured during a failed lookup: `thread: null`.
		const responses = [fixture("quote-tegmark"), fixture("thread-jescalan")]
		const flaky = vi.fn(async () => new Response(responses.shift(), { status: 200 }))
		vi.stubGlobal("fetch", flaky)
		const r = await fetchXPost("https://x.com/jescalan/status/2098166165000306728", {
			retryDelayMs: 0,
		})
		expect(flaky).toHaveBeenCalledTimes(2)
		expect(JSON.parse(r.json).thread).toHaveLength(11)

		const failing = vi.fn(async () => new Response(fixture("quote-tegmark"), { status: 200 }))
		vi.stubGlobal("fetch", failing)
		const s = await fetchXPost("https://x.com/tegmark/status/2098741280503144823", {
			retryDelayMs: 0,
		})
		expect(failing).toHaveBeenCalledTimes(4)
		expect(s.threadComplete).toBe(false)
		expect(JSON.parse(s.json).status.id).toBe("2098741280503144823")
	})
})
