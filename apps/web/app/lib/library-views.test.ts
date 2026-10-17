import { describe, expect, it } from "vitest"
import { isLibraryPath } from "./library-views"

describe("isLibraryPath", () => {
	it("is every view of the library, the sidebar's one entry", () => {
		for (const path of ["/library", "/library/", "/archive", "/starred", "/trash"])
			expect(isLibraryPath(path), path).toBe(true)
	})

	it("is not the review, which has a page of its own, nor other pages", () => {
		for (const path of ["/library/review", "/notebook", "/starred-things", "/"])
			expect(isLibraryPath(path), path).toBe(false)
	})
})
