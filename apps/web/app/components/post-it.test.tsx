import { readFileSync } from "node:fs"
import { HIGHLIGHT_COLORS } from "@klipstack/api-contract/enums"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PostIt, postItSize, tiltFor } from "./post-it"

const classes = (html: string) =>
	new Set(/class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/).filter(Boolean) ?? [])

const tiltOf = (html: string) => [...classes(html)].find((c) => c.includes("rotate-"))

/** The characters of text a line holds, from the width `postItSize` gives. */
const lineOf = (text: string) => Number(/calc\((\d+)ch/.exec(String(postItSize(text).width))?.[1])

describe("PostIt", () => {
	it("full: an edition's note as it always looked, tilted, with tape", () => {
		const html = renderToStaticMarkup(
			<PostIt tilt={1} className="mt-10 w-fit" data-testid="note">
				Words
			</PostIt>,
		)
		// The classes the edition page's own PostIt had before it moved here.
		const before =
			"relative bg-note px-5 pt-6 pb-5 font-serif text-note-fg italic shadow-[0_1px_1px_rgb(0_0_0/0.08),0_12px_24px_-12px_rgb(0_0_0/0.4)] rotate-[1deg] mt-10 w-fit"
		const after = classes(html)
		for (const name of before.split(" ")) expect(after).toContain(name)
		expect(html).toMatch(/^<div data-testid="note"/)
		expect(html).toContain("bg-note-tape")
		expect(html).toContain("Words")
	})

	it("full: neighbors lean apart, and the tilts come round again", () => {
		const tilt = (n: number) => tiltOf(renderToStaticMarkup(<PostIt tilt={n}>x</PostIt>))
		expect(tilt(0)).toBe("-rotate-[1.4deg]")
		expect(tilt(1)).not.toBe(tilt(0))
		expect(tilt(4)).toBe(tilt(0))
	})

	it("compact: the same paper and hand and tape, leaning barely", () => {
		const html = renderToStaticMarkup(
			<PostIt variant="compact" as="span">
				Note
			</PostIt>,
		)
		const names = classes(html)
		for (const name of ["bg-note", "text-note-fg", "font-serif", "italic", "block"])
			expect(names).toContain(name)
		expect(html).toContain("bg-note-tape")
		expect(html).toMatch(/^<span /)
		expect(html).toContain('data-post-it="compact"')
		// Under a degree either way, and neighbors lean apart.
		const tilt = (n: number) =>
			tiltOf(
				renderToStaticMarkup(
					<PostIt variant="compact" tilt={n}>
						x
					</PostIt>,
				),
			)
		for (const n of [0, 1, 2, 3])
			expect(Math.abs(Number(/\[(-?[\d.]+)deg\]/.exec(tilt(n) ?? "")?.[1]))).toBeLessThan(1)
		expect(tilt(1)).not.toBe(tilt(0))
	})

	it("a lean per id: the same for a note and its editor, any id", () => {
		expect(tiltFor("a5b1")).toBe(tiltFor("a5b1"))
		expect(
			new Set(["a", "b", "c", "d", "e", "f"].map((id) => tiltFor(id) % 4)).size,
		).toBeGreaterThan(1)
		expect(
			tiltOf(renderToStaticMarkup(<PostIt tilt={tiltFor("0198-ffff-ffff")}>x</PostIt>)),
		).toBeDefined()
	})

	it("fit: short notes are small and square-ish, longer ones grow, within bounds", () => {
		expect(lineOf("Yes!")).toBe(14)
		const short = lineOf("Why I block mornings.")
		const medium = lineOf("x".repeat(160))
		const long = lineOf("x".repeat(600))
		expect(medium).toBeGreaterThan(short)
		expect(long).toBeGreaterThan(medium)
		expect(lineOf("x".repeat(5000))).toBe(52)
		// At the width given, the text's lines are about as tall as they are wide.
		const lines = 160 / medium
		expect(lines * 2.75).toBeGreaterThan(medium * 0.5)
		expect(lines * 2.75).toBeLessThan(medium * 1.1)
		// Never wider than the room there is, and never a strip: a least height for the width.
		expect(postItSize("x").width).toMatch(/^min\(100%, /)
		expect(postItSize("x").minHeight).toBe("calc(calc(14ch + 2.5rem) * 0.62)")
		expect(postItSize("x", "compact").minHeight).toBe("calc(calc(14ch + 1.5rem) * 0.5)")
		// A link counts as its title.
		const id = "0198c0de-0000-7000-8000-000000000000"
		expect(lineOf(`See [Maker's schedule](/read/${id}) again`)).toBe(
			lineOf("See Maker's schedule again"),
		)
		// A line break counts as a line of its own.
		expect(lineOf("a\nb\nc\nd")).toBeGreaterThan(lineOf("abcd"))
		const html = renderToStaticMarkup(<PostIt fit="Short.">Short.</PostIt>)
		expect(html).toContain("width:min(100%, calc(14ch + 2.5rem))")
		expect(html).toContain("min-height:calc(calc(14ch + 2.5rem) * 0.62)")
	})
	it("color: a highlight's note is paper in its color; yellow and none are the classic paper", () => {
		const colorOf = (html: string) => /data-note-color="([^"]*)"/.exec(html)?.[1]
		expect(colorOf(renderToStaticMarkup(<PostIt color="green">x</PostIt>))).toBe("green")
		expect(
			colorOf(
				renderToStaticMarkup(
					<PostIt color="pink" variant="compact" blank>
						x
					</PostIt>,
				),
			),
		).toBe("pink")
		expect(colorOf(renderToStaticMarkup(<PostIt color="yellow">x</PostIt>))).toBeUndefined()
		expect(colorOf(renderToStaticMarkup(<PostIt>x</PostIt>))).toBeUndefined()
	})

	it("color: every color but yellow has its paper and ink, in light and both dark themes", () => {
		const css = readFileSync(new URL("../app.css", import.meta.url), "utf8")
		for (const color of HIGHLIGHT_COLORS.filter((c) => c !== "yellow")) {
			expect(css).toMatch(
				new RegExp(
					`\\[data-note-color="${color}"\\] \\{\\s*--k-note: var\\(--k-note-${color}\\);\\s*--k-note-fg: var\\(--k-note-${color}-fg\\);`,
				),
			)
			for (const name of [`--k-note-${color}:`, `--k-note-${color}-fg:`])
				expect(css.split(name).length - 1).toBe(3)
		}
	})
})
