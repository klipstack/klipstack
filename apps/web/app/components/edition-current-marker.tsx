import { type RefObject, useEffect, useRef } from "react"

/** What each article of the list carries, for the marker to find it. */
export const ITEM_ATTRIBUTE = "data-edition-item"

/**
 * One thin bar at the side of the article crossing the middle of the screen. When the next one
 * gets there, the same bar slides down to it and takes its height. The scroll decides which
 * article it is; the move is a short transition. Between two articles it stays; above the first
 * it fades where it is. Near the end of the page the line it follows slides to the bottom edge,
 * so the last articles get their turn without blank space under them. Without JavaScript there
 * is no bar, and nothing else depends on it.
 *
 * `list` wraps the articles and is positioned: the bar is placed in it by their offsets.
 */
export function CurrentMarker({ list }: { list: RefObject<HTMLElement | null> }) {
	const bar = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const box = list.current
		const el = bar.current
		if (!box || !el) return
		// The page scrolls the window; the editor's preview pane scrolls itself.
		const scroller = scrollParent(box)
		let frame = 0
		let shown = false
		let placed = false

		const place = () => {
			frame = 0
			const articles = [...box.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)]
			if (articles.length === 0) return
			const view = scroller?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
			const half = (view.bottom - view.top) / 2
			const left = scroller
				? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
				: document.documentElement.scrollHeight - window.scrollY - window.innerHeight
			// The middle of the screen, until the page runs out: then the line slides down to the
			// bottom edge, or the last articles, which never reach the middle, would never be marked.
			const line = view.top + half + Math.max(0, half - left)
			const rects = articles.map((article) => article.getBoundingClientRect())
			// The article across the line, or in a gap the one before it. None above the first.
			const index = rects[0]!.top <= line ? rects.findLastIndex((rect) => rect.top <= line) : -1
			const show = index >= 0
			const target = articles[show ? index : 0]!
			if (show || !placed) {
				// Appearing, it starts where it belongs rather than sliding in from elsewhere.
				const slide = shown && placed
				if (!slide) el.style.transitionProperty = "opacity"
				el.style.transform = `translateY(${target.offsetTop}px) scaleY(${target.offsetHeight})`
				if (!slide) {
					void el.offsetHeight
					el.style.transitionProperty = ""
				}
				placed = true
			}
			el.style.opacity = show ? "1" : "0"
			shown = show
		}
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(place)
		}

		place()
		const target = scroller ?? window
		target.addEventListener("scroll", schedule, { passive: true })
		window.addEventListener("resize", schedule)
		// Images load, fonts arrive, the preview updates: the articles move.
		const resized = new ResizeObserver(schedule)
		resized.observe(box)
		return () => {
			cancelAnimationFrame(frame)
			target.removeEventListener("scroll", schedule)
			window.removeEventListener("resize", schedule)
			resized.disconnect()
		}
	}, [list])

	return (
		<div
			ref={bar}
			aria-hidden="true"
			data-testid="edition-marker"
			// One pixel tall, scaled to the article's height: the move is a transform alone.
			className="pointer-events-none absolute top-0 -left-3 h-px w-[3px] origin-top bg-accent opacity-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none @xl:-left-6"
		/>
	)
}

/** The element that scrolls `node`, or null for the window. */
function scrollParent(node: HTMLElement): HTMLElement | null {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el)
		if (overflowY === "auto" || overflowY === "scroll") return el
	}
	return null
}
