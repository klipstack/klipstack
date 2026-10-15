import { useCallback, useEffect, useRef, useState } from "react"
import { supportsHighlightApi } from "~/lib/highlights.client"

/** What `j` and `k` step through: the innermost blocks of text. */
const BLOCKS = "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, dt, dd, figcaption"
/** The marked paragraph, painted: full strength in the focus mode (app.css). */
export const READING_HIGHLIGHT = "klip-reading"
/** Below the sticky top bar. */
const TOP = 72

/**
 * The article's paragraphs in order, as ranges of its text. A block with blocks inside (a list item
 * with paragraphs, a quote) is left to them, and a block split by blank lines (`<br><br>`, as some
 * pages write paragraphs) is one paragraph per part.
 */
export function paragraphsIn(root: HTMLElement): Range[] {
	const out: Range[] = []
	for (const block of root.querySelectorAll<HTMLElement>(BLOCKS)) {
		if (block.querySelector(BLOCKS) || block.getClientRects().length === 0) continue
		let first: Text | null = null
		let last: Text | null = null
		let breaks = 0
		const close = () => {
			if (first && last) {
				const range = document.createRange()
				range.setStart(first, first.data.length - first.data.trimStart().length)
				range.setEnd(last, last.data.trimEnd().length)
				out.push(range)
			}
			first = last = null
		}
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node instanceof HTMLBRElement) {
				breaks++
				continue
			}
			if (!(node instanceof Text) || !node.data.trim()) continue
			if (breaks >= 2) close()
			breaks = 0
			first ??= node
			last = node
		}
		close()
	}
	return out
}

const sameStart = (a: Range, b: Range) =>
	a.startContainer === b.startContainer && a.startOffset === b.startOffset

function onScreen(range: Range): boolean {
	const rect = range.getBoundingClientRect()
	return rect.bottom > TOP && rect.top < window.innerHeight
}

/**
 * Scrolls a range to a third of the way down the window, as `scrollRangeIntoView` puts a passage,
 * unless all of it can be read where it is. Whether the page moves.
 */
function scrollToRange(range: Range): boolean {
	const rect = range.getBoundingClientRect()
	if (rect.top >= TOP && rect.bottom <= window.innerHeight * 0.85) return false
	const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
	window.scrollTo({
		top: Math.max(0, rect.top + window.scrollY - window.innerHeight / 3),
		behavior: still ? "auto" : "smooth",
	})
	return true
}

/**
 * Reading paragraph by paragraph: the marked paragraph, moved by `j` and `k`, and the focus mode
 * that dims the rest. Starts over when the article's text changes.
 */
export function useReadingCursor(contentRef: React.RefObject<HTMLElement | null>, html: string) {
	const [current, setCurrent] = useState<Range | null>(null)
	const [focus, setFocus] = useState(false)

	// New text: its paragraphs are new nodes.
	const [text, setText] = useState(html)
	if (text !== html) {
		setText(html)
		setCurrent(null)
		setFocus(false)
	}
	useEffect(() => {
		if (!current || !supportsHighlightApi()) return
		CSS.highlights.set(READING_HIGHLIGHT, new Highlight(current))
		return () => void CSS.highlights.delete(READING_HIGHLIGHT)
	}, [current])

	// While the page scrolls to the marked paragraph it may be off screen still: it counts as there.
	const scrolling = useRef(false)
	useEffect(() => {
		let timer = 0
		const done = () => {
			window.clearTimeout(timer)
			scrolling.current = false
		}
		// Safari before 26 has no `scrollend`: a smooth scroll is over well within a second.
		const started = () => {
			window.clearTimeout(timer)
			timer = window.setTimeout(done, 1000)
		}
		window.addEventListener("scrollend", done)
		window.addEventListener("klip-reading-scroll", started)
		return () => {
			done()
			window.removeEventListener("scrollend", done)
			window.removeEventListener("klip-reading-scroll", started)
		}
	}, [])
	const scrollTo = useCallback((range: Range) => {
		if (!scrollToRange(range)) return
		scrolling.current = true
		window.dispatchEvent(new Event("klip-reading-scroll"))
	}, [])
	const inView = useCallback((range: Range) => scrolling.current || onScreen(range), [])

	const go = useCallback(
		(range: Range | undefined) => {
			if (!range) return
			setCurrent(range)
			scrollTo(range)
		},
		[scrollTo],
	)

	/** One paragraph on, or back. With none marked, or the marked one scrolled away: the first on screen. */
	const move = useCallback(
		(step: 1 | -1) => {
			const root = contentRef.current
			if (!root) return
			const all = paragraphsIn(root)
			const at = current ? all.findIndex((p) => sameStart(p, current)) : -1
			if (at < 0 || !inView(current!)) {
				go(all.find(onScreen) ?? all[0])
				return
			}
			go(all[at + step])
		},
		[contentRef, current, go, inView],
	)

	/** Marks the paragraph a passage starts in, and scrolls to the passage. */
	const markAt = useCallback(
		(passage: Range) => {
			scrollTo(passage)
			const root = contentRef.current
			if (!root) return
			const found = paragraphsIn(root).find(
				(p) =>
					p.comparePoint(passage.startContainer, passage.startOffset) === 0 ||
					p.compareBoundaryPoints(Range.START_TO_START, passage) > 0,
			)
			if (found) setCurrent(found)
		},
		[contentRef, scrollTo],
	)

	/** The marked paragraph, or the first on screen, marked. */
	const ensure = useCallback((): Range | null => {
		const root = contentRef.current
		if (current && inView(current)) return current
		const first = root ? (paragraphsIn(root).find(onScreen) ?? null) : null
		setCurrent(first)
		return first
	}, [contentRef, current, inView])

	const toggleFocus = useCallback(() => {
		if (focus) setFocus(false)
		else if (ensure()) setFocus(true)
	}, [ensure, focus])

	const leave = useCallback(() => {
		setCurrent(null)
		setFocus(false)
	}, [])

	return { current, focus, move, markAt, ensure, toggleFocus, leave }
}

export type ReadingCursor = ReturnType<typeof useReadingCursor>
