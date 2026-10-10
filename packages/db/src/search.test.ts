import { describe, expect, it } from "vitest"
import { fallbackWords } from "./search"

describe("fallbackWords", () => {
	it("splits a query into its distinct words", () => {
		expect(fallbackWords("Remote  teams, remote work")).toEqual(["remote", "teams", "work"])
		expect(fallbackWords("decisión difícil")).toEqual(["decisión", "difícil"])
	})

	it("is empty when there is nothing to relax", () => {
		expect(fallbackWords("remote")).toEqual([])
		expect(fallbackWords("remote remote")).toEqual([])
		expect(fallbackWords("")).toEqual([])
	})

	it("is empty when the query asks for strictness", () => {
		expect(fallbackWords('"remote teams"')).toEqual([])
		expect(fallbackWords("remote -teams")).toEqual([])
	})

	it("keeps a hyphenated word", () => {
		expect(fallbackWords("long-form essays")).toEqual(["long", "form", "essays"])
	})
})
