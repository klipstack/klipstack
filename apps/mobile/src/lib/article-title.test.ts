import { ARTICLE_TITLE_MAX } from "@klipstack/api-contract/names"
import { describe, expect, it } from "vitest"
import { newTitle } from "./article-title"

describe("newTitle", () => {
	it("sends the typed title, trimmed", () => {
		expect(newTitle("  A better title \n", "Old")).toBe("A better title")
		expect(newTitle("A title", null)).toBe("A title")
	})

	it("sends nothing for an empty or unchanged title", () => {
		expect(newTitle("   ", "Old")).toBeNull()
		expect(newTitle(undefined, "Old")).toBeNull()
		expect(newTitle(" Old ", "Old")).toBeNull()
	})

	it("cuts a long title to what the server takes, as the web's field does", () => {
		const title = newTitle(`${"a".repeat(ARTICLE_TITLE_MAX)}bcd`, "Old")
		expect(title).toBe("a".repeat(ARTICLE_TITLE_MAX))
	})
})
