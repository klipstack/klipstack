import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { describeRange, rangeFromOffsets, resolveSelector, selectorFor } from "./selectors"
import { canonicalText } from "./text"

const html = `<p>One <b>two</b> three.</p>
<p>Four five <i>six</i> seven.</p>
<p>Repeated phrase here. Repeated phrase there.</p>`

function setup() {
	const dom = new JSDOM(`<!doctype html><body><div id="root">${html}</div></body>`)
	const root = dom.window.document.getElementById("root") as HTMLElement
	return { dom, root, text: canonicalText(root) }
}

describe("describeRange / rangeFromOffsets", () => {
	it("round-trips a range inside one text node", () => {
		const { root, text } = setup()
		const p = root.querySelector("p") as HTMLElement
		const range = root.ownerDocument.createRange()
		range.setStart(p.firstChild as Text, 0)
		range.setEnd(p.firstChild as Text, 3)
		const sel = describeRange(range, root)
		expect(sel).toMatchObject({ start: 0, end: 3, exact: "One", prefix: "" })
		const back = rangeFromOffsets(root, sel!.start, sel!.end)
		expect(back?.toString()).toBe("One")
		expect(text.slice(sel!.start, sel!.end)).toBe("One")
	})

	it("round-trips a range spanning elements", () => {
		const { root, text } = setup()
		const ps = root.querySelectorAll("p")
		const range = root.ownerDocument.createRange()
		range.setStart(ps[0]?.querySelector("b")?.firstChild as Text, 1) // "wo"
		range.setEnd(ps[1]?.firstChild as Text, 4) // "Four"
		const sel = describeRange(range, root)
		expect(sel?.exact).toBe("wo three.\nFour")
		expect(text.slice(sel!.start, sel!.end)).toBe(sel!.exact)
		expect(rangeFromOffsets(root, sel!.start, sel!.end)?.toString()).toBe("wo three.\nFour")
	})

	it("handles element-boundary endpoints (triple-click paragraph selection)", () => {
		const { root } = setup()
		const p = root.querySelectorAll("p")[1] as HTMLElement
		const range = root.ownerDocument.createRange()
		range.setStart(p, 0)
		range.setEnd(p, p.childNodes.length)
		const sel = describeRange(range, root)
		expect(sel?.exact).toBe("Four five six seven.")
	})

	it("rejects collapsed ranges", () => {
		const { root } = setup()
		const range = root.ownerDocument.createRange()
		range.setStart(root.querySelector("p")?.firstChild as Text, 1)
		range.collapse(true)
		expect(describeRange(range, root)).toBeNull()
	})
})

describe("resolveSelector", () => {
	const { text } = setup()

	it("uses the position when the text still matches", () => {
		const sel = selectorFor(text, 4, 7)
		expect(resolveSelector(text, sel)).toEqual({ start: 4, end: 7, via: "position" })
	})

	it("re-finds a unique quote after offsets shift", () => {
		const sel = selectorFor(text, 4, 7) // "two"
		const shifted = `INSERTED ${text}`
		expect(resolveSelector(shifted, sel)).toEqual({ start: 13, end: 16, via: "quote" })
	})

	it("disambiguates repeats with prefix/suffix", () => {
		const first = text.indexOf("Repeated phrase")
		const second = text.indexOf("Repeated phrase", first + 1)
		const sel = selectorFor(text, second, second + "Repeated phrase".length)
		const r = resolveSelector(text, { exact: sel.exact, prefix: sel.prefix, suffix: sel.suffix })
		expect(r).toEqual({ start: second, end: second + 15, via: "quote" })
	})

	it("reports ambiguity when context cannot decide", () => {
		const r = resolveSelector("ab ab", { exact: "ab" })
		expect(r).toMatchObject({ ambiguous: true })
		expect((r as { candidates: unknown[] }).candidates).toHaveLength(2)
	})

	it("tolerates whitespace differences", () => {
		const r = resolveSelector(text, { exact: "Four  five\nsix" })
		expect(r).toEqual({
			start: text.indexOf("Four"),
			end: text.indexOf("Four") + "Four five six".length,
			via: "quote",
		})
	})

	it("folds curly quotes and falls back to case-insensitive matching", () => {
		const t2 = "The maker’s schedule is different."
		expect(resolveSelector(t2, { exact: "maker's schedule" })).toEqual({
			start: 4,
			end: 20,
			via: "quote",
		})
		expect(resolveSelector(t2, { exact: "Maker's Schedule" })).toEqual({
			start: 4,
			end: 20,
			via: "quote",
		})
	})

	it("returns null when the quote is gone", () => {
		expect(resolveSelector(text, { exact: "not in the text" })).toBeNull()
	})

	it("picks among loose matches by context, as among exact ones", () => {
		// Re-extracted with different spacing: the quote matches loosely, twice.
		const t2 = "Alpha  one  two beta. Gamma  one  two delta."
		const r = resolveSelector(t2, { exact: "one two", prefix: "Gamma ", suffix: " delta" })
		const at = t2.indexOf("one", t2.indexOf("Gamma"))
		expect(r).toEqual({ start: at, end: at + "one  two".length, via: "quote" })
	})

	it("finds a repeat past the fiftieth", () => {
		const t2 = `${"of the ".repeat(60)}of the end`
		const at = t2.lastIndexOf("of the")
		const r = resolveSelector(t2, { exact: "of the", prefix: "of the ", suffix: " end" })
		expect(r).toEqual({ start: at, end: at + 6, via: "quote" })
	})

	it("breaks a tie by the old position", () => {
		// The text moved a little; nothing around the three repeats tells them apart.
		const t2 = "__x ab y x ab y x ab y"
		const middle = t2.indexOf("ab", 5)
		const r = resolveSelector(t2, { exact: "ab", start: middle - 3, end: middle - 1 })
		expect(r).toEqual({ start: middle, end: middle + 2, via: "quote" })
	})

	it("keeps offsets right after a character that lowercases to two", () => {
		const t2 = "İstanbul and The Maker's Schedule"
		expect(resolveSelector(t2, { exact: "the maker's schedule" })).toEqual({
			start: t2.indexOf("The"),
			end: t2.length,
			via: "quote",
		})
	})
})
