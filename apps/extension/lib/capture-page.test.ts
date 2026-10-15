// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { capturePage } from "./capture"

const rendered =
	'<head><title>A</title><meta property="og:type" content="article">' +
	'<script>window.__STATE__ = { email: "me@example.com" }</script>' +
	'<script type="application/ld+json">{"author":"Ada"}</script></head>' +
	'<body><article><p>The article.</p></article><form><input type="hidden" name="csrf" value="t0ken"></form></body>'

afterEach(() => {
	vi.unstubAllGlobals()
})

const serving = (
	body: string | Uint8Array<ArrayBuffer>,
	init: ResponseInit = { headers: { "content-type": "text/html" } },
	url = location.href,
) => {
	const fetchImpl = vi.fn(async () => {
		const res = new Response(body, init)
		Object.defineProperty(res, "url", { value: url })
		return res
	})
	vi.stubGlobal("fetch", fetchImpl)
	return fetchImpl
}

it("leaves scripts and hidden fields behind, and keeps the article and its JSON-LD", async () => {
	serving("")
	document.documentElement.innerHTML = rendered
	const { html } = await capturePage()
	expect(html).toContain("<p>The article.</p>")
	expect(html).toContain('{"author":"Ada"}')
	expect(html).not.toContain("me@example.com")
	expect(html).not.toContain("t0ken")
	// The page itself is untouched.
	expect(document.querySelectorAll("script")).toHaveLength(2)
})

it("also sends the page as the site served it, with the same things left behind", async () => {
	const fetchImpl = serving(
		"<!doctype html><html><head><title>A</title>" +
			'<script>window.__STATE__ = { token: "s3ssion" }</script>' +
			'<script type="application/ld+json">{"author":"Ada"}</script></head>' +
			"<body><article><p>The article.</p><p>The rest, which the paywall hides.</p></article>" +
			'<input type="hidden" name="csrf" value="t0ken"></body></html>',
	)
	document.documentElement.innerHTML = rendered
	const { html, servedHtml } = await capturePage()
	expect(fetchImpl).toHaveBeenCalledWith(location.href, expect.anything())
	expect(html).not.toContain("which the paywall hides")
	expect(servedHtml).toMatch(/^<!DOCTYPE html>\n<html>/)
	expect(servedHtml).toContain("<p>The rest, which the paywall hides.</p>")
	expect(servedHtml).toContain('{"author":"Ada"}')
	expect(servedHtml).toContain(`<base href="${location.href}">`)
	expect(servedHtml).not.toContain("s3ssion")
	expect(servedHtml).not.toContain("t0ken")
})

it("sends the rendered page alone when the page can't be fetched again as HTML", async () => {
	document.documentElement.innerHTML = rendered
	serving("<p>Not found</p>", { status: 404, headers: { "content-type": "text/html" } })
	expect((await capturePage()).servedHtml).toBeNull()
	serving("%PDF-1.7", { headers: { "content-type": "application/pdf" } })
	expect((await capturePage()).servedHtml).toBeNull()
	// Redirected to another page: a sign-in, say.
	serving("<p>Sign in</p>", undefined, "https://example.com/login")
	expect((await capturePage()).servedHtml).toBeNull()
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new TypeError("Failed to fetch")
		}),
	)
	const { html, servedHtml } = await capturePage()
	expect(servedHtml).toBeNull()
	expect(html).toContain("<p>The article.</p>")
})

it("does not fetch a page again unless it says it is an article", async () => {
	const fetchImpl = serving("<p>The page again</p>")
	document.documentElement.innerHTML = rendered.replace(
		'<meta property="og:type" content="article">',
		'<meta property="og:type" content="website">',
	)
	expect((await capturePage()).servedHtml).toBeNull()
	expect(fetchImpl).not.toHaveBeenCalled()
	// Paid content in its JSON-LD is an article.
	document.head.insertAdjacentHTML(
		"beforeend",
		'<script type="application/ld+json">{"@type":"WebPage","isAccessibleForFree":false}</script>',
	)
	expect((await capturePage()).servedHtml).toContain("The page again")
})

it("reads the page again in the charset it declares", async () => {
	document.documentElement.innerHTML = rendered
	// "Año" in windows-1252, declared in the page's <meta>, not in the HTTP header.
	const head = new TextEncoder().encode(
		'<html><head><meta charset="windows-1252"></head><body><p>A',
	)
	const tail = new TextEncoder().encode("o</p></body></html>")
	serving(new Uint8Array([...head, 0xf1, ...tail]))
	expect((await capturePage()).servedHtml).toContain("<p>Año</p>")
})
