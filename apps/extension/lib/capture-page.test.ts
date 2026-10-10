// @vitest-environment jsdom
import { expect, it } from "vitest"
import { capturePage } from "./capture"

it("leaves scripts and hidden fields behind, and keeps the article and its JSON-LD", () => {
	document.documentElement.innerHTML =
		"<head><title>A</title>" +
		'<script>window.__STATE__ = { email: "me@example.com" }</script>' +
		'<script type="application/ld+json">{"author":"Ada"}</script></head>' +
		'<body><article><p>The article.</p></article><form><input type="hidden" name="csrf" value="t0ken"></form></body>'
	const { html } = capturePage()
	expect(html).toContain("<p>The article.</p>")
	expect(html).toContain('{"author":"Ada"}')
	expect(html).not.toContain("me@example.com")
	expect(html).not.toContain("t0ken")
	// The page itself is untouched.
	expect(document.querySelectorAll("script")).toHaveLength(2)
})
