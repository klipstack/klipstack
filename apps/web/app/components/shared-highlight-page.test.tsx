import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SharedHighlightPage, sharedHighlightView } from "./shared-highlight-page"

const A = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5b"
const B = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5c"
const C = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5d"

const view = sharedHighlightView({
	v: 1,
	exact: "A single meeting can blow a whole afternoon.",
	note: `Pairs with [Managing](/read/${A}), [Trap](/read/${B}) and [Gone](/read/${C}).`,
	includeNote: true,
	color: 2,
	article: {
		title: "Maker's Schedule",
		url: "https://paulgraham.com/makersschedule.html",
		siteName: null,
	},
	linkUrls: { [A]: "https://managing.example/high-performers", [B]: "javascript:alert(1)" },
	locale: "en",
})
const labels = {
	readArticle: "Read the article",
	noteLabel: "Note",
	madeWith: "Made with Klipstack",
	report: "Report this page",
	terms: "Terms",
	privacy: "Privacy",
}
const html = renderToStaticMarkup(
	<SharedHighlightPage
		id="Abc123def456"
		view={view}
		labels={labels}
		reportHref="/h/Abc123def456/report"
	/>,
)

describe("SharedHighlightPage", () => {
	it("links a note's links to the articles' originals, and only web addresses", () => {
		expect(html).toContain(
			'<a href="https://managing.example/high-performers" rel="nofollow ugc noopener"',
		)
		expect(html).toMatch(/>Managing<\/a>, Trap and Gone\./)
		expect(html).not.toContain("javascript")
		expect(html).not.toContain("/read/")
	})

	it("gives a visitor nothing of the sharer's library: no article ids, in the page or its data", () => {
		for (const id of [A, B, C]) {
			expect(html).not.toContain(id)
			expect(JSON.stringify(view)).not.toContain(id)
		}
	})

	it("marks every link out as user content, not endorsed, without a window handle", () => {
		const outbound = [...html.matchAll(/<a [^>]*href="https?:[^>]*>/g)].map((m) => m[0])
		expect(outbound.length).toBe(3)
		for (const a of outbound) expect(a).toContain('rel="nofollow ugc noopener"')
		expect(html).not.toContain("target=")
	})
})
