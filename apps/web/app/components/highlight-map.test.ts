import { describe, expect, it } from "vitest"
import { mapMarks } from "./highlight-map"

const many = (count: number) => `${count} close`
const items = new Map(
	["a", "b", "c"].map((id, i) => [id, { id, color: i, exact: `Quote ${id}` }] as const),
)

describe("mapMarks", () => {
	it("merges marks less than 4px apart on the strip, and keeps those 4px or more apart", () => {
		// On a 1000px strip: a ends at 100px, b starts 3.5px later, c starts 4.5px after b ends.
		const marks = mapMarks(
			[
				{ id: "c", top: 0.1125, bottom: 0.12 },
				{ id: "a", top: 0.09, bottom: 0.1 },
				{ id: "b", top: 0.1035, bottom: 0.108 },
			],
			items,
			1000,
			many,
		)
		expect(marks.map((m) => ({ ids: m.ids, colors: m.colors, label: m.label }))).toEqual([
			{ ids: ["a", "b"], colors: [0, 1], label: "2 close" },
			{ ids: ["c"], colors: [2], label: "Quote c" },
		])
	})

	it("draws a short highlight at least 3px tall, and skips one it does not know", () => {
		const [mark, ...rest] = mapMarks(
			[
				{ id: "a", top: 0.5, bottom: 0.5001 },
				{ id: "gone", top: 0.7, bottom: 0.71 },
			],
			items,
			1000,
			many,
		)
		expect(rest).toEqual([])
		expect((mark!.bottom - mark!.top) * 1000).toBeCloseTo(3)
	})
})
