import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EmptyDrawing } from "./empty-drawing"

describe("EmptyDrawing", () => {
	it.each(["shelf", "desk"] as const)("draws the %s as decoration, in the app's colors", (name) => {
		const html = renderToStaticMarkup(<EmptyDrawing name={name} className="w-32" />)
		expect(html).toMatch(new RegExp(`^<span aria-hidden="true" data-empty-drawing="${name}"`))
		expect(html).toContain("w-32")
		expect(html).toContain("<svg")
		// Wood from the shelves' token, so it follows light and dark; no hex colors.
		expect(html).toContain("var(--k-shelf)")
		expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i)
	})
})
