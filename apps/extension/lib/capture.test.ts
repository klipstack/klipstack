import { describe, expect, it, vi } from "vitest"
import { isCapturableUrl, isServerCapturedUrl, savePage, saveToKlipstack } from "./capture"

describe("savePage", () => {
	it("sends a page too large for the server as its address alone", async () => {
		const bodies: unknown[] = []
		const fetchImpl = (async (_: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)))
			return bodies.length === 1
				? new Response("Request body is too large.", { status: 413 })
				: new Response(JSON.stringify({ article: { id: "1" }, created: true }), { status: 202 })
		}) as unknown as typeof fetch
		const r = await savePage(
			"https://k",
			{ url: "https://a.example/p", html: "<html/>" },
			fetchImpl,
		)
		expect(r).toMatchObject({ ok: true, id: "1" })
		expect(bodies).toEqual([
			{ url: "https://a.example/p", html: "<html/>", source: "extension" },
			{ url: "https://a.example/p", html: null, source: "extension" },
		])
	})

	it("does not send it again for other refusals", async () => {
		let calls = 0
		const signedOut = (async () => {
			calls++
			return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 })
		}) as unknown as typeof fetch
		const page = { url: "https://a.example/p", html: "<html/>", servedHtml: "<html>all</html>" }
		expect(await savePage("https://k", page, signedOut)).toMatchObject({ ok: false, status: 401 })
		expect(calls).toBe(1)
	})
})

describe("savePage with the page as served", () => {
	it("drops the served page first, then the rendered one, when the server finds them too large", async () => {
		const bodies: unknown[] = []
		const fetchImpl = (async (_: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)))
			return bodies.length < 3
				? new Response("Request body is too large.", { status: 413 })
				: new Response(JSON.stringify({ article: { id: "1" }, created: true }), { status: 202 })
		}) as unknown as typeof fetch
		const r = await savePage(
			"https://k",
			{ url: "https://a.example/p", html: "<html/>", servedHtml: "<html>all</html>" },
			fetchImpl,
		)
		expect(r).toMatchObject({ ok: true, id: "1" })
		expect(bodies).toEqual([
			{
				url: "https://a.example/p",
				html: "<html/>",
				servedHtml: "<html>all</html>",
				source: "extension",
			},
			{ url: "https://a.example/p", html: "<html/>", source: "extension" },
			{ url: "https://a.example/p", html: null, source: "extension" },
		])
	})
})

describe("savePage refusals", () => {
	it("sends the address alone when the app refuses the page, and not for other refusals", async () => {
		const answers = [
			{ error: { code: "invalid_request", message: "The page may not exceed 10485760 bytes." } },
			{ article: { id: "2" }, created: true },
		]
		let calls = 0
		const fetchImpl = (async () => {
			const body = answers[calls++]!
			return new Response(JSON.stringify(body), { status: "error" in body ? 400 : 202 })
		}) as unknown as typeof fetch
		expect(
			await savePage("https://k", { url: "https://a.example", html: "<p/>" }, fetchImpl),
		).toMatchObject({ ok: true, id: "2" })
		const refused = (async () =>
			new Response(JSON.stringify({ error: { code: "unsupported_youtube", message: "No." } }), {
				status: 422,
			})) as unknown as typeof fetch
		expect(
			await savePage("https://k", { url: "https://youtube.com/watch?v=1", html: "<p/>" }, refused),
		).toMatchObject({ ok: false, status: 422, error: "unsupported_youtube" })
		const capped = (async () =>
			new Response(
				JSON.stringify({
					error: { code: "limit_reached", message: "Full.", details: { limit: "storage" } },
				}),
				{ status: 403 },
			)) as unknown as typeof fetch
		expect(
			await savePage("https://k", { url: "https://a.example", html: "<p/>" }, capped),
		).toMatchObject({ ok: false, status: 403, error: "limit_reached", limit: "storage" })
	})
})

describe("saveToKlipstack", () => {
	it("posts url + html with the browser's cookies and returns the read url", async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe("https://klip.example/api/documents")
			expect(init?.headers).toEqual({ "content-type": "application/json" })
			expect(init?.credentials).toBe("include")
			expect(JSON.parse(String(init?.body))).toMatchObject({
				url: "https://x.com/a",
				html: "<html/>",
				source: "extension",
			})
			return new Response(JSON.stringify({ article: { id: "1" }, created: true }), {
				status: 202,
			})
		}) as unknown as typeof fetch
		const r = await saveToKlipstack(
			"https://klip.example",
			{ url: "https://x.com/a", html: "<html/>" },
			fetchImpl,
		)
		expect(r).toEqual({ ok: true, status: 202, id: "1", readUrl: "https://klip.example/read/1" })
	})
	it("surfaces api errors and network failures", async () => {
		const signedOut = (async () =>
			new Response(
				JSON.stringify({ error: { code: "unauthorized", message: "Sign in to Klipstack first." } }),
				{ status: 401 },
			)) as unknown as typeof fetch
		expect(await saveToKlipstack("https://k", { url: "https://x.com" }, signedOut)).toMatchObject({
			ok: false,
			status: 401,
			error: "unauthorized",
		})
		const down = (async () => {
			throw new Error("boom")
		}) as unknown as typeof fetch
		expect(await saveToKlipstack("https://k", { url: "https://x.com" }, down)).toMatchObject({
			ok: false,
			status: 0,
			error: "boom",
		})
	})
})

describe("isServerCapturedUrl", () => {
	it("matches X, not look-alikes", () => {
		expect(isServerCapturedUrl("https://x.com/a/status/1")).toBe(true)
		expect(isServerCapturedUrl("https://www.twitter.com/a/status/1")).toBe(true)
		expect(isServerCapturedUrl("https://notx.com/a")).toBe(false)
		expect(isServerCapturedUrl("https://example.com")).toBe(false)
	})
})

describe("isCapturableUrl", () => {
	it("accepts http(s) only", () => {
		expect(isCapturableUrl("https://a.com")).toBe(true)
		expect(isCapturableUrl("chrome://extensions")).toBe(false)
		expect(isCapturableUrl(undefined)).toBe(false)
	})
})
