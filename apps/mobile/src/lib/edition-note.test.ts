import { describe, expect, it } from "vitest"
import { editionFromNote } from "./edition-note"

const ID = "0190a3c4-1111-7000-8000-000000000001"

describe("editionFromNote", () => {
	it("adds the note after the edition note, its links as their titles, each line a paragraph", () => {
		expect(editionFromNote("", `Read it.\nSee [The other](/read/${ID}) too.`)).toBe(
			"Read it.\n\nSee The other too.",
		)
		expect(editionFromNote("Why it matters. \n", "Mine.")).toBe("Why it matters.\n\nMine.")
	})

	it("offers nothing without a note, or once the note is in", () => {
		expect(editionFromNote("Why.", "  \n")).toBeNull()
		expect(editionFromNote("Why.\n\nMine.", "Mine.")).toBeNull()
	})
})
