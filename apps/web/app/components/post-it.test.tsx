import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PostIt } from "./post-it"

const classes = (html: string) =>
	new Set(/class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/).filter(Boolean) ?? [])

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
		const tilt = (n: number) =>
			[...classes(renderToStaticMarkup(<PostIt tilt={n}>x</PostIt>))].find((c) =>
				c.includes("rotate-"),
			)
		expect(tilt(0)).toBe("-rotate-[1.4deg]")
		expect(tilt(1)).not.toBe(tilt(0))
		expect(tilt(4)).toBe(tilt(0))
	})

	it("compact: the same paper and hand, with no tilt and no tape", () => {
		const html = renderToStaticMarkup(
			<PostIt variant="compact" as="span">
				Note
			</PostIt>,
		)
		const names = classes(html)
		for (const name of ["bg-note", "text-note-fg", "font-serif", "italic", "block"])
			expect(names).toContain(name)
		expect([...names].some((c) => c.includes("rotate"))).toBe(false)
		expect(html).not.toContain("bg-note-tape")
		expect(html).toMatch(/^<span /)
		expect(html).toContain('data-post-it="compact"')
	})
})
