import { canonicalText } from "@klipstack/anchor"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import {
	moveBoundary,
	pointerInside,
	sameOffsets,
	stepBoundary,
	textIndex,
} from "./highlight-resize"

function setup(html: string) {
	const root = new JSDOM(`<article>${html}</article>`).window.document.querySelector("article")!
	return { root, index: textIndex(root) }
}

describe("resize text index", () => {
	it("uses canonical offsets across inline, paragraph, and element boundaries", () => {
		const { root, index } = setup(
			'<p>First <strong>bold</strong> <a href="#">link</a>.</p><p>Next 👩🏽‍💻 é.</p><script>ignored</script>',
		)
		expect(index.text).toBe(canonicalText(root))
		for (let start = 0; start < index.text.length; start++) {
			const range = index.range({ start, end: index.text.length })!
			expect(range.toString()).toBe(index.text.slice(start))
			expect(index.offset(range.startContainer, range.startOffset)).toBe(start)
		}
		const p = root.querySelector("p")!
		expect(index.offset(p, 1)).toBe(6)
		expect(index.offset(p, p.childNodes.length)).toBe(16)
		expect(index.offset(root, 1)).toBe(16)
		expect(index.offset(root, root.childNodes.length)).toBe(index.text.length)
		expect(index.offset(root.ownerDocument.body, 0)).toBeNull()
		expect(index.range({ start: 0, end: 1000 })).toBeNull()
	})
	it("moves whole graphemes, including emoji sequences and combining marks", () => {
		const { index } = setup("A👩🏽‍💻é🇨🇱Z")
		expect(index.boundaries).toEqual([0, 1, 8, 10, 14, 15])
		expect(stepBoundary(index, 1, 1)).toBe(8)
		expect(stepBoundary(index, 10, -1)).toBe(8)
		expect(stepBoundary(index, 0, -1)).toBe(0)
		expect(stepBoundary(index, 15, 1)).toBe(15)
		expect(moveBoundary(index, { start: 0, end: 15 }, "start", 6)).toEqual({ start: 8, end: 15 })
	})
	it("clamps crossing, whitespace, and the quote length limit", () => {
		const { index } = setup("  A 👩🏽‍💻   ")
		expect(moveBoundary(index, { start: 0, end: index.text.length }, "start", 100)).toEqual({
			start: 4,
			end: index.text.length,
		})
		expect(moveBoundary(index, { start: 0, end: index.text.length }, "end", -100)).toEqual({
			start: 0,
			end: 3,
		})
		const long = setup("x".repeat(20_001)).index
		expect(moveBoundary(long, { start: 0, end: 10 }, "end", 20_001).end).toBe(20_000)
		expect(moveBoundary(long, { start: 20_000, end: 20_001 }, "start", 0).start).toBe(1)
	})
	it("retains unchanged drafts and permits one-word explicit edits", () => {
		const { index } = setup("one two three")
		const draft = { start: 0, end: 7 }
		expect(moveBoundary(index, draft, "start", 0)).toBe(draft)
		expect(index.selector(moveBoundary(index, draft, "end", 3)).exact).toBe("one")
		expect(sameOffsets(draft, { start: 0, end: 7 })).toBe(true)
	})
})

describe("pointerInside", () => {
	const handle = {
		getBoundingClientRect: () => ({ left: 500, right: 524, top: 230, bottom: 262 }),
	} as unknown as Element

	it("counts the edges as inside, and a pixel past them as outside", () => {
		expect(pointerInside(handle, { clientX: 514, clientY: 246 })).toBe(true)
		expect(pointerInside(handle, { clientX: 500, clientY: 230 })).toBe(true)
		expect(pointerInside(handle, { clientX: 524, clientY: 262 })).toBe(true)
		expect(pointerInside(handle, { clientX: 525, clientY: 246 })).toBe(false)
		expect(pointerInside(handle, { clientX: 514, clientY: 229 })).toBe(false)
	})
})
