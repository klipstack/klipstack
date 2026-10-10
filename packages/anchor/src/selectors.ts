import { walkTextNodes } from "./text"

/** W3C-style selector pair stored with every highlight. Offsets index the canonical text. */
export interface TextSelector {
	start: number
	end: number
	exact: string
	prefix: string
	suffix: string
}

export const CONTEXT_CHARS = 32

/**
 * Describe a DOM Range as offsets into the canonical text of `root` plus quote context.
 * Returns null when the range is collapsed or outside `root`.
 */
export function describeRange(range: Range, root: Node): TextSelector | null {
	if (range.collapsed) return null
	if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

	let offset = 0
	let start = -1
	let end = -1
	const parts: string[] = []
	walkTextNodes(root, (node) => {
		const len = node.data.length
		if (start === -1) {
			if (node === range.startContainer) start = offset + range.startOffset
			else if (
				isElementBoundary(range.startContainer) &&
				positionOf(range.startContainer, range.startOffset, node)
			)
				start = offset
		}
		if (end === -1) {
			if (node === range.endContainer) end = offset + range.endOffset
			else if (
				isElementBoundary(range.endContainer) &&
				positionOf(range.endContainer, range.endOffset, node)
			)
				end = offset
		}
		parts.push(node.data)
		offset += len
	})
	const text = parts.join("")
	if (start === -1 && isElementBoundary(range.startContainer))
		start = elementBoundaryOffset(range.startContainer, range.startOffset, root, "start")
	if (end === -1 && isElementBoundary(range.endContainer))
		end = elementBoundaryOffset(range.endContainer, range.endOffset, root, "end")
	if (start < 0 || end < 0 || end <= start) return null
	return selectorFor(text, start, end)
}

function isElementBoundary(node: Node): boolean {
	return node.nodeType !== 3
}

/** True when `textNode` is the first text node at or after child index `offset` of `container`. */
function positionOf(container: Node, offset: number, textNode: Text): boolean {
	const child = container.childNodes[offset] ?? null
	if (!child) return false
	if (child === textNode) return true
	return child.contains(textNode) && firstText(child) === textNode
}

function firstText(node: Node): Text | null {
	let found: Text | null = null
	walkTextNodes(node, (t) => {
		if (!found) found = t
	})
	return found
}

/** Offset for a boundary that sits on an element (e.g. end of a paragraph) rather than inside text. */
function elementBoundaryOffset(
	container: Node,
	childOffset: number,
	root: Node,
	kind: "start" | "end",
): number {
	// Count canonical text length of everything before the boundary.
	let total = 0
	let done = false
	const target = container.childNodes[childOffset] ?? null
	walkTextNodes(root, (node) => {
		if (done) return
		if (target && (node === target || (target.contains(node) && firstText(target) === node))) {
			done = true
			return
		}
		if (
			!target &&
			container.contains(node) === false &&
			kind === "end" &&
			isAfter(container, node)
		) {
			done = true
			return
		}
		total += node.data.length
	})
	if (!target && !done) {
		// Boundary at the end of `container`: everything inside it counts.
		let inside = 0
		walkTextNodes(container, (n) => {
			inside += n.data.length
		})
		let before = 0
		let reached = false
		walkTextNodes(root, (n) => {
			if (reached) return
			if (container.contains(n)) {
				reached = true
				return
			}
			before += n.data.length
		})
		return before + inside
	}
	return total
}

function isAfter(container: Node, node: Node): boolean {
	return Boolean(container.compareDocumentPosition(node) & 4) // DOCUMENT_POSITION_FOLLOWING
}

export function selectorFor(text: string, start: number, end: number): TextSelector {
	return {
		start,
		end,
		exact: text.slice(start, end),
		prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
		suffix: text.slice(end, end + CONTEXT_CHARS),
	}
}

/** Build a DOM Range for canonical text offsets under `root`. Null when out of bounds. */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
	if (end <= start || start < 0) return null
	const doc = root.ownerDocument ?? (root as Document)
	const range = doc.createRange()
	let offset = 0
	let startSet = false
	let endSet = false
	walkTextNodes(root, (node) => {
		if (endSet) return
		const len = node.data.length
		if (!startSet && start >= offset && start < offset + len) {
			range.setStart(node, start - offset)
			startSet = true
		}
		if (startSet && end > offset && end <= offset + len) {
			range.setEnd(node, end - offset)
			endSet = true
		}
		offset += len
	})
	return startSet && endSet ? range : null
}

export interface ResolveResult {
	start: number
	end: number
	/** "position" when offsets matched; "quote" when re-found by text; "ambiguous" lists candidates. */
	via: "position" | "quote"
}

export interface AmbiguousResult {
	ambiguous: true
	candidates: Array<{ start: number; end: number }>
}

/**
 * Resolve a selector against canonical `text`. Position first; if the exact text no longer sits
 * there, search by quote (exactly, then loosely) using prefix/suffix to pick among repeats, and
 * the old position to break a tie. Null when the quote is gone.
 */
export function resolveSelector(
	text: string,
	selector: Pick<TextSelector, "exact"> & Partial<TextSelector>,
): ResolveResult | AmbiguousResult | null {
	const { exact } = selector
	if (!exact) return null
	if (typeof selector.start === "number" && typeof selector.end === "number") {
		if (text.slice(selector.start, selector.end) === exact)
			return { start: selector.start, end: selector.end, via: "position" }
	}
	const exactMatches = findAll(text, exact)
	const candidates = exactMatches.length > 0 ? exactMatches : findLoose(text, exact)
	if (candidates.length === 0) return null
	if (candidates.length === 1) {
		const c = candidates[0] as { start: number; end: number }
		return { ...c, via: "quote" }
	}
	const old = typeof selector.start === "number" ? selector.start : null
	const scored = candidates
		.map((c) => ({
			...c,
			score: contextScore(text, c, selector.prefix ?? "", selector.suffix ?? ""),
			distance: old === null ? 0 : Math.abs(c.start - old),
		}))
		.sort((a, b) => b.score - a.score || a.distance - b.distance)
	const best = scored[0] as (typeof scored)[number]
	const second = scored[1]
	if (second && second.score === best.score && (old === null || second.distance === best.distance))
		return { ambiguous: true, candidates: scored.map(({ start, end }) => ({ start, end })) }
	return { start: best.start, end: best.end, via: "quote" }
}

/** Enough repeats for any real passage; a two-word quote in a long text can have hundreds. */
const MAX_CANDIDATES = 1000

function findAll(text: string, needle: string): Array<{ start: number; end: number }> {
	const out: Array<{ start: number; end: number }> = []
	let from = 0
	while (from <= text.length && out.length < MAX_CANDIDATES) {
		const i = text.indexOf(needle, from)
		if (i === -1) break
		out.push({ start: i, end: i + needle.length })
		from = i + 1
	}
	return out
}

/**
 * Tolerant search for quotes that were copied, re-typed or re-extracted: whitespace collapsed,
 * curly quotes folded, and finally case-insensitive. Every match of the first pass that finds
 * any, as offsets in the original text, so context can choose among them.
 */
function findLoose(text: string, needle: string): Array<{ start: number; end: number }> {
	const passes: Array<(s: string) => string> = [
		(s) => s,
		(s) => foldQuotes(s),
		(s) => foldQuotes(s).toLowerCase(),
	]
	for (const transform of passes) {
		const { norm, map } = normalizeWithMap(text, transform)
		const n = transform(needle).replace(/\s+/g, " ").trim()
		if (!n) return []
		const found = findAll(norm, n)
		if (found.length === 0) continue
		return found.map((m) => ({
			start: map[m.start] as number,
			end: (map[m.end - 1] as number) + 1,
		}))
	}
	return []
}

function foldQuotes(s: string): string {
	return s
		.replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
		.replace(/[\u2013\u2014]/g, "-")
}

/** Collapse whitespace after `transform`, keeping a map from normalized index → original index. */
function normalizeWithMap(
	text: string,
	transform: (s: string) => string,
): { norm: string; map: number[] } {
	const map: number[] = []
	let norm = ""
	let lastSpace = true
	for (let i = 0; i < text.length; i++) {
		// A character can transform into more than one ("İ" lowercases to "i" and a dot): each
		// maps back to the same original index.
		const out = transform(text[i] as string)
		for (let k = 0; k < out.length; k++) {
			const ch = out[k] as string
			if (/\s/.test(ch)) {
				if (!lastSpace) {
					norm += " "
					map.push(i)
					lastSpace = true
				}
				continue
			}
			norm += ch
			map.push(i)
			lastSpace = false
		}
	}
	return { norm, map }
}

function contextScore(
	text: string,
	c: { start: number; end: number },
	prefix: string,
	suffix: string,
): number {
	const before = text.slice(Math.max(0, c.start - CONTEXT_CHARS), c.start)
	const after = text.slice(c.end, c.end + CONTEXT_CHARS)
	return commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix)
}

function commonPrefixLength(a: string, b: string): number {
	let i = 0
	while (i < a.length && i < b.length && a[i] === b[i]) i++
	return i
}

function commonSuffixLength(a: string, b: string): number {
	let i = 0
	while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
	return i
}
