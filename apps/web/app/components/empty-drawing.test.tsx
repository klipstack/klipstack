import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { EmptyDrawing, type EmptyDrawingName } from "./empty-drawing"

/** The token each drawing paints its main surface with, so it follows light and dark. */
const PAINT = {
	shelf: "var(--k-shelf)",
	desk: "var(--k-shelf)",
	chair: "var(--k-book-l)",
	bookcase: "var(--k-shelf)",
	box: "var(--k-shelf)",
	basket: "var(--k-shelf)",
	mailbox: "var(--k-book-l)",
	stickers: "var(--k-favorite)",
	tags: "var(--k-book-l)",
} as const satisfies Record<EmptyDrawingName, string>

describe("EmptyDrawing", () => {
	it.each(Object.entries(PAINT))("draws the %s as decoration, in %s", (name, paint) => {
		const html = renderToStaticMarkup(
			<EmptyDrawing name={name as EmptyDrawingName} className="w-32" />,
		)
		expect(html).toMatch(new RegExp(`^<span aria-hidden="true" data-empty-drawing="${name}"`))
		expect(html).toContain("w-32")
		expect(html).toContain("<svg")
		expect(html).toContain(paint)
		expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i)
	})
})
