import { selectorFor, type TextSelector, walkTextNodes } from "@klipstack/anchor"
import { QUOTE_MAX } from "@klipstack/api-contract/names"

export type Endpoint = "start" | "end"
export interface Offsets {
	start: number
	end: number
}

/** The browser and the anchor package share raw UTF-16 offsets, including whitespace. */
export function textIndex(root: HTMLElement) {
	const nodes: { node: Text; start: number; end: number }[] = []
	const byNode = new Map<Node, number>()
	let text = ""
	walkTextNodes(root, (node) => {
		byNode.set(node, text.length)
		nodes.push({ node, start: text.length, end: text.length + node.length })
		text += node.data
	})
	const boundaries = [
		...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
	].map((part) => part.index)
	boundaries.push(text.length)
	function offset(node: Node, childOffset: number): number | null {
		if (!root.contains(node) || childOffset < 0) return null
		const start = byNode.get(node)
		if (start !== undefined)
			return childOffset <= (node as Text).length ? start + childOffset : null
		if (childOffset > node.childNodes.length) return null
		// Normalize element boundaries without including text in skipped subtrees.
		const probe = root.ownerDocument.createRange()
		probe.setStart(node, childOffset)
		probe.collapse(true)
		for (const entry of nodes) {
			if (probe.comparePoint(entry.node, 0) >= 0) return entry.start
		}
		return text.length
	}
	function point(value: number, side: Endpoint) {
		let low = 0
		let high = nodes.length
		while (low < high) {
			const mid = (low + high) >>> 1
			const entry = nodes[mid]!
			if (entry.end < value || (side === "start" && entry.end === value)) low = mid + 1
			else high = mid
		}
		const entry = nodes[Math.min(low, nodes.length - 1)]
		return entry ? { node: entry.node, offset: value - entry.start } : null
	}
	function range({ start, end }: Offsets): Range | null {
		if (start < 0 || end > text.length || start >= end) return null
		const a = point(start, "start")
		const b = point(end, "end")
		if (!a || !b) return null
		const result = root.ownerDocument.createRange()
		result.setStart(a.node, a.offset)
		result.setEnd(b.node, b.offset)
		return result
	}
	return {
		root,
		text,
		nodes,
		boundaries,
		offset,
		point,
		range,
		selector: (draft: Offsets): TextSelector => selectorFor(text, draft.start, draft.end),
	}
}
export type TextIndex = ReturnType<typeof textIndex>

function insertionIndex(boundaries: number[], value: number) {
	let low = 0
	let high = boundaries.length
	while (low < high) {
		const mid = (low + high) >>> 1
		if (boundaries[mid]! < value) low = mid + 1
		else high = mid
	}
	return low
}

export function stepBoundary(index: TextIndex, value: number, direction: -1 | 1) {
	const i = insertionIndex(index.boundaries, value)
	return index.boundaries[
		Math.max(
			0,
			Math.min(
				index.boundaries.length - 1,
				direction === -1 ? i - 1 : i + (index.boundaries[i] === value ? 1 : 0),
			),
		)
	]!
}

/** Clamp to a grapheme boundary and retain at least one non-whitespace grapheme. */
export function moveBoundary(
	index: TextIndex,
	draft: Offsets,
	endpoint: Endpoint,
	value: number,
): Offsets {
	const { boundaries, text } = index
	const i = insertionIndex(boundaries, value)
	const next = boundaries[Math.min(i, boundaries.length - 1)]!
	const prev = boundaries[Math.max(0, i - 1)]!
	let target = Math.abs(value - prev) < Math.abs(next - value) ? prev : next
	if (endpoint === "start") {
		const last = text.slice(0, draft.end).search(/\S\s*$/u)
		if (last < 0) return draft
		const max = boundaries[Math.max(0, insertionIndex(boundaries, last + 1) - 1)]!
		const min = boundaries[insertionIndex(boundaries, Math.max(0, draft.end - QUOTE_MAX))]!
		target = Math.min(max, Math.max(min, target))
	} else {
		const first = text.slice(draft.start).search(/\S/u)
		if (first < 0) return draft
		const min = boundaries[insertionIndex(boundaries, draft.start + first + 1)]!
		const max =
			boundaries[
				Math.max(
					0,
					insertionIndex(boundaries, Math.min(text.length, draft.start + QUOTE_MAX) + 1) - 1,
				)
			]!
		target = Math.max(min, Math.min(max, target))
	}
	const result = { ...draft, [endpoint]: target }
	if (result.end - result.start > QUOTE_MAX || !text.slice(result.start, result.end).trim())
		return draft
	return sameOffsets(result, draft) ? draft : result
}
export function sameOffsets(a: Offsets, b: Offsets) {
	return a.start === b.start && a.end === b.end
}

/** Whether a pointer event's position is inside the element's box (edges included). */
export function pointerInside(element: Element, event: { clientX: number; clientY: number }) {
	const box = element.getBoundingClientRect()
	return (
		event.clientX >= box.left &&
		event.clientX <= box.right &&
		event.clientY >= box.top &&
		event.clientY <= box.bottom
	)
}

/** Prefer the standard caret API; WebKit still uses the Range variant. */
export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
	const d = document as Document & {
		caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
		caretRangeFromPoint?: (x: number, y: number) => Range | null
	}
	const p = d.caretPositionFromPoint?.(x, y)
	if (p) return { node: p.offsetNode, offset: p.offset }
	const r = d.caretRangeFromPoint?.(x, y)
	return r ? { node: r.startContainer, offset: r.startOffset } : null
}

export function offsetAtPoint(index: TextIndex, x: number, y: number): number | null {
	const hit = document.elementsFromPoint(x, y).find((el) => !el.closest("[data-resize-handles]"))
	if (!hit || !index.root.contains(hit) || hit.closest("img, video, svg, button")) return null
	const caret = caretAt(x, y)
	if (!caret) return null
	const value = index.offset(caret.node, caret.offset)
	if (value === null) return null
	// Caret APIs also return nearby text for large blank areas. Require actual text at the point.
	const start = stepBoundary(index, value, -1)
	const end = stepBoundary(index, value, 1)
	const range = index.range({ start, end })
	if (
		!range ||
		!Array.from(range.getClientRects()).some(
			(r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top && y <= r.bottom,
		)
	)
		return null
	return value
}

export interface EndpointRect {
	x: number
	top: number
	bottom: number
	node: Node
}

/** Measure the selected side of the boundary, preserving line-wrap and bidi affinity. */
export function endpointRect(
	index: TextIndex,
	draft: Offsets,
	endpoint: Endpoint,
): EndpointRect | null {
	const value = draft[endpoint]
	const adjacent =
		endpoint === "start"
			? { start: value, end: stepBoundary(index, value, 1) }
			: { start: stepBoundary(index, value, -1), end: value }
	const range = index.range(adjacent)
	if (!range) return null
	const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0 && r.width > 0)
	const rect = endpoint === "start" ? rects[0] : rects.at(-1)
	if (!rect) return null
	const node = endpoint === "start" ? range.startContainer : range.endContainer
	const collapsed = range.cloneRange()
	collapsed.collapse(endpoint === "start")
	const caret = collapsed.getClientRects()[0]
	const char = index.text.slice(adjacent.start, adjacent.end)
	const rtl =
		/[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(char) ||
		(!/[\p{L}\p{N}]/u.test(char) && getComputedStyle(node.parentElement!).direction === "rtl")
	let x = (endpoint === "start") !== rtl ? rect.left : rect.right
	if (
		caret &&
		caret.height > 0 &&
		Math.abs(caret.top - rect.top) < 2 &&
		(Math.abs(caret.x - rect.left) < 1 || Math.abs(caret.x - rect.right) < 1)
	)
		x = caret.x
	return { x, top: rect.top, bottom: rect.bottom, node }
}

export function endpointVisible(rect: EndpointRect, root: HTMLElement, headerBottom: number) {
	if (
		rect.top < headerBottom ||
		rect.bottom > window.innerHeight ||
		rect.x < 12 ||
		rect.x > window.innerWidth - 12
	)
		return false
	for (let el = rect.node.parentElement; el; el = el.parentElement) {
		const style = getComputedStyle(el)
		const box = el.getBoundingClientRect()
		if (
			/(auto|scroll|hidden|clip)/.test(style.overflowX) &&
			(rect.x - 12 < box.left || rect.x + 12 > box.right)
		)
			return false
		if (
			/(auto|scroll|hidden|clip)/.test(style.overflowY) &&
			(rect.top - 12 < box.top || rect.bottom + 12 > box.bottom)
		)
			return false
		if (el === root) break
	}
	return true
}
