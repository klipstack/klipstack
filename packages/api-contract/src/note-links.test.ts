import { describe, expect, it } from "vitest"
import {
	extractLinkIds,
	insertTitle,
	internalizeReaderLinks,
	parse,
	rewriteNoteLinks,
	type Segment,
	serialize,
} from "./note-links"

const A = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5b"
const B = "0193a5f1-2c3d-7e4f-8a9b-0c1d2e3f4a5c"

const link = (id: string, title: string): Segment => ({ kind: "link", id, title })
const text = (t: string): Segment => ({ kind: "text", text: t })

describe("note links: parse and serialize", () => {
	const cases: Array<[string, string, Segment[][]]> = [
		["empty", "", [[]]],
		["one line", "just words", [[text("just words")]]],
		["blank lines", "a\n\nb", [[text("a")], [], [text("b")]]],
		["link at the start", `[One](/read/${A}) tail`, [[link(A, "One"), text(" tail")]]],
		["link at the end", `head [One](/read/${A})`, [[text("head "), link(A, "One")]]],
		[
			"two adjacent links",
			`[One](/read/${A})[Two](/read/${B})`,
			[[link(A, "One"), link(B, "Two")]],
		],
		[
			"a link per line",
			`[One](/read/${A})\n[Two](/read/${B})`,
			[[link(A, "One")], [link(B, "Two")]],
		],
		["empty link text", `[](/read/${A})`, [[link(A, "")]]],
		["malformed link", "[One](/read/nope)", [[text("[One](/read/nope)")]]],
		[
			"uppercase uuid",
			`[One](/read/${A.toUpperCase()})`,
			[[text(`[One](/read/${A.toUpperCase()})`)]],
		],
		["a bracket before a link", `[[ [One](/read/${A})`, [[text("[[ "), link(A, "One")]]],
	]

	for (const [name, source, expected] of cases) {
		it(`${name} round trips`, () => {
			expect(parse(source)).toEqual(expected)
			expect(serialize(parse(source))).toBe(source)
		})
	}
})

describe("note links: helpers", () => {
	it("lists target ids in order, without repeats", () => {
		expect(extractLinkIds(`[Two](/read/${B}) [One](/read/${A})\n[Again](/read/${B})`)).toEqual([
			B,
			A,
		])
		expect(extractLinkIds("no links here")).toEqual([])
	})

	it("cleans a title for use as link text", () => {
		// The rules live in the contract (names.test.ts); the editor uses the same function.
		expect(insertTitle("A [bracketed]\ntitle")).toBe("A bracketed title")
	})

	it("rewrites links to files, dropping the ones the export has no file for", () => {
		const note = `See [One](/read/${A}) and [Two](/read/${B}).`
		const resolve = (id: string) => (id === A ? "./one.md" : null)
		expect(rewriteNoteLinks(note, resolve)).toBe("See [One](./one.md) and Two.")
	})
})

describe("note links: full reader URLs", () => {
	const origin = "https://klipstack.test"

	it("turns links to the app's reader into note links", () => {
		const text = `See [One](${origin}/read/${A}) and [Two](${origin}/read/${B.toUpperCase()}).`
		const out = internalizeReaderLinks(text, origin)
		expect(out).toBe(`See [One](/read/${A}) and [Two](/read/${B}).`)
		expect(extractLinkIds(out)).toEqual([A, B])
	})

	it("leaves other origins, bare URLs and note links alone", () => {
		const text = [
			`[Elsewhere](https://evil.test/read/${A})`,
			`[Lookalike](${origin}.evil.test/read/${A})`,
			`${origin}/read/${A}`,
			`[Already](/read/${B})`,
		].join("\n")
		expect(internalizeReaderLinks(text, origin)).toBe(text)
	})
})
