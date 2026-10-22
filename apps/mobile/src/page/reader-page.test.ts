import { canonicalText } from "@klipstack/anchor"
import { NOTE_MAX } from "@klipstack/api-contract/names"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { type ReaderHighlight, type ReaderPage, readerHtml } from "../lib/reader-html"
import type { PageMessage, PageSelection } from "./messages"
import { fieldText, postItSize } from "./takeaway"

/**
 * The reader page as the app writes it, with the bundled script running (src/lib/
 * reader-page.generated.ts, which a test keeps in step with src/page), and the messages it posts.
 * jsdom has no CSS Custom Highlight API: a registry stands in. Nor does it lay anything out: a
 * stand-in puts each block on lines of its own, 100 points apart, and each character 10 points
 * wide, so a stroke's place says which text it marks.
 */
function openPage(
	html: string,
	highlights: ReaderHighlight[] = [],
	more: Partial<ReaderPage> = {},
) {
	const messages: PageMessage[] = []
	const registry = new Map<string, { ranges: Range[] }>()
	const dom = new JSDOM(readerHtml({ title: "Title", byline: "", html, highlights, ...more }), {
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
			// The article's column ends 600 points in.
			const box = window.HTMLElement.prototype.getBoundingClientRect
			window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
				if (this.tagName !== "ARTICLE") return box.call(this)
				return { ...box.call(this), right: 600 - window.scrollX } as DOMRect
			}
			Object.assign(window.Range.prototype, {
				getClientRects(this: Range) {
					const node = this.startContainer
					if (node.nodeType !== 3 || node !== this.endContainer) return []
					const block = node.parentElement!
					const blocks = Array.from(block.ownerDocument.querySelectorAll("article *"))
					// Where it is on screen: the page scrolled moves it up.
					const top = 100 * blocks.indexOf(block) - window.scrollY
					return [
						{ left: 10 * this.startOffset, right: 10 * this.endOffset, top, bottom: top + 20 },
					].map((r) => ({ ...r, width: r.right - r.left, height: 20 }))
				},
			})
		},
	})
	const { window } = dom
	const article = window.document.querySelector("article")!
	/** The highlights painted in a color (0 is yellow), by id. */
	const painted = (color: number) =>
		Array.from(
			window.document.querySelectorAll<HTMLElement>(`.hl-inks i[data-color="${color}"]`),
		).map((i) => i.dataset.id)
	/**
	 * The strokes of a highlight on screen: the block each marks (by its top), and the character it
	 * starts at (the pen lands a little before it).
	 */
	const strokes = (id: string) =>
		Array.from(window.document.querySelectorAll<HTMLElement>(`.hl-ink[data-key="${id}"]`)).map(
			(el) => ({
				block: Math.floor(Number.parseFloat(el.style.top) / 100),
				left: Math.ceil(Number.parseFloat(el.style.left) / 10) || 0,
			}),
		)
	return { window, article, messages, painted, strokes, registry }
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

const TOPIC = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
const NEXT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"

const SHELF = {
	topic: { id: TOPIC, name: "Writing" },
	unread: 1,
	items: [
		{
			id: NEXT,
			title: "Next",
			siteName: null,
			url: "https://example.com/next",
			readingMinutes: 4,
			readerUrl: `https://klipstack.test/read/${NEXT}`,
		},
	],
}

/** A page of 3,000 points on a screen of 1,000, with its shelf (if any) 400 tall. jsdom lays nothing out. */
function sized(window: ReturnType<typeof openPage>["window"]) {
	const el = window.document.documentElement
	Object.defineProperty(el, "scrollHeight", { value: 3000 })
	Object.defineProperty(el, "clientHeight", { value: 1000 })
	const shelf = window.document.getElementById("klip-shelf")
	if (shelf) Object.defineProperty(shelf, "offsetHeight", { value: 400 })
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

	it("paints each at its place with a stroke per line: across paragraphs, overlapping and adjacent", () => {
		const across = highlightOf(HTML, "across", "gamma.Delta")
		const overlapping = highlightOf(HTML, "overlapping", "Delta epsilon", "green")
		const adjacent = highlightOf(HTML, "adjacent", " zeta.", "green")
		const page = openPage(HTML, [across, overlapping, adjacent])
		expect(page.painted(0)).toEqual(["across"])
		expect(page.painted(1)).toEqual(["overlapping", "adjacent"])
		// "gamma." ends the first paragraph (11 characters in), "Delta" starts the second.
		expect(page.strokes("across")).toEqual([
			{ block: 0, left: 11 },
			{ block: 1, left: 0 },
		])
		expect(page.strokes("adjacent")).toEqual([{ block: 1, left: 13 }])
		// Where two highlights' strokes lie on each other, the ink is deeper: "Delta", and where the
		// pen lifting past one end meets the next.
		const crossings = page.window.document.querySelectorAll<HTMLElement>(".hl-cross")
		expect(Array.from(crossings, (c) => c.dataset.key).sort()).toEqual([
			"across overlapping",
			"adjacent overlapping",
		])
	})

	it("paints a repeated passage at its place, or where its context matches when that moved", () => {
		const html = "<p>The cat sat.</p><p>The cat ran.</p><p>The cat slept.</p>"
		const second = highlightOf(html, "second", "The cat", "yellow", 1)
		// Offsets from another version (the text moved): the context finds the third one.
		const third = { ...highlightOf(html, "third", "The cat", "blue", 2), start: 3, end: 10 }
		const page = openPage(html, [second, third])
		expect(page.strokes("second").map((s) => s.block)).toEqual([1])
		expect(page.strokes("third").map((s) => s.block)).toEqual([2])
	})

	it("leaves out a highlight whose passage is gone, and repaints what it is given", () => {
		const gone = { ...highlightOf(HTML, "gone", "Alpha beta"), quote: "Omega", start: 50 }
		const kept = highlightOf(HTML, "kept", "Eta theta")
		const page = openPage(HTML, [gone, kept])
		expect(page.painted(0)).toEqual(["kept"])
		page.window.eval("window.klipHighlights([])")
		expect(page.painted(0)).toEqual([])
		expect(page.window.document.querySelectorAll(".hl-ink")).toHaveLength(0)
	})

	it("draws in a highlight made while the page is open, not those it opened with", async () => {
		const old = highlightOf(HTML, "old", "Alpha")
		const page = openPage(HTML, [old])
		const made = highlightOf(HTML, "made", "Eta theta", "pink")
		page.window.eval(`window.klipHighlights(${JSON.stringify([old, made])})`)
		const fresh = (id: string) =>
			page.window.document.querySelector<HTMLElement>(`.hl-ink[data-key="${id}"]`)!.dataset.fresh
		expect(fresh("old")).toBeUndefined()
		expect(fresh("made")).toBe("")
		// Once drawn in, never again: a band shown again comes back without the mark.
		await new Promise((resolve) => setTimeout(resolve, 1600))
		expect(fresh("made")).toBeUndefined()
	})

	it("tabs a highlight with a note at its first line, and a tap on the tab opens it", () => {
		const noted = { ...highlightOf(HTML, "noted", "beta gamma.Delta", "blue"), note: "Why" }
		const plain = highlightOf(HTML, "plain", "Eta")
		const page = openPage(HTML, [noted, plain])
		const tabs = Array.from(page.window.document.querySelectorAll<HTMLElement>(".hl-tab"))
		// Past the column's right edge, as tall as the first line's text.
		expect(
			tabs.map((tab) => [
				tab.dataset.id,
				tab.dataset.color,
				tab.style.left,
				tab.style.top,
				tab.style.height,
			]),
		).toEqual([["noted", "2", "600px", "0px", "20px"]])
		tabs[0]!.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }))
		expect(page.messages).toContainEqual({ type: "highlight", id: "noted" })
		// The note gone, the tab goes.
		page.window.eval(`window.klipHighlights(${JSON.stringify([{ ...noted, note: "" }, plain])})`)
		expect(page.window.document.querySelectorAll(".hl-tab")).toHaveLength(0)
	})

	it("puts the one being edited in focus, in its color, with a line around each stroke", () => {
		const page = openPage(HTML, [
			highlightOf(HTML, "blue", "zeta.Eta", "blue"),
			{ ...highlightOf(HTML, "other", "epsilon zeta."), note: "Mine" },
			highlightOf(HTML, "third", "theta"),
		])
		const all = (selector: string) =>
			Array.from(page.window.document.querySelectorAll<HTMLElement>(selector))
		page.window.eval('window.klipActive("blue")')
		expect(page.article.getAttribute("data-focus")).toBe("2")
		expect(page.registry.get("klip-active")).toMatchObject({ priority: 1 })
		// Two lines, two strokes, a line around each.
		const strokes = all('.hl-ink[data-key="blue"]').map((el) => el.style.top)
		expect(strokes).toHaveLength(2)
		expect(all(".hl-pop").map((box) => [box.dataset.color, box.style.top])).toEqual([
			["2", strokes[0]],
			["2", strokes[1]],
		])
		// The others fade: their strokes and tabs aren't marked; where another crosses it, it is.
		expect(page.window.document.querySelector(".hl-inks")!.hasAttribute("data-focus")).toBe(true)
		expect(page.window.document.querySelector(".hl-tabs")!.hasAttribute("data-focus")).toBe(true)
		expect(all(".hl-ink").map((el) => [el.dataset.key, el.dataset.active])).toEqual([
			["blue", ""],
			["blue", ""],
			["other", undefined],
			["third", undefined],
		])
		expect(all(".hl-tab").map((el) => el.dataset.active)).toEqual([undefined])
		expect(all(".hl-cross").map((el) => [el.dataset.key, el.dataset.active])).toEqual([
			["blue other", ""],
		])
		// The crossing is the other's too.
		page.window.eval('window.klipActive("other")')
		expect(all(".hl-tab").map((el) => el.dataset.active)).toEqual([""])
		expect(all(".hl-cross").map((el) => el.dataset.active)).toEqual([""])
		page.window.eval("window.klipActive(null)")
		expect(page.article.hasAttribute("data-focus")).toBe(false)
		expect(page.registry.has("klip-active")).toBe(false)
		expect(page.window.document.querySelector(".hl-inks")!.hasAttribute("data-focus")).toBe(false)
		expect(all(".hl-pop")).toHaveLength(0)
		expect(page.window.document.querySelector("[data-active]")).toBeNull()
	})

	it("keeps in the page only the strokes near the screen, as it scrolls", async () => {
		// Forty paragraphs, a hundred points apart: the last ones are far below the first screen.
		const html = Array.from({ length: 40 }, (_, i) => `<p>Line number ${i}.</p>`).join("")
		const page = openPage(html, [
			highlightOf(html, "top", "Line number 1."),
			highlightOf(html, "far", "Line number 38."),
		])
		const shown = () =>
			Array.from(
				page.window.document.querySelectorAll<HTMLElement>(".hl-ink"),
				(el) => el.dataset.key,
			)
		expect(shown()).toEqual(["top"])
		// Painted all the same: the far one waits for the screen to come near.
		expect(page.painted(0)).toEqual(["top", "far"])
		Object.defineProperty(page.window, "scrollY", { value: 3400, configurable: true })
		page.window.dispatchEvent(new page.window.Event("scroll"))
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect(shown()).toEqual(["far"])
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

describe("the reader page: citations", () => {
	it("flashes the cited passage in yellow ink, then fades it out", async () => {
		const html = "<p>Alpha beta.</p><p>Gamma delta epsilon.</p>"
		const text = storedText(html)
		const start = text.indexOf("delta")
		const page = openPage(html)
		const scrolls: number[] = []
		Object.assign(page.window, { scrollTo: ({ top }: { top: number }) => scrolls.push(top) })
		Object.assign(page.window.Range.prototype, { getBoundingClientRect: () => ({ top: 900 }) })
		page.window.eval(`window.klipCite(${start}, ${start + 5})`)
		// A quarter of the way down the screen.
		expect(scrolls).toEqual([900 - page.window.innerHeight / 4])
		const cited = page.registry.get("klip-cited")
		expect(cited?.ranges.map((r) => r.toString())).toEqual(["delta"])
		await settle(1700)
		expect(page.registry.has("klip-cited")).toBe(false)
		expect(page.registry.get("klip-cited-fading")?.ranges.map((r) => r.toString())).toEqual([
			"delta",
		])
		await settle(500)
		expect(page.registry.has("klip-cited-fading")).toBe(false)
	})
})

describe("the reader page: AI threads", () => {
	const html = "<p>Alpha beta.</p><p>Delta epsilon zeta.</p>"
	const text = storedText(html)
	const at = (quote: string) => ({
		start: text.indexOf(quote),
		end: text.indexOf(quote) + quote.length,
	})
	/** A page with a thread on a word and one on the words from it to the end, in a highlighted
	 * paragraph; and a thread on a paragraph with a highlighted word. */
	function threadedPage() {
		const page = openPage(html, [
			highlightOf(html, "para2", "Delta epsilon zeta."),
			highlightOf(html, "beta", "beta", "pink"),
		])
		page.window.eval(
			`window.klipThreads(${JSON.stringify([
				{ id: "word", ...at("epsilon") },
				{ id: "tail", ...at("epsilon zeta.") },
				{ id: "para1", ...at("Alpha beta.") },
			])})`,
		)
		const [first, second] = Array.from(
			page.article.querySelectorAll("p"),
			(p) => p.firstChild as Text,
		)
		const tapAt = (node: Text, offset: number) => {
			const caret = page.window.document.createRange()
			caret.setStart(node, offset)
			Object.assign(page.window.document, { caretRangeFromPoint: () => caret })
			page.messages.length = 0
			page.window.document.body.dispatchEvent(
				new page.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			)
			return page.messages
		}
		return { page, first: first!, second: second!, tapAt }
	}

	it("underlines the threads' passages, and washes the open one's", () => {
		const { page } = threadedPage()
		expect(page.registry.get("klip-ai")?.ranges.map((r) => r.toString())).toEqual([
			"epsilon",
			"epsilon zeta.",
			"Alpha beta.",
		])
		page.window.eval('window.klipThreadFocus("word")')
		expect(page.registry.get("klip-ai-focus")?.ranges.map((r) => r.toString())).toEqual(["epsilon"])
		page.window.eval("window.klipThreadFocus(null); window.klipThreads([])")
		expect(page.registry.has("klip-ai-focus")).toBe(false)
		expect(page.registry.has("klip-ai")).toBe(false)
	})

	it("a tap opens the smallest of the threads and highlights under it", () => {
		const { first, second, tapAt } = threadedPage()
		// The word: the smaller of two threads, and smaller than the highlight.
		expect(tapAt(second, second.data.indexOf("psilon"))).toEqual([{ type: "thread", id: "word" }])
		// Just after the word: not on it any more.
		expect(tapAt(second, second.data.indexOf(" zeta"))).toEqual([{ type: "thread", id: "tail" }])
		expect(tapAt(second, 1)).toEqual([{ type: "highlight", id: "para2" }])
		// A highlighted word inside a thread's paragraph: the highlight.
		expect(tapAt(first, first.data.indexOf("eta"))).toEqual([{ type: "highlight", id: "beta" }])
		expect(tapAt(first, 1)).toEqual([{ type: "thread", id: "para1" }])
	})

	it("keeps an open thread's passage above the card covering the screen's bottom", () => {
		const { page } = threadedPage()
		const scrolls: number[] = []
		Object.assign(page.window, { scrollTo: ({ top }: { top: number }) => scrolls.push(top) })
		// Under where the card will be.
		Object.assign(page.window.Range.prototype, {
			getBoundingClientRect: () => ({
				top: page.window.innerHeight - 100,
				bottom: page.window.innerHeight - 80,
			}),
		})
		page.window.eval(`window.klipReveal("word", 300)`)
		expect(scrolls).toHaveLength(1)
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

	it("measures reading to the end of the article, not through the shelf after it", async () => {
		const reported = async (topics: ReaderPage["topics"]) => {
			const { window, messages } = openPage("<p>Text.</p>", [], { topics })
			sized(window)
			Object.defineProperty(window, "scrollY", { value: 1300 })
			await settle(50)
			messages.length = 0
			window.dispatchEvent(new window.Event("scroll"))
			await settle(300)
			const last = messages.findLast((m) => m.type === "reading")
			return last?.type === "reading" ? last.position : null
		}
		// Scrolled to 1,300: (1,300 + a fifth of the screen) over 3,000 − 1,000, three quarters.
		expect(await reported(null)).toBeCloseTo(0.75)
		// Over 3,000 − 1,000 − 400 − its 40 points of margin.
		expect(await reported({ topics: [], shelf: SHELF })).toBeCloseTo(1500 / 1560)
	})

	it("measures reading to the top of the end block, however tall its note makes it", async () => {
		const { window, messages } = openPage("<p>Text.</p>")
		sized(window)
		const page = window as unknown as { klipEnd: (end: unknown) => void }
		page.klipEnd({
			state: "kept",
			archived: false,
			starred: false,
			editions: true,
			shortlisted: false,
		})
		const end = window.document.getElementById("klip-end")!
		Object.defineProperty(end, "offsetHeight", { value: 500 })
		Object.defineProperty(window, "scrollY", { value: 1000 })
		await settle(50)
		messages.length = 0
		window.dispatchEvent(new window.Event("scroll"))
		await settle(300)
		const last = messages.findLast((m) => m.type === "reading")
		// Over 3,000 − 1,000 − 500 − its 40 points of margin.
		expect(last?.type === "reading" ? last.position : null).toBeCloseTo(1200 / 1460)
	})

	it("opens at the saved position measured the same way, without the shelf", async () => {
		const openedAt = async (topics: ReaderPage["topics"]) => {
			const { window } = openPage("<p>Text.</p>", [], { topics, position: 0.9 })
			sized(window)
			const tops: number[] = []
			Object.assign(window, { scrollTo: (_x: number, y: number) => tops.push(y) })
			await settle(100)
			return tops[0]
		}
		// 0.9 of the span, less a fifth of the screen.
		expect(await openedAt(null)).toBeCloseTo(0.9 * 2000 - 200)
		expect(await openedAt({ topics: [], shelf: SHELF })).toBeCloseTo(0.9 * 1560 - 200)
	})

	it("hands a tap on a shelf card to the app as a link to its reader page", () => {
		const { window, messages } = openPage("<p>Text.</p>", [], {
			topics: {
				topics: [{ id: TOPIC, name: "Writing" }],
				shelf: {
					topic: { id: TOPIC, name: "Writing" },
					unread: 5,
					items: [
						{
							id: NEXT,
							title: "Next",
							siteName: "Example",
							url: "https://example.com/next",
							readingMinutes: null,
							readerUrl: `https://klipstack.test/read/${NEXT}`,
						},
					],
				},
			},
		})
		const card = window.document.querySelector(".shelf-card")!
		expect(
			card.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })),
		).toBe(false)
		expect(messages).toContainEqual({
			type: "link",
			href: `https://klipstack.test/read/${NEXT}`,
			text: "ExampleNext",
		})
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
		page.klipEnd({
			state: "finishing",
			archived: false,
			starred: false,
			editions: true,
			shortlisted: true,
		})
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
		page.klipEnd({
			state: "early",
			archived: true,
			starred: true,
			editions: true,
			shortlisted: false,
		})
		expect(end.querySelector('[data-end="finish"]')?.textContent).toBe("Mark as Finished")
		expect(end.textContent).toContain("Starred")
	})

	it("offers the note for the next edition once marked, as the user wrote it, and taps open it", () => {
		const { window, messages } = openPage("<p>Text.</p>")
		const page = window as unknown as { klipEnd: (end: unknown) => void }
		const end = window.document.getElementById("klip-end")!
		const base = { state: "kept", archived: false, starred: false, editions: true }
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

		// Editions turned off: neither the mark nor the note, marked or not.
		page.klipEnd({ ...base, editions: false, shortlisted: true, editionNote: "Why." })
		expect(end.querySelector('[data-end="shortlist"]')).toBeNull()
		expect(end.querySelector(".end-edition")).toBeNull()
		expect(end.querySelector('[data-end="star"]')).not.toBeNull()
	})

	it("scrolls what marking opened into view, only when marked with its button", () => {
		const { window } = openPage("<p>Text.</p>")
		const page = window as unknown as { klipEnd: (end: unknown) => void }
		const end = window.document.getElementById("klip-end")!
		const scrolled: Element[] = []
		window.Element.prototype.scrollIntoView = function (this: Element) {
			scrolled.push(this)
		}
		const base = { state: "kept", archived: false, starred: false, editions: true }
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

describe("the reader page: the note at the end", () => {
	const LINKED = "0190a3c4-1111-7000-8000-000000000002"
	const OTHER = "0190a3c4-1111-7000-8000-000000000003"
	const base = {
		state: "kept",
		archived: false,
		starred: false,
		editions: true,
		shortlisted: false,
	}
	const note = (text: string, more: object = {}) => ({
		text,
		status: "idle",
		links: {},
		rev: 0,
		...more,
	})
	function openEnd() {
		const opened = openPage("<p>Text.</p>")
		const page = opened.window as unknown as {
			klipEnd: (end: unknown) => void
			klipNote: (note: unknown) => void
		}
		page.klipEnd(base)
		const end = opened.window.document.getElementById("klip-end")!
		const field = end.querySelector<HTMLElement>(".takeaway-field")!
		return { ...opened, page, end, field }
	}

	it("puts the note on a post-it between the line about the end and the choices", () => {
		const { page, end, field } = openEnd()
		const order = Array.from(end.querySelectorAll(".end-status, .takeaway, .end-choices"))
		expect(order.map((el) => el.className)).toEqual(["end-status", "takeaway", "end-choices"])
		expect(end.querySelector(".takeaway-label")?.textContent).toBe("Your note · only you")
		page.klipNote(note(""))
		expect(field.className).toContain("empty")
		expect(field.dataset.placeholder).toBe("What will you take from this?")
	})

	it("shows links as their titles, and hands what is written back as stored", () => {
		const { window, page, field, messages } = openEnd()
		const stored = `Mine.\nSee [The other](/read/${LINKED}) too.`
		page.klipNote(note(stored, { links: { [LINKED]: "trash" } }))
		expect(field.className).not.toContain("empty")
		const link = field.querySelector<HTMLElement>(".takeaway-link")!
		expect(link.textContent).toBe("The other")
		expect(link.className).toContain("trash")
		expect(link.getAttribute("contenteditable")).toBe("false")

		field.append(" More.")
		messages.length = 0
		field.dispatchEvent(new window.Event("input"))
		expect(messages).toEqual([{ type: "note", text: `${stored} More.` }])
	})

	it("keeps what is being written when the app's note comes back, unless the app replaced it", () => {
		const { window, page, field, messages } = openEnd()
		page.klipNote(note("Saved."))
		field.focus()
		expect(window.document.activeElement).toBe(field)
		field.textContent = "Typed faster."
		page.klipNote(note("Typed.", { status: "saving" }))
		expect(field.textContent).toBe("Typed faster.")
		expect(window.document.querySelector(".takeaway-status")?.textContent).toBe("Saving…")
		// Taken from elsewhere: shown at once.
		page.klipNote(note("From the web.", { rev: 1 }))
		expect(field.textContent).toBe("From the web.")
		// Out of the field: what the app has, and the app is told.
		page.klipNote(note("From the sheet.", { rev: 1 }))
		messages.length = 0
		field.blur()
		expect(field.textContent).toBe("From the sheet.")
		expect(messages).toContainEqual({ type: "note-focus", focused: false })
	})

	it("opens a linked article on a tap while not writing, and retries a failed save", () => {
		const { window, page, end, field, messages } = openEnd()
		page.klipNote(note(`[The other](/read/${LINKED})`, { status: "error" }))
		messages.length = 0
		field
			.querySelector(".takeaway-link")!
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		end
			.querySelector('[data-end="note-retry"]')!
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		expect(messages).toEqual([
			{ type: "note-link", id: LINKED },
			{ type: "end", action: "note-retry" },
		])
	})

	it("asks for an article on [[ or @ typed, and links it in their place", () => {
		const { window, page, field, messages } = openEnd()
		const linker = page as unknown as { klipNoteLink: (a: { id: string; title: string }) => void }
		page.klipNote(note(`[The other](/read/${LINKED}) and [[ more`))
		const type = (text: string, data: string) => {
			field.lastChild!.textContent = text
			window.getSelection()!.collapse(field.lastChild!, text.lastIndexOf(data) + data.length)
			messages.length = 0
			field.dispatchEvent(new window.InputEvent("input", { inputType: "insertText", data }))
		}
		// A single bracket asks for nothing; the second one does.
		type(" and [ more", "[")
		expect(messages.filter((m) => m.type === "note-pick")).toEqual([])
		type(" and [[ more", "[")
		expect(messages).toContainEqual({ type: "note-pick" })
		messages.length = 0
		linker.klipNoteLink({ id: OTHER, title: "Third" })
		const linked = `[The other](/read/${LINKED}) and [Third](/read/${OTHER}) more`
		expect(messages.filter((m) => m.type === "note")).toEqual([{ type: "note", text: linked }])
		expect(fieldText(field)).toBe(linked)
		// The caret is back in the note, after the link and its space.
		const selection = window.getSelection()!
		expect(window.document.activeElement).toBe(field)
		expect([selection.anchorNode?.textContent, selection.anchorOffset]).toEqual([" more", 1])

		type(" and Third more @", "@")
		expect(messages).toContainEqual({ type: "note-pick" })
	})

	it("asks for an article from its Link Article button, linked at the end without a caret", () => {
		const { window, page, end, field, messages } = openEnd()
		const linker = page as unknown as { klipNoteLink: (a: { id: string; title: string }) => void }
		page.klipNote(note("See"))
		messages.length = 0
		const button = end.querySelector<HTMLElement>(".takeaway-link-article")!
		expect(button.textContent).toBe("Link Article")
		button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		expect(messages).toEqual([{ type: "note-pick" }])
		linker.klipNoteLink({ id: OTHER, title: "Third" })
		expect(fieldText(field)).toBe(`See [Third](/read/${OTHER}) `)
	})

	it("links from its button at the caret, wherever it was in the note", () => {
		const { window, page, end, field } = openEnd()
		const linker = page as unknown as { klipNoteLink: (a: { id: string; title: string }) => void }
		page.klipNote(note("Before after"))
		field.focus()
		window.getSelection()!.collapse(field.firstChild!, 7)
		window.document.dispatchEvent(new window.Event("selectionchange"))
		end
			.querySelector(".takeaway-link-article")!
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		linker.klipNoteLink({ id: OTHER, title: "Third" })
		expect(fieldText(field)).toBe(`Before [Third](/read/${OTHER}) after`)
	})

	it("links at the end when the note was replaced while picking, and takes no words", () => {
		const { window, page, field } = openEnd()
		const linker = page as unknown as { klipNoteLink: (a: { id: string; title: string }) => void }
		page.klipNote(note("Hello [["))
		field.focus()
		window.getSelection()!.collapse(field.firstChild!, 8)
		field.dispatchEvent(new window.InputEvent("input", { inputType: "insertText", data: "[" }))
		page.klipNote(note("Replaced from the web, longer", { rev: 1 }))
		linker.klipNoteLink({ id: OTHER, title: "Third" })
		expect(fieldText(field)).toBe(`Replaced from the web, longer [Third](/read/${OTHER}) `)
	})

	it("closed without a pick, keeps what was typed and goes back to writing", () => {
		const { window, page, field, messages } = openEnd()
		const linker = page as unknown as { klipNoteLink: (a: null) => void }
		page.klipNote(note("mail ana@"))
		field.focus()
		window.getSelection()!.collapse(field.firstChild!, 9)
		messages.length = 0
		// An @ inside a word asks for nothing.
		field.dispatchEvent(new window.InputEvent("input", { inputType: "insertText", data: "@" }))
		expect(messages.filter((m) => m.type === "note-pick")).toEqual([])
		field.blur()
		linker.klipNoteLink(null)
		expect(fieldText(field)).toBe("mail ana@")
		expect(window.document.activeElement).toBe(field)
	})

	it("adds no link that would take the note past the longest the server keeps", () => {
		const { window, page, end, field, messages } = openEnd()
		const linker = page as unknown as { klipNoteLink: (a: { id: string; title: string }) => void }
		page.klipNote(note("a".repeat(NOTE_MAX - 10)))
		end
			.querySelector(".takeaway-link-article")!
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		messages.length = 0
		linker.klipNoteLink({ id: OTHER, title: "Third" })
		expect(fieldText(field)).toBe("a".repeat(NOTE_MAX - 10))
		expect(messages.filter((m) => m.type === "note")).toEqual([])
	})

	it("reads WebKit's line breaks as the note's lines", () => {
		const { window, field } = openEnd()
		const text = (html: string) => {
			field.innerHTML = html
			return fieldText(field)
		}
		expect(text("a\nb")).toBe("a\nb")
		expect(text("a<br>b<br>")).toBe("a\nb")
		expect(text("a<br><br>")).toBe("a\n")
		expect(text("a<div>b</div><div><br></div>")).toBe("a\nb\n")
		expect(text("a<div>b<br></div>")).toBe("a\nb")
		expect(text("a\u00a0b")).toBe("a b")
		expect(window).toBeTruthy()
	})

	it("takes no text past the longest note the server keeps, pasted or typed", () => {
		const { window, page, field } = openEnd()
		page.klipNote(note("a".repeat(NOTE_MAX - 2)))
		const input = (data: string) =>
			field.dispatchEvent(
				new window.InputEvent("beforeinput", { inputType: "insertText", data, cancelable: true }),
			)
		expect(input("ab")).toBe(true)
		expect(input("abc")).toBe(false)
	})

	it("doesn't open a link tapped while writing", () => {
		const { window, page, field, messages } = openEnd()
		page.klipNote(note(`[The other](/read/${LINKED})`))
		field.focus()
		field.dispatchEvent(new window.Event("touchstart"))
		messages.length = 0
		field
			.querySelector(".takeaway-link")!
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
		expect(messages.filter((m) => m.type === "note-link")).toEqual([])
	})

	it("keeps the paper above the keyboard while writing", () => {
		const { window, page, field } = openEnd()
		page.klipNote(note("Mine."))
		const scrolled: number[] = []
		Object.assign(window, {
			scrollBy: ({ top }: { top: number }) => scrolled.push(top),
			visualViewport: Object.assign(new window.EventTarget(), { offsetTop: 0, height: 400 }),
		})
		const paper = window.document.querySelector(".post-it")!
		paper.getBoundingClientRect = () => ({ bottom: 500 }) as DOMRect
		field.focus()
		field.dispatchEvent(new window.Event("input"))
		// 500 + 16 points of room, less the 400 the keyboard leaves.
		expect(scrolled).toEqual([116])
	})

	it("sizes the paper to its text: a small square for a short note, wider for a long one", () => {
		expect(postItSize("").width).toBe("min(100%, calc(14ch + 2.5rem))")
		expect(postItSize("a".repeat(2000)).width).toBe("min(100%, calc(52ch + 2.5rem))")
		expect(postItSize(`[A title](/read/${LINKED})`).width).toBe(postItSize("A title").width)
	})

	it("stays as written when the rest of the end block is drawn again", () => {
		const { page, field } = openEnd()
		page.klipNote(note("Kept."))
		page.klipEnd({ ...base, starred: true })
		expect(field.isConnected).toBe(true)
		expect(field.textContent).toBe("Kept.")
	})
})

describe("the reader page: contents", () => {
	const SECTIONED = [
		"<h3>Beginnings</h3><p>One.</p>",
		"<h4>Small steps</h4><p>Two.</p>",
		"<ul><li><h3>Listed book</h3></li></ul>",
		"<h3>Notes</h3><p>Three.</p>",
		"<h5>A deep one</h5><p>Four.</p>",
		"<h3>Notes</h3><p>Five.</p>",
	].join("")

	/** Puts each heading `gap` points below the one before it, the first at `first`, scrolled by. */
	function placeHeadings(window: ReturnType<typeof openPage>["window"], first: number, gap = 600) {
		const headings = Array.from(window.document.querySelectorAll<HTMLElement>("article h3,h4,h5"))
		headings.forEach((h, i) => {
			h.getBoundingClientRect = () => ({ top: first + gap * i - window.scrollY }) as DOMRect
		})
	}
	const scrollTo = async (page: ReturnType<typeof openPage>, y: number) => {
		Object.defineProperty(page.window, "scrollY", { value: y, configurable: true })
		page.window.dispatchEvent(new page.window.Event("scroll"))
		await settle(300)
	}

	it("tells the app the article's own headings, in two levels, as the web's Contents takes them", () => {
		const { messages } = openPage(SECTIONED)
		expect(messages.find((m) => m.type === "contents")).toEqual({
			type: "contents",
			entries: [
				{ key: "Beginnings#0", text: "Beginnings", depth: 0 },
				{ key: "Small steps#0", text: "Small steps", depth: 1 },
				{ key: "Notes#0", text: "Notes", depth: 0 },
				{ key: "A deep one#0", text: "A deep one", depth: 1 },
				{ key: "Notes#1", text: "Notes", depth: 0 },
			],
		})
	})

	it("has no contents with fewer than three headings, and then says no section", async () => {
		const page = openPage("<h2>One</h2><p>Text.</p><h2>Two</h2><p>Text.</p>")
		expect(page.messages.find((m) => m.type === "contents")).toEqual({
			type: "contents",
			entries: [],
		})
		await scrollTo(page, 2000)
		expect(page.messages.some((m) => m.type === "section")).toBe(false)
	})

	it("says which section is being read as it changes: the last heading above the top third", async () => {
		const page = openPage(SECTIONED)
		// jsdom's screen is 768 points tall: the line is at 256. Headings at 300, 900, 1500 and on;
		// the one in the list is not a section, but takes its place.
		placeHeadings(page.window, 300)
		await settle(50)
		const sections = () => page.messages.flatMap((m) => (m.type === "section" ? [m.index] : []))
		// At the top, before the first heading: no section, as the app starts.
		expect(sections()).toEqual([])
		await scrollTo(page, 100)
		await scrollTo(page, 700)
		// The list's heading is at 1,500, Notes at 2,100.
		await scrollTo(page, 1300)
		await scrollTo(page, 1900)
		await scrollTo(page, 1950)
		expect(sections()).toEqual([0, 1, 2])
	})

	it("scrolls to a heading just below the app's controls, and reads aloud from it while reading", async () => {
		const page = openPage(SECTIONED, [], { top: 100 })
		Object.defineProperty(page.window.document.documentElement, "scrollHeight", { value: 5000 })
		const tops: number[] = []
		Object.assign(page.window, { scrollTo: (to: { top: number }) => tops.push(to.top) })
		placeHeadings(page.window, 300)
		const api = page.window as unknown as {
			klipSection: (index: number) => void
			klipSentences: (lang: string) => void
			klipSpeaking: (index: number | null) => void
		}
		// The sentence being read is on screen: reading aloud doesn't scroll.
		Object.assign(page.window.Range.prototype, {
			getBoundingClientRect: () => ({ top: 200, bottom: 220 }),
		})
		await settle(50)
		// The sentences are known, but nothing is being read.
		api.klipSentences("en")
		api.klipSpeaking(null)
		// Notes, the second time: the sixth heading, at 300 + 5 × 600.
		api.klipSection(4)
		expect(tops).toEqual([3300 - 100 - 16])
		expect(page.window.document.activeElement?.textContent).toBe("Notes")
		expect(page.messages.some((m) => m.type === "sentence")).toBe(false)

		const list = page.messages.find((m) => m.type === "sentences")
		api.klipSpeaking(0)
		api.klipSection(1)
		const sentence = page.messages.findLast((m) => m.type === "sentence")
		expect(list?.type === "sentences" && sentence?.type === "sentence").toBe(true)
		if (list?.type !== "sentences" || sentence?.type !== "sentence") return
		expect(list.list[sentence.index]?.text).toBe("Small steps")
	})
})

describe("the reader page: a section picked in the contents", () => {
	it("stays the one being read near where the jump took the page, until the reader touches it", async () => {
		const page = openPage(
			"<h2>A</h2><p>One.</p><h2>B</h2><h3>B.1</h3><p>Two.</p><h2>C</h2><p>Three.</p>",
		)
		const { window } = page
		// B and B.1 close together, both above the top third (256) once B is picked.
		const tops = [0, 600, 680, 1500]
		Array.from(window.document.querySelectorAll<HTMLElement>("article h2,h3")).forEach((h, i) => {
			h.getBoundingClientRect = () => ({ top: tops[i]! - window.scrollY }) as DOMRect
		})
		const scrolled = async (y: number) => {
			Object.defineProperty(window, "scrollY", { value: y, configurable: true })
			window.dispatchEvent(new window.Event("scroll"))
			await settle(300)
		}
		await settle(50)
		const sections = () => page.messages.flatMap((m) => (m.type === "section" ? [m.index] : []))
		;(window as unknown as { klipSection: (i: number) => void }).klipSection(1)
		// A is at the top when the page opens.
		expect(sections()).toEqual([0, 1])
		await scrolled(500)
		expect(sections()).toEqual([0, 1])
		window.document.dispatchEvent(new window.Event("touchstart"))
		await scrolled(510)
		expect(sections()).toEqual([0, 1, 2])
	})

	it("lets go once the page moves half a screen from where the jump landed, untouched", async () => {
		const page = openPage(
			"<h2>A</h2><p>One.</p><h2>B</h2><h3>B.1</h3><p>Two.</p><h2>C</h2><p>Three.</p>",
		)
		const { window } = page
		const el = window.document.documentElement
		Object.defineProperty(el, "scrollHeight", { value: 5000 })
		Object.defineProperty(el, "clientHeight", { value: 768 })
		const tops = [0, 600, 680, 1500]
		Array.from(window.document.querySelectorAll<HTMLElement>("article h2,h3")).forEach((h, i) => {
			h.getBoundingClientRect = () => ({ top: tops[i]! - window.scrollY }) as DOMRect
		})
		const scrolled = async (y: number) => {
			Object.defineProperty(window, "scrollY", { value: y, configurable: true })
			window.dispatchEvent(new window.Event("scroll"))
			await settle(300)
		}
		await settle(50)
		const sections = () => page.messages.flatMap((m) => (m.type === "section" ? [m.index] : []))
		;(window as unknown as { klipSection: (i: number) => void }).klipSection(1)
		// Landed at B, less 16 points; then a little further, as reading aloud would take it.
		await scrolled(584)
		await scrolled(700)
		expect(sections()).toEqual([0, 1])
		// Half a screen and more from there, with no touch: C is above the top third.
		await scrolled(1400)
		expect(sections()).toEqual([0, 1, 3])
	})
})
