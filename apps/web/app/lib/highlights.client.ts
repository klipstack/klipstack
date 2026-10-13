import { rangeFromOffsets } from "@klipstack/anchor"
import { HIGHLIGHT_COLOR_NAMES, highlightColorName } from "./highlight-colors"
import { caretAt } from "./highlight-resize"

export interface RenderableHighlight {
	id: string
	startOffset: number
	endOffset: number
	note?: string | null
	/** Index into HIGHLIGHT_COLORS; yellow when missing. */
	color?: number
	orphaned?: boolean
	versionId?: string
}

/** One registry per color (`klip-hl-yellow`…), each painted its color in app.css. */
const HIGHLIGHTS = HIGHLIGHT_COLOR_NAMES.map((name) => `klip-hl-${name}`)
const paintedAs = (item: RenderableHighlight) => `klip-hl-${highlightColorName(item.color)}`
const ACTIVE = "klip-active"
const NOTE = "klip-note"

export function supportsHighlightApi(): boolean {
	return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"
}

/**
 * Paint highlights with the CSS Custom Highlight API. No DOM mutation, overlaps allowed.
 * Returns id → Range for hit-testing and scrolling.
 */
export function renderHighlights(
	root: HTMLElement,
	items: RenderableHighlight[],
	versionId?: string | null,
): Map<string, Range> {
	const ranges = new Map<string, Range>()
	if (!supportsHighlightApi()) return ranges
	const painted = new Map<string, Range[]>(HIGHLIGHTS.map((name) => [name, []]))
	const noted: Range[] = []
	for (const item of items) {
		if (item.orphaned || (versionId && item.versionId !== versionId && !item.id.startsWith("tmp-")))
			continue
		const range = rangeFromOffsets(root, item.startOffset, item.endOffset)
		if (!range) continue
		ranges.set(item.id, range)
		painted.get(paintedAs(item))!.push(range)
		if (item.note) noted.push(range)
	}
	for (const [name, list] of painted) {
		if (list.length) CSS.highlights.set(name, new Highlight(...list))
		else CSS.highlights.delete(name)
	}
	if (noted.length) CSS.highlights.set(NOTE, new Highlight(...noted))
	else CSS.highlights.delete(NOTE)
	return ranges
}

export function clearHighlights() {
	if (!supportsHighlightApi()) return
	for (const name of HIGHLIGHTS) CSS.highlights.delete(name)
	CSS.highlights.delete(ACTIVE)
	CSS.highlights.delete(NOTE)
}

export function setActiveHighlight(range: Range | null) {
	if (!supportsHighlightApi()) return
	if (!range) {
		CSS.highlights.delete(ACTIVE)
		return
	}
	const active = new Highlight(range)
	active.priority = 1
	CSS.highlights.set(ACTIVE, active)
}

/** Ids of highlights whose range contains the point, smallest first. */
export function highlightsAtPoint(ranges: Map<string, Range>, x: number, y: number): string[] {
	const pos = caretAt(x, y)
	if (!pos) return []
	const hits: Array<{ id: string; size: number }> = []
	for (const [id, range] of ranges) {
		try {
			if (
				range.isPointInRange(pos.node, pos.offset) &&
				Array.from(range.getClientRects()).some(
					(r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top && y <= r.bottom,
				)
			)
				hits.push({ id, size: range.toString().length })
		} catch {
			// node not in the same tree
		}
	}
	return hits.sort((a, b) => a.size - b.size).map((h) => h.id)
}

/** First visible rect of a range (for anchoring popovers and gutter markers). */
export function firstRect(range: Range): DOMRect | null {
	const rects = range.getClientRects()
	return rects.length ? (rects[0] as DOMRect) : range.getBoundingClientRect()
}

export function scrollRangeIntoView(range: Range) {
	const rect = range.getBoundingClientRect()
	const y = rect.top + window.scrollY - window.innerHeight / 3
	window.scrollTo({ top: Math.max(0, y), behavior: "smooth" })
}

/** Replace only this row's registrations. Other ranges and overlapping notes remain intact. */
export function replaceHighlightRange(
	ranges: Map<string, Range>,
	item: RenderableHighlight,
	range: Range,
	dragging: boolean,
) {
	if (!supportsHighlightApi()) return
	const old = ranges.get(item.id)
	for (const name of [...HIGHLIGHTS, NOTE, ACTIVE]) {
		if (old) CSS.highlights.get(name)?.delete(old)
	}
	const painted = paintedAs(item)
	if (!CSS.highlights.has(painted)) CSS.highlights.set(painted, new Highlight())
	CSS.highlights.get(painted)!.add(range)
	if (item.note && !dragging) {
		if (!CSS.highlights.has(NOTE)) CSS.highlights.set(NOTE, new Highlight())
		CSS.highlights.get(NOTE)!.add(range)
	}
	ranges.set(item.id, range)
}

const THREAD = "klip-ai"
const THREAD_FOCUS = "klip-ai-focus"
const CITED = "klip-cited"

/**
 * Underline the passages AI threads are about, on the version on screen. Returns id → Range, like
 * `renderHighlights`.
 */
export function renderThreads(
	root: HTMLElement,
	threads: Array<{ id: string; start: number; end: number; versionId: string; orphaned: boolean }>,
	versionId: string | null,
): Map<string, Range> {
	const ranges = new Map<string, Range>()
	if (!supportsHighlightApi()) return ranges
	for (const thread of threads) {
		if (thread.orphaned || thread.versionId !== versionId) continue
		const range = rangeFromOffsets(root, thread.start, thread.end)
		if (range) ranges.set(thread.id, range)
	}
	if (ranges.size) CSS.highlights.set(THREAD, new Highlight(...ranges.values()))
	else CSS.highlights.delete(THREAD)
	return ranges
}

export function clearThreads() {
	if (!supportsHighlightApi()) return
	CSS.highlights.delete(THREAD)
	CSS.highlights.delete(THREAD_FOCUS)
	CSS.highlights.delete(CITED)
}

/** Marks the passage of the thread open or hovered. */
export function setThreadFocus(range: Range | null) {
	if (!supportsHighlightApi()) return
	if (!range) CSS.highlights.delete(THREAD_FOCUS)
	else CSS.highlights.set(THREAD_FOCUS, new Highlight(range))
}

let citedTimer: number | undefined
/** Flashes a cited passage for a moment, once it is scrolled to. */
export function flashCited(range: Range) {
	if (!supportsHighlightApi()) return
	const cited = new Highlight(range)
	cited.priority = 2
	CSS.highlights.set(CITED, cited)
	window.clearTimeout(citedTimer)
	citedTimer = window.setTimeout(() => CSS.highlights.delete(CITED), 1800)
}
