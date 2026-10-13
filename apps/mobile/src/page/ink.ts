import { type Crossing, inkCrossings, inkLines, inkStroke, type Stroke } from "../lib/highlight-ink"

/**
 * How long after it is made a highlight's strokes are still drawn in (`.hl-ink[data-fresh]`): at
 * least 1.5 s, and long enough for its last line, each line starting 0.12 s after the one before
 * and taking 0.32 s.
 */
const drawingIn = (lines: number) => Math.max(1500, lines * 120 + 400)
/** Strokes go in bands this tall: scrolling adds or drops a band, and leaves the others alone. */
const BAND = 1000

/** A highlight to paint: its place in the page, its color (index in `HIGHLIGHT_COLORS`), whether it has a note. */
export type Inked = { id: string; color: number; range: Range; note: boolean }

type Painted = Inked & { rtl: boolean; strokes: Stroke[]; tab: TabBox | null }
type TabBox = { left: number; top: number; height: number }

/**
 * Paints the highlights with a marker, as the web reader does (apps/web/app/components/
 * highlight-ink.tsx): one stroke per line of each, in its color, under the text (`.hl-inks`, behind
 * the article), so the letters keep their full strength. Where strokes of two cross, the ink is
 * deeper: a piece of its own (`.hl-cross`), as blend modes composite slowly in WebKit. Only the
 * strokes near the screen are in the page, in bands, however long the article. A highlight made
 * while the page is open is drawn in, once, line after line (not with reduced motion).
 *
 * A highlight with a note gets a tab in its color at the right of its first line, past the text,
 * like a sticky tab poking out of a book (`.hl-tab`, `data-id`): a tap on it opens the highlight.
 *
 * Measured again when the highlights change, the text reflows (images, rotation, fonts) or a box
 * in the text scrolls sideways, and then `onMeasured` runs; the page measures it after changing the
 * type (`measure`). `strokesOf(id)` gives a highlight's strokes, for the line around the one in
 * focus.
 */
export function createInk(root: HTMLElement, onMeasured: () => void) {
	const layer = document.createElement("div")
	layer.className = "hl-inks"
	layer.setAttribute("aria-hidden", "true")
	layer.dataset.testid = "highlight-ink"
	// One empty mark per highlight painted, on screen or not: its color and lines (for tests).
	const index = document.createElement("div")
	index.hidden = true
	layer.append(index)
	const tabs = document.createElement("div")
	tabs.className = "hl-tabs"
	document.body.append(layer, tabs)

	let list: Inked[] = []
	let painted: Painted[] = []
	let crossings: Crossing[] = []
	let active: string | null = null
	// When each highlight first showed, for those made while the page is open.
	const seen = new Map<string, number>()
	let first = true

	function set(next: Inked[]) {
		const now = performance.now()
		for (const h of next)
			if (!seen.has(h.id)) seen.set(h.id, first ? Number.NEGATIVE_INFINITY : now)
		first = false
		list = next
		measure()
	}

	function setActive(id: string | null) {
		active = id
		if (id) layer.dataset.focus = ""
		else delete layer.dataset.focus
		if (id) tabs.dataset.focus = ""
		else delete tabs.dataset.focus
		for (const el of Array.from(layer.querySelectorAll<HTMLElement>("[data-key]"))) mark(el)
		for (const el of Array.from(tabs.children) as HTMLElement[]) mark(el)
	}

	function mark(el: HTMLElement) {
		const keys = (el.dataset.key ?? el.dataset.id ?? "").split(" ")
		if (active !== null && keys.includes(active)) el.dataset.active = ""
		else delete el.dataset.active
	}

	function measure() {
		const origin = { left: -window.scrollX, top: -window.scrollY }
		const clips = new Map<Element, DOMRect | null>()
		const right = root.getBoundingClientRect().right + window.scrollX
		painted = list.map((h) => {
			const lines = inkLines(textRects(h.range, root, clips))
			const firstLine = lines[0]
			return {
				...h,
				rtl: getComputedStyle(parentOf(h.range.startContainer) ?? root).direction === "rtl",
				strokes: lines.map((line, i) => inkStroke(line, origin, h.id, i)),
				tab:
					h.note && firstLine
						? {
								left: right,
								top: firstLine.top - origin.top,
								height: firstLine.bottom - firstLine.top,
							}
						: null,
			}
		})
		crossings = inkCrossings(
			painted.map((p) => ({ key: p.id, color: String(p.color), strokes: p.strokes })),
		)
		index.replaceChildren(
			...painted.map((p) => {
				const i = document.createElement("i")
				i.dataset.id = p.id
				i.dataset.color = String(p.color)
				i.dataset.lines = String(p.strokes.length)
				return i
			}),
		)
		drawTabs()
		view = null
		show()
		onMeasured()
	}

	// ---- strokes, near the screen ----

	const strokes = new Map<string, HTMLElement>()
	let view: { top: number; bottom: number } | null = null
	/** The part of the page on screen, a screen more above and below, in steps of half a screen. */
	function show() {
		const screen = window.innerHeight || 800
		const step = Math.max(screen / 2, 100)
		const top = Math.floor(window.scrollY / step) * step - screen
		if (view?.top === top) return
		view = { top, bottom: top + 3 * screen + step }
		const shown = (y: number) => {
			const band = Math.floor(y / BAND)
			return (band + 1) * BAND > view!.top && band * BAND < view!.bottom
		}
		const now = performance.now()
		const keep = new Set<string>()
		// When the last stroke of the newest drawn in is done.
		let drawnUntil = Number.NEGATIVE_INFINITY
		for (const p of painted) {
			const until = (seen.get(p.id) ?? Number.NEGATIVE_INFINITY) + drawingIn(p.strokes.length)
			const fresh = now < until
			drawnUntil = Math.max(drawnUntil, until)
			for (const s of p.strokes) {
				if (!shown(s.top)) continue
				// Same line, same element: a reflow moves the stroke without drawing it again.
				const key = `${p.id}:${s.line}`
				keep.add(key)
				let el = strokes.get(key)
				if (!el) {
					el = document.createElement("span")
					el.className = "hl-ink"
					el.dataset.key = p.id
					if (fresh) {
						el.dataset.fresh = ""
						if (p.rtl) el.dataset.rtl = ""
						el.style.animationDelay = `${s.line * 0.12}s`
					}
					strokes.set(key, el)
					layer.append(el)
				}
				el.dataset.color = String(p.color)
				place(el, s)
				el.style.borderRadius = s.radius
				el.style.transform = s.tilt ? `rotate(${s.tilt}deg)` : ""
				mark(el)
			}
		}
		for (const c of crossings) {
			if (!shown(c.top)) continue
			const key = `${c.keys.join(" ")}@${Math.round(c.left)},${Math.round(c.top)}`
			keep.add(key)
			let el = strokes.get(key)
			if (!el) {
				el = document.createElement("span")
				el.className = "hl-cross"
				el.dataset.key = c.keys.join(" ")
				strokes.set(key, el)
				layer.append(el)
			}
			el.style.setProperty("--a", `var(--hl-${c.colors[0]})`)
			el.style.setProperty("--b", `var(--hl-${c.colors[1]})`)
			place(el, c)
			mark(el)
		}
		for (const [key, el] of strokes) {
			if (keep.has(key)) continue
			el.remove()
			strokes.delete(key)
		}
		// Once drawn in, again without the mark: a band shown again won't draw it in again.
		clearTimeout(drawnIn)
		if (now < drawnUntil)
			drawnIn = setTimeout(() => {
				for (const el of strokes.values()) delete el.dataset.fresh
			}, drawnUntil - now)
	}
	let drawnIn: ReturnType<typeof setTimeout> | undefined

	function drawTabs() {
		tabs.replaceChildren(
			...painted.flatMap((p) => {
				if (!p.tab) return []
				const el = document.createElement("span")
				el.className = "hl-tab"
				el.dataset.id = p.id
				el.dataset.color = String(p.color)
				el.style.left = `${p.tab.left}px`
				el.style.top = `${p.tab.top}px`
				el.style.height = `${p.tab.height}px`
				mark(el)
				return [el]
			}),
		)
	}

	// ---- when to measure ----

	let frame = 0
	const remeasure = () => {
		cancelAnimationFrame(frame)
		frame = requestAnimationFrame(measure)
	}
	// Scrolling only changes which strokes are near the screen.
	let scrollFrame = 0
	window.addEventListener(
		"scroll",
		() => {
			cancelAnimationFrame(scrollFrame)
			scrollFrame = requestAnimationFrame(show)
		},
		{ passive: true },
	)
	window.addEventListener("resize", remeasure)
	// An image lands, a font loads: the text moves.
	document.addEventListener("load", remeasure, true)
	document.fonts?.addEventListener?.("loadingdone", remeasure)
	// A code block or a wide table scrolled sideways moves its text.
	root.addEventListener("scroll", remeasure, { capture: true, passive: true })
	// Something in the text opens or grows (a disclosure, an image without its size): it moves.
	if (typeof ResizeObserver !== "undefined") new ResizeObserver(remeasure).observe(root)

	return {
		set,
		setActive,
		/** Measures now: after the type changed. */
		measure,
		strokesOf: (id: string) => painted.find((p) => p.id === id)?.strokes ?? [],
	}
}

function place(el: HTMLElement, box: { left: number; top: number; width: number; height: number }) {
	el.style.left = `${box.left}px`
	el.style.top = `${box.top}px`
	el.style.width = `${box.width}px`
	el.style.height = `${box.height}px`
}

const parentOf = (node: Node) => (node instanceof Element ? node : node.parentElement)

/**
 * The rectangles of a range's text, its text alone: `Range.getClientRects` also gives the box of
 * every element wholly inside it (a paragraph, an image), which would paint as one block. Each is cut
 * to the box that scrolls it sideways (a code block, a wide table), whose overflow the ink, outside
 * it, would not be clipped by. As the web's.
 */
export function textRects(
	range: Range,
	root: Element,
	clips: Map<Element, DOMRect | null> = new Map(),
): DOMRect[] {
	const rects: DOMRect[] = []
	const start = range.startContainer
	const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
	let node: Node | null
	if (start.nodeType === Node.TEXT_NODE) node = walker.currentNode = start
	else {
		walker.currentNode = start.childNodes[range.startOffset] ?? start
		node = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode()
	}
	const part = document.createRange()
	for (; node; node = walker.nextNode()) {
		if (range.comparePoint(node, 0) > 0) break
		if (!range.intersectsNode(node)) continue
		part.selectNodeContents(node)
		if (node === start) part.setStart(node, range.startOffset)
		if (node === range.endContainer) part.setEnd(node, range.endOffset)
		const clip = clipOf(node.parentElement, root, clips)
		for (const r of Array.from(part.getClientRects())) {
			if (!clip) rects.push(r)
			else {
				const left = Math.max(r.left, clip.left)
				const right = Math.min(r.right, clip.right)
				if (right > left) rects.push(new DOMRect(left, r.top, right - left, r.height))
			}
		}
	}
	return rects
}

/** The box of the nearest element inside `root` that scrolls or clips `el` sideways, if any. */
function clipOf(
	el: Element | null,
	root: Element,
	clips: Map<Element, DOMRect | null>,
): DOMRect | null {
	if (!el || el === root || !root.contains(el)) return null
	let clip = clips.get(el)
	if (clip === undefined) {
		clip =
			getComputedStyle(el).overflowX !== "visible"
				? el.getBoundingClientRect()
				: clipOf(el.parentElement, root, clips)
		clips.set(el, clip)
	}
	return clip
}
