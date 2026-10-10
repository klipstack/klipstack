import { describe, expect, it } from "vitest"
import { applyEdit, fromStored, insertLink, runs, toStored } from "./note-field"

const A = "0b1c2d3e-0000-4000-8000-000000000001"
const B = "0b1c2d3e-0000-4000-8000-000000000002"
const stored = `See [One](/read/${A}) and\n[Two](/read/${B}).`

describe("fromStored and toStored", () => {
	it("shows links as their titles and puts them back", () => {
		const state = fromStored(stored)
		expect(state.text).toBe("See One and\nTwo.")
		expect(state.links).toEqual([
			{ start: 4, end: 7, id: A },
			{ start: 12, end: 15, id: B },
		])
		expect(toStored(state)).toBe(stored)
	})

	it("leaves text without links and malformed links as they are", () => {
		for (const text of ["", "plain\n\nlines", "[x](/read/not-a-uuid)", "[[ [a]"])
			expect(toStored(fromStored(text))).toBe(text)
	})
})

describe("applyEdit", () => {
	const state = fromStored(stored)

	it("moves links after typing before them and keeps those before", () => {
		const { state: next, cursor } = applyEdit(state, "So, see One and\nTwo.")
		expect(cursor).toBeUndefined()
		expect(toStored(next)).toBe(`So, see [One](/read/${A}) and\n[Two](/read/${B}).`)
	})

	it("keeps a link when typing right after it", () => {
		const { state: next } = applyEdit(state, "See One! and\nTwo.")
		expect(toStored(next)).toBe(`See [One](/read/${A})! and\n[Two](/read/${B}).`)
	})

	it("makes a title plain text when typing inside it", () => {
		const { state: next } = applyEdit(state, "See Onne and\nTwo.")
		expect(toStored(next)).toBe(`See Onne and\n[Two](/read/${B}).`)
	})

	it("removes the whole link when a deletion reaches into it", () => {
		// Backspace at the end of "One".
		const { state: next, cursor } = applyEdit(state, "See On and\nTwo.")
		expect(next.text).toBe("See  and\nTwo.")
		expect(cursor).toBe(4)
		expect(toStored(next)).toBe(`See  and\n[Two](/read/${B}).`)
	})

	it("removes every link a deleted selection touches", () => {
		const { state: next, cursor } = applyEdit(state, "See O.")
		expect(next.text).toBe("See .")
		expect(cursor).toBe(4)
		expect(next.links).toEqual([])
	})

	it("replaces a selection over a link with the typed text, unlinked", () => {
		const { state: next } = applyEdit(state, "See X and\nTwo.")
		expect(toStored(next)).toBe(`See X and\n[Two](/read/${B}).`)
	})
})

describe("insertLink", () => {
	it("puts the link and a space at the cursor", () => {
		const { state, cursor } = insertLink(
			fromStored("Read "),
			{ start: 5, end: 5 },
			{
				id: A,
				title: "A [great]  essay",
			},
		)
		expect(toStored(state)).toBe(`Read [A great essay](/read/${A}) `)
		expect(cursor).toBe(19)
	})

	it("adds no second space and replaces the selection", () => {
		const { state, cursor } = insertLink(
			fromStored(`x ${"old"} y`),
			{ start: 2, end: 5 },
			{
				id: B,
				title: "Two",
			},
		)
		expect(toStored(state)).toBe(`x [Two](/read/${B}) y`)
		expect(cursor).toBe(6)
	})

	it("puts a space before the link when it would touch a word", () => {
		const { state, cursor } = insertLink(
			fromStored("See."),
			{ start: 4, end: 4 },
			{ id: A, title: "One" },
		)
		expect(toStored(state)).toBe(`See. [One](/read/${A}) `)
		expect(cursor).toBe(9)
	})

	it("keeps the other links in place", () => {
		const { state } = insertLink(fromStored(stored), { start: 0, end: 0 }, { id: B, title: "Z" })
		expect(toStored(state)).toBe(`[Z](/read/${B}) See [One](/read/${A}) and\n[Two](/read/${B}).`)
	})
})

describe("runs", () => {
	it("splits the text into plain and link runs", () => {
		expect(runs(fromStored(stored)).map((r) => [r.text, r.link?.id ?? null])).toEqual([
			["See ", null],
			["One", A],
			[" and\n", null],
			["Two", B],
			[".", null],
		])
	})
})
