import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { currentSection, outlineOf } from "./outline"

function body(html: string) {
	return new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
}

const outline = (html: string) => outlineOf(body(html)).map(({ text, depth }) => [text, depth])

describe("outlineOf", () => {
	it("takes h2–h6 in two levels: the highest one present, and every lower one under it", () => {
		expect(outline("<h3>A</h3><h4>B</h4><h6>C</h6><h3>D</h3><h5>E</h5>")).toEqual([
			["A", 0],
			["B", 1],
			["C", 1],
			["D", 0],
			["E", 1],
		])
		// The title's level is not the article's.
		expect(outline("<h1>Title</h1><h2>A</h2><h3>B</h3>")).toEqual([
			["A", 0],
			["B", 1],
		])
	})

	it("leaves out headings in lists, quotes, tables, figures, asides and details, and empty ones", () => {
		const nested = [
			"<ul><li><h3>list</h3></li></ul>",
			"<blockquote><h3>quote</h3></blockquote>",
			"<table><tr><th><h3>th</h3></th><td><h3>td</h3></td></tr></table>",
			"<figure><h3>figure</h3></figure>",
			"<aside><h3>aside</h3></aside>",
			"<details><summary>s</summary><h3>details</h3></details>",
		].join("")
		// Left out, the nested h3s don't make h3 the top level either.
		expect(outline(`<h2>Kept</h2>${nested}<h2> </h2><h3>Under</h3>`)).toEqual([
			["Kept", 0],
			["Under", 1],
		])
	})

	it("joins a heading's whitespace, and numbers repeated headings so each has its own key", () => {
		const entries = outlineOf(body("<h2>Notes\n  <em>here</em></h2><h2>Notes here</h2><h2>X</h2>"))
		expect(entries.map((e) => e.key)).toEqual(["Notes here#0", "Notes here#1", "X#0"])
	})

	it("is empty without headings", () => {
		expect(outline("<p>Text.</p>")).toEqual([])
	})
})

describe("currentSection", () => {
	it("is the last heading at or above the line, -1 before the first", () => {
		const root = body("<h2>A</h2><h2>B</h2><h2>C</h2>")
		const entries = outlineOf(root)
		const at = (tops: number[]) => {
			entries.forEach((entry, i) => {
				entry.el.getBoundingClientRect = () => ({ top: tops[i] }) as DOMRect
			})
		}
		at([100, 400, 900])
		expect(currentSection(entries, 50)).toBe(-1)
		expect(currentSection(entries, 100)).toBe(0)
		expect(currentSection(entries, 500)).toBe(1)
		at([-900, -400, -100])
		expect(currentSection(entries, 300)).toBe(2)
	})
})
