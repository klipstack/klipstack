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

/**
 * One registry per color (`klip-hl-yellow`…): which ranges are highlighted, in which color. They
 * have no paint of their own: `HighlightInk` draws a marker stroke for each, from its rectangles
 * (the API can only paint a background or a line, and WebKit and Firefox cannot move a thick line
 * up behind the letters).
 */
const HIGHLIGHTS = HIGHLIGHT_COLOR_NAMES.map((name) => `klip-hl-${name}`)
const paintedAs = (item: RenderableHighlight) => `klip-hl-${highlightColorName(item.color)}`
const ACTIVE = "klip-active"
const NOTE = "klip-note"

/** How a highlight's ink looks: a seed for its strokes' shape, and its age. */
interface InkLook {
	/** Stable for the highlight's life: its id, or the id it had while it was being saved. */
	seed: string
	/** When it was made in this page (`performance.now()`), if it was: its strokes are drawn in. */
	created?: number
}
const inkMeta = new WeakMap<Range, InkLook & { id: string }>()
const looks = new Map<string, InkLook>()
// A new highlight is painted under a temporary id, then under the server's, at the same place: the
// saved one takes the look of the temporary one, once. Unclaimed for a minute, it is forgotten.
const beingSaved = new Map<string, Required<InkLook>>()
let activeRange: Range | null = null

function remember(item: RenderableHighlight, range: Range, versionId?: string | null) {
	let look = looks.get(item.id)
	if (!look) {
		const now = performance.now()
		for (const [at, saving] of beingSaved) if (now - saving.created > 60_000) beingSaved.delete(at)
		const at = `${versionId ?? ""}:${item.startOffset}:${item.endOffset}`
		if (item.id.startsWith("tmp-")) {
			const saving = { seed: item.id, created: now }
			beingSaved.set(at, saving)
			look = saving
		} else {
			look = beingSaved.get(at) ?? { seed: item.id }
			beingSaved.delete(at)
		}
		looks.set(item.id, look)
	}
	inkMeta.set(range, { id: item.id, ...look })
}

const painters = new Set<() => void>()
/** Calls `listener` whenever what is painted changes. Returns the unsubscribe. */
export function onPaintChange(listener: () => void): () => void {
	painters.add(listener)
	return () => painters.delete(listener)
}
const notifyPainters = () => {
	for (const listener of painters) listener()
}

export interface PaintedRange {
	range: Range
	/** The highlight's id; `null` for a range painted by other means. */
	id: string | null
	color: string
	/** Its position in its color's registry (e2e/helpers.ts reads the text there). */
	index: number
	seed: string
	created?: number
	/** The mark in focus (`klip-active`). */
	active: boolean
}

/** The highlighted ranges inside `root`, by color. */
export function paintedRanges(root: Node): PaintedRange[] {
	if (!supportsHighlightApi()) return []
	const out: PaintedRange[] = []
	for (const name of HIGHLIGHT_COLOR_NAMES) {
		let index = 0
		for (const range of CSS.highlights.get(`klip-hl-${name}`) ?? []) {
			const at = index++
			if (!(range instanceof Range) || !root.contains(range.commonAncestorContainer)) continue
			const meta = inkMeta.get(range)
			out.push({
				range,
				id: meta?.id ?? null,
				color: name,
				index: at,
				seed: meta?.seed ?? `${name}:${at}`,
				created: meta?.created,
				active: range === activeRange,
			})
		}
	}
	return out
}

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
	const byColor = new Map<string, Range[]>(HIGHLIGHTS.map((name) => [name, []]))
	const noted: Range[] = []
	for (const item of items) {
		if (item.orphaned || (versionId && item.versionId !== versionId && !item.id.startsWith("tmp-")))
			continue
		const range = rangeFromOffsets(root, item.startOffset, item.endOffset)
		if (!range) continue
		ranges.set(item.id, range)
		remember(item, range, versionId)
		byColor.get(paintedAs(item))!.push(range)
		if (item.note) noted.push(range)
	}
	for (const [name, list] of byColor) {
		if (list.length) CSS.highlights.set(name, new Highlight(...list))
		else CSS.highlights.delete(name)
	}
	if (noted.length) CSS.highlights.set(NOTE, new Highlight(...noted))
	else CSS.highlights.delete(NOTE)
	notifyPainters()
	return ranges
}

export function clearHighlights() {
	if (!supportsHighlightApi()) return
	for (const name of HIGHLIGHTS) CSS.highlights.delete(name)
	CSS.highlights.delete(ACTIVE)
	CSS.highlights.delete(NOTE)
	activeRange = null
	notifyPainters()
}

export function setActiveHighlight(range: Range | null) {
	if (!supportsHighlightApi()) return
	if (range === activeRange) return
	activeRange = range
	if (!range) CSS.highlights.delete(ACTIVE)
	else {
		const active = new Highlight(range)
		active.priority = 1
		CSS.highlights.set(ACTIVE, active)
	}
	notifyPainters()
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
	inkMeta.set(range, (old && inkMeta.get(old)) || { id: item.id, seed: item.id })
	if (old === activeRange) activeRange = null
	ranges.set(item.id, range)
	notifyPainters()
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
