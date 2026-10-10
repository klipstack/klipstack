import { canonicalText } from "@klipstack/anchor"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { type ReaderHighlight, readerHtml } from "../lib/reader-html"
import type { PageMessage, PageSelection } from "./messages"

/**
 * The reader page as the app writes it, with the bundled script running (src/lib/
 * reader-page.generated.ts, which a test keeps in step with src/page), and the messages it posts.
 * jsdom has no CSS Custom Highlight API: a registry stands in, to see what is painted.
 */
function openPage(html: string, highlights: ReaderHighlight[] = []) {
	const messages: PageMessage[] = []
	const registry = new Map<string, { ranges: Range[] }>()
	const dom = new JSDOM(readerHtml({ title: "Title", byline: "", html, highlights }), {
		runScripts: "dangerously",
		pretendToBeVisual: true,
		beforeParse(window) {
			Object.assign(window, {
				ReactNativeWebView: { postMessage: (m: string) => messages.push(JSON.parse(m)) },
				scrollTo: () => {},
				Highlight: class {
					ranges: Range[]
					priority = 0
					constructor(...ranges: Range[]) {
						this.ranges = ranges
					}
				},
			})
			Object.assign(window.CSS, { highlights: registry })
			// jsdom lays nothing out.
			Object.assign(window.Range.prototype, { getClientRects: () => [] })
		},
	})
	const { window } = dom
	const article = window.document.querySelector("article")!
	/** The text of each highlight painted in a color (0 is yellow). */
	const painted = (color: number) =>
		registry.get(`klip-c${color}`)?.ranges.map((range) => range.toString()) ?? []
	return { window, article, messages, painted, registry }
}

/** The article's text as the server stores it (packages/extract: `canonicalText` in jsdom). */
const storedText = (html: string) =>
	canonicalText(new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body)

/** A highlight of `quote`, at its `nth` place (0 is the first) in the stored text. */
function highlightOf(
	html: string,
	id: string,
	quote: string,
	color: ReaderHighlight["color"] = "yellow",
	nth = 0,
): ReaderHighlight {
	const text = storedText(html)
	let start = -1
	for (let i = 0; i <= nth; i++) start = text.indexOf(quote, start + 1)
	if (start === -1) throw new Error(`"${quote}" is not in the text`)
	const end = start + quote.length
	return {
		id,
		quote,
		color,
		prefix: text.slice(Math.max(0, start - 32), start),
		suffix: text.slice(end, end + 32),
		start,
		end,
	}
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Selects from one text point to another, and returns what the page reports once it settles. */
async function select(
	page: ReturnType<typeof openPage>,
	from: [Node, number],
	to: [Node, number],
): Promise<PageSelection | null> {
	const { window, messages } = page
	window.getSelection()!.setBaseAndExtent(from[0], from[1], to[0], to[1])
	window.document.dispatchEvent(new window.Event("selectionchange"))
	await settle(200)
	const reports = messages.filter((m) => m.type === "selection")
	return reports.at(-1)?.selection ?? null
}

/** The first text node inside the element that matches. */
const textIn = (root: Element, selector: string) => root.querySelector(selector)!.firstChild as Text

describe("the reader page: selecting", () => {
	// Blocks with nothing between them, as extraction often leaves them: "here.Second".
	const TIGHT =
		'<p>First paragraph ends here.</p><p>Second <em>paragraph</em> starts here.</p><figure><img src="/assets/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" alt=""><figcaption>A caption.</figcaption></figure>'

	it("reports a selection across paragraphs as its place in the stored text", async () => {
		const page = openPage(TIGHT)
		const [first, second] = Array.from(page.article.querySelectorAll("p"))
		const selection = await select(page, [first!.firstChild!, 6], [textIn(second!, "em"), 4])
		const text = storedText(TIGHT)
		expect(canonicalText(page.article)).toBe(text)
		expect(selection).toEqual({
			start: 6,
			end: text.indexOf("paragraph starts") + 4,
			exact: "paragraph ends here.Second para",
			prefix: "First ",
			suffix: "graph starts here.A caption.",
		})
		expect(text.slice(selection!.start, selection!.end)).toBe(selection!.exact)
	})

	it("leaves the whitespace at its ends out, and reports nothing outside the article", async () => {
		const html = "<p>One two.</p>\n<p>Three four.</p>"
		const page = openPage(html)
		const [first, second] = Array.from(page.article.querySelectorAll("p"))
		const newline = first!.nextSibling as Text
		const selection = await select(page, [first!.firstChild!, 4], [second!.firstChild!, 0])
		expect(selection).toMatchObject({ exact: "two.", start: 4, end: 8 })
		expect(await select(page, [newline, 0], [newline, 1])).toBeNull()
		const title = page.window.document.querySelector("h1")!.firstChild!
		expect(await select(page, [title, 0], [title, 3])).toBeNull()
	})
})

describe("the reader page: highlights", () => {
	const HTML = "<p>Alpha beta gamma.</p><p>Delta epsilon zeta.</p><p>Eta theta.</p>"

	it("paints each at its place: across paragraphs, overlapping and adjacent", () => {
		const across = highlightOf(HTML, "across", "gamma.Delta")
		const overlapping = highlightOf(HTML, "overlapping", "Delta epsilon", "green")
		const adjacent = highlightOf(HTML, "adjacent", " zeta.", "green")
		const page = openPage(HTML, [across, overlapping, adjacent])
		expect(page.painted(0)).toEqual(["gamma.Delta"])
		expect(page.painted(1)).toEqual(["Delta epsilon", " zeta."])
	})

	it("paints a repeated passage at its place, or where its context matches when that moved", () => {
		const html = "<p>The cat sat.</p><p>The cat ran.</p><p>The cat slept.</p>"
		const second = highlightOf(html, "second", "The cat", "yellow", 1)
		// Offsets from another version (the text moved): the context finds the third one.
		const third = { ...highlightOf(html, "third", "The cat", "blue", 2), start: 3, end: 10 }
		const page = openPage(html, [second, third])
		const blocks = Array.from(page.article.querySelectorAll("p"))
		const [yellow] = page.registry.get("klip-c0")!.ranges
		const [blue] = page.registry.get("klip-c2")!.ranges
		expect(yellow!.startContainer.parentElement).toBe(blocks[1])
		expect(blue!.startContainer.parentElement).toBe(blocks[2])
	})

	it("leaves out a highlight whose passage is gone, and repaints what it is given", () => {
		const gone = { ...highlightOf(HTML, "gone", "Alpha beta"), quote: "Omega", start: 50 }
		const kept = highlightOf(HTML, "kept", "Eta theta")
		const page = openPage(HTML, [gone, kept])
		expect(page.painted(0)).toEqual(["Eta theta"])
		page.window.eval("window.klipHighlights([])")
		expect(page.registry.has("klip-c0")).toBe(false)
	})

	it("puts the one being edited in focus, in its color, with a box around each line", () => {
		const page = openPage(HTML, [highlightOf(HTML, "blue", "Delta epsilon", "blue")])
		const line = { left: 20, top: 40, width: 90, height: 24, right: 110, bottom: 64 }
		// Two lines of the highlight.
		Object.assign(page.window.Range.prototype, {
			getClientRects: () => [line, { ...line, top: 70, bottom: 94 }],
		})
		page.window.eval('window.klipActive("blue")')
		expect(page.article.getAttribute("data-focus")).toBe("2")
		expect(page.registry.get("klip-active")).toMatchObject({ priority: 1 })
		const boxes = Array.from(page.window.document.querySelectorAll<HTMLElement>(".hl-pop"))
		expect(boxes.map((box) => [box.dataset.color, box.style.top])).toEqual([
			["2", "40px"],
			["2", "70px"],
		])
		page.window.eval("window.klipActive(null)")
		expect(page.article.hasAttribute("data-focus")).toBe(false)
		expect(page.registry.has("klip-active")).toBe(false)
		expect(page.window.document.querySelectorAll(".hl-pop")).toHaveLength(0)
	})

	it("a tap on overlapping highlights opens the smaller; just after one, none", () => {
		const long = highlightOf(HTML, "long", "Delta epsilon zeta.")
		const short = highlightOf(HTML, "short", "epsilon", "pink")
		const page = openPage(HTML, [long, short])
		const node = page.article.querySelectorAll("p")[1]!.firstChild as Text
		const tapAt = (offset: number) => {
			const caret = page.window.document.createRange()
			caret.setStart(node, offset)
			Object.assign(page.window.document, { caretRangeFromPoint: () => caret })
			page.messages.length = 0
			page.window.document.body.dispatchEvent(
				new page.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			)
			return page.messages
		}
		expect(tapAt(node.data.indexOf("psilon"))).toEqual([{ type: "highlight", id: "short" }])
		expect(tapAt(1)).toEqual([{ type: "highlight", id: "long" }])
		expect(tapAt(node.data.length)).toEqual([{ type: "controls", shown: false }])
		// With a highlight open, a tap off the highlights closes it.
		page.window.eval('window.klipActive("short")')
		expect(tapAt(node.data.length)).toEqual([{ type: "outside" }])
		expect(tapAt(1)).toEqual([{ type: "highlight", id: "long" }])
	})
})

describe("the reader page: reading and links", () => {
	it("tells the app where the reader is after a scroll", async () => {
		const { window, messages } = openPage("<p>Text.</p>")
		await settle(50)
		messages.length = 0
		window.dispatchEvent(new window.Event("scroll"))
		await settle(300)
		expect(messages).toContainEqual(expect.objectContaining({ type: "reading" }))
		expect(messages.some((m) => m.type === "selection")).toBe(false)
	})

	it("hands a mail link to the app, and follows no other scheme", () => {
		const { window, messages } = openPage(
			'<p><a href="mailto:ada@example.com">Mail</a> <a href="tel:123">Call</a></p>',
		)
		const [mail, call] = Array.from(window.document.querySelectorAll("a"))
		const click = (a: Element) =>
			a.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
		expect(click(mail!)).toBe(false)
		expect(click(call!)).toBe(false)
		expect(messages).toContainEqual({ type: "mail", href: "mailto:ada@example.com" })
		expect(messages.filter((m) => m.type === "link")).toEqual([])
	})

	it("draws the end of the article as the app says, and hands its taps to the app", () => {
		const { window, messages } = openPage("<p>Text.</p>")
		const page = window as unknown as { klipEnd: (end: unknown) => void }
		const end = window.document.getElementById("klip-end")!
		expect(end.textContent).toBe("")
		page.klipEnd({ state: "finishing", archived: false, starred: false, shortlisted: true })
		expect(end.textContent).toContain("It goes to your archive when you leave.")
		expect(end.textContent).toContain("In Next Edition")
		messages.length = 0
		const tap = (action: string) =>
			end
				.querySelector(`[data-end="${action}"]`)!
				.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		tap("keep")
		tap("star")
		tap("share")
		// A tap in the block doesn't show or hide the app's controls.
		expect(messages).toEqual([
			{ type: "end", action: "keep" },
			{ type: "end", action: "star" },
			{ type: "end", action: "share" },
		])
		page.klipEnd({ state: "early", archived: true, starred: true, shortlisted: false })
		expect(end.querySelector('[data-end="finish"]')?.textContent).toBe("Mark as Finished")
		expect(end.textContent).toContain("Starred")
	})

	it("offers the note for the next edition once marked, as the user wrote it, and taps open it", () => {
		const { window, messages } = openPage("<p>Text.</p>")
		const page = window as unknown as { klipEnd: (end: unknown) => void }
		const end = window.document.getElementById("klip-end")!
		const base = { state: "kept", archived: false, starred: false }
		page.klipEnd({ ...base, shortlisted: false, editionNote: "Hidden." })
		expect(end.querySelector(".end-edition")).toBeNull()

		page.klipEnd({ ...base, shortlisted: true, editionNote: null })
		expect(end.querySelector(".end-edition-title")?.textContent).toBe("Added to your next edition")
		const empty = end.querySelector('[data-end="edition-note"]')!
		expect(empty.className).toContain("empty")
		expect(empty.textContent).toMatch(/^Optional: a rough note/)

		// Written: its text, links as their words, nothing of it as markup.
		page.klipEnd({
			...base,
			shortlisted: true,
			editionNote: 'Read <b>this</b> & [the chart](https://a.example/c) "now"',
		})
		const written = end.querySelector('[data-end="edition-note"]')!
		expect(written.className).not.toContain("empty")
		expect(written.textContent).toBe('Read <b>this</b> & the chart "now"')
		expect(written.querySelector("b")).toBeNull()

		messages.length = 0
		written.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		expect(messages).toEqual([{ type: "end", action: "edition-note" }])
	})

	it("scrolls what marking opened into view, only when marked with its button", () => {
		const { window } = openPage("<p>Text.</p>")
		const page = window as unknown as { klipEnd: (end: unknown) => void }
		const end = window.document.getElementById("klip-end")!
		const scrolled: Element[] = []
		window.Element.prototype.scrollIntoView = function (this: Element) {
			scrolled.push(this)
		}
		const base = { state: "kept", archived: false, starred: false }
		page.klipEnd({ ...base, shortlisted: false })
		end
			.querySelector('[data-end="shortlist"]')!
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		page.klipEnd({ ...base, shortlisted: true })
		expect(scrolled.map((el) => el.className)).toEqual(["end-edition"])
		// Drawn again (the note changed), or marked elsewhere: no scroll.
		page.klipEnd({ ...base, shortlisted: true, editionNote: "Why." })
		expect(scrolled).toHaveLength(1)
	})
})
