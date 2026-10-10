import { describe, expect, it } from "vitest"
import { tagChange, tagChoices, tagState, withChange } from "./article-tags"

const one = { id: "a", tags: ["Essays"] }
const two = { id: "b", tags: [] }

describe("tagState", () => {
	it("says whether all, some or none of the articles have a tag, whatever its case", () => {
		expect(tagState([one], "essays")).toBe("all")
		expect(tagState([one, two], "Essays")).toBe("some")
		expect(tagState([two], "Essays")).toBe("none")
	})
})

describe("tagChange", () => {
	it("adds a tag some articles lack, and takes away one all have", () => {
		expect(tagChange([one, two], "essays")).toEqual({ addTags: ["essays"] })
		expect(tagChange([one], "essays")).toEqual({ removeTags: ["essays"] })
	})
})

describe("withChange", () => {
	it("adds a tag once, and removes it whatever its case", () => {
		const added = withChange([one, two], { addTags: ["essays"] })
		expect(added.get("a")).toEqual(["Essays"])
		expect(added.get("b")).toEqual(["essays"])
		expect(withChange([one], { removeTags: ["ESSAYS"] }).get("a")).toEqual([])
	})
})

describe("tagChoices", () => {
	const names = ["Essays", "life", "Work Advice"]

	it("lists every tag for nothing typed", () => {
		expect(tagChoices(names, "  ")).toEqual({ names, create: null })
	})

	it("filters by the text, and offers a new name cleaned as the server cleans it", () => {
		expect(tagChoices(names, "wor")).toEqual({ names: ["Work Advice"], create: "wor" })
		expect(tagChoices(names, "  new   tag ")).toEqual({ names: [], create: "new tag" })
	})

	it("offers no name a tag has already, or one that can't be a name", () => {
		expect(tagChoices(names, "work advice").create).toBeNull()
		expect(tagChoices(names, 'a "quoted" tag').create).toBeNull()
	})
})
