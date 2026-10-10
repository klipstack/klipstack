import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { EditionView } from "~/lib/edition-view"
import { EditionPage, EditionText } from "./edition-page"

const view: EditionView = {
	locale: "es",
	title: "Lecturas de otoño",
	authorName: "Ada Reader",
	date: "1 de octubre de 2026",
	previous: null,
	next: null,
	updated: null,
	intro: "Lo que leí. [Uno](https://a.example/one) y [otro](javascript:alert(1)).",
	items: [
		{
			anchor: "item-1",
			layout: "lead",
			pullQuote: true,
			url: "https://a.example/one",
			title: "One <script>",
			kicker: "a.example",
			meta: ["A"],
			description: null,
			leadImageUrl: "https://img.example/1.jpg",
			note: "Links to [two](https://b.example/two).",
			highlights: [{ exact: "A quote.", note: "See [out](https://c.example)." }],
		},
		{
			anchor: "item-2",
			layout: "brief",
			pullQuote: false,
			url: "https://b.example/two",
			title: "Two",
			kicker: null,
			meta: [],
			description: null,
			leadImageUrl: null,
			note: null,
			highlights: [],
		},
	],
	anchors: { "https://a.example/one": "item-1", "https://b.example/two": "item-2" },
	madeWith: "Hecho con Klipstack",
	report: "Denunciar esta página",
	terms: "Términos",
	privacy: "Privacidad",
}

const html = renderToStaticMarkup(<EditionPage view={view} />)
const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0])

describe("EditionPage", () => {
	it("marks every link out as user content, not endorsed, without a window handle", () => {
		const outbound = links.filter((a) => /href="https?:/.test(a))
		expect(outbound.length).toBe(3)
		for (const a of outbound) expect(a).toContain('rel="nofollow ugc noopener"')
		expect(links.some((a) => a.includes("target="))).toBe(false)
	})

	it("points links to another item at its anchor", () => {
		expect(html).toContain('href="#item-1"')
		expect(html).toContain('href="#item-2"')
		expect(html).toContain('id="item-2"')
	})

	it("keeps anything else as text, escaped", () => {
		expect(html).not.toContain('href="javascript:')
		expect(html).toContain("[otro](javascript:alert(1))")
		expect(html).toContain("One &lt;script&gt;")
	})

	it("hotlinks lead images lazily, sending no referrer", () => {
		expect(html).toMatch(/<img [^>]*src="https:\/\/img.example\/1.jpg"/)
		expect(html).toMatch(/<img [^>]*loading="lazy"/)
		expect(html).toMatch(/<img [^>]*referrerPolicy="no-referrer"/i)
	})

	it("speaks the edition's language and offers no sign-up", () => {
		expect(html).toContain('lang="es"')
		expect(html).toContain('href="/"')
		expect(html).not.toMatch(/sign ?up|signup|regístrate/i)
	})

	it("puts the intro and the notes on the author's paper, and signs the intro only", () => {
		const intro = html.slice(html.indexOf('data-testid="edition-intro"'), html.indexOf("</header>"))
		expect(intro).toContain("Lo que leí.")
		expect(intro).toContain("— Ada Reader")
		// Once: inline, or in the margin when there is room, by CSS alone.
		const notes = html.match(/<div data-testid="edition-item-note"[^>]*>/g) ?? []
		expect(notes).toHaveLength(1)
		for (const el of [`<div ${intro}`, ...notes])
			expect(el.match(/class="([^"]*)"/)?.[1]).toContain("bg-note")
		expect(html.match(/— Ada Reader/g)).toHaveLength(1)
	})

	it("shows no numbers before the items", () => {
		expect(html).not.toMatch(/>\s*1\.\s*</)
	})

	it("links the author's other editions only when the view has them", () => {
		expect(html).not.toContain("edition-neighbors")
		const linked = renderToStaticMarkup(
			<EditionPage
				view={{
					...view,
					previous: { label: "Edición anterior", title: "Agosto", href: "/e/AAAAAAAAAAAA/agosto" },
					next: null,
				}}
			/>,
		)
		expect(linked).toMatch(/<a href="\/e\/AAAAAAAAAAAA\/agosto" rel="prev"/)
		expect(linked).toContain("← Edición anterior")
		expect(linked).not.toContain('rel="next"')
	})
})

describe("EditionText", () => {
	it("opens links in a new tab in the editor, but not links to an item", () => {
		const text = "See [out](https://c.example) and [two](https://b.example/two)."
		const html = renderToStaticMarkup(
			<EditionText text={text} anchors={{ "https://b.example/two": "item-2" }} newTab />,
		)
		expect(html).toMatch(/<a [^>]*href="https:\/\/c.example"[^>]*target="_blank"/)
		expect(html).toMatch(/<a href="#item-2"(?![^>]*target)/)
	})
})
