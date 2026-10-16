import type { NextEdition } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { editionEar, editionNudge, finishedLine } from "./home-masthead"

describe("finishedLine", () => {
	it("says nothing after a week without a finish", () => {
		expect(finishedLine({ count: 0, title: null })).toBeNull()
	})

	it("names the one article finished, cut short after a word", () => {
		expect(finishedLine({ count: 1, title: "Gardens" })).toEqual({
			before: "You finished ",
			title: "Gardens",
			after: " this past week.",
		})
		const long = `${"word ".repeat(30)}end`
		const line = finishedLine({ count: 1, title: long })!
		expect(Array.from(line.title!).length).toBeLessThanOrEqual(80)
		expect(line.title).toMatch(/^word( word)*…$/)
	})

	it("counts more than one, and says an article without a title", () => {
		expect(finishedLine({ count: 3, title: null })).toEqual({
			before: "You finished 3 articles this past week.",
			title: null,
			after: "",
		})
		expect(finishedLine({ count: 1, title: null })?.before).toBe(
			"You finished an article this past week.",
		)
	})
})

const next = (fields: Partial<NextEdition> = {}): NextEdition => ({
	marked: 0,
	draft: null,
	nudge: null,
	url: "https://klipstack.test/editions",
	...fields,
})

describe("editionEar", () => {
	it("says nothing to a reader with nothing marked and no draft", () => {
		expect(editionEar(next())).toBeNull()
	})

	it("counts the articles marked, and offers to put the edition together", () => {
		expect(editionEar(next({ marked: 3 }))).toEqual({
			count: "3 marked",
			action: "Put it together",
		})
	})

	it("names the draft before the marks", () => {
		expect(editionEar(next({ marked: 2, draft: { items: 1, days: 0 } }))).toEqual({
			count: "1 article in the draft",
			action: "Continue editing",
		})
		expect(editionEar(next({ draft: { items: 4, days: 0 } }))?.count).toBe(
			"4 articles in the draft",
		)
		expect(editionEar(next({ draft: { items: 0, days: 0 } }))?.count).toBe("a draft started")
	})
})

describe("editionNudge", () => {
	it("says why an edition is due", () => {
		expect(editionNudge(next())).toBeNull()
		expect(
			editionNudge(next({ marked: 3, nudge: { reason: "marked", daysSince: null, readSince: 0 } })),
		).toBe("3 articles are marked for the next one.")
		expect(
			editionNudge(next({ marked: 1, nudge: { reason: "stale", daysSince: 15, readSince: 0 } })),
		).toBe("Your last edition came out 2 weeks ago. 1 article is marked for the next one.")
		expect(editionNudge(next({ nudge: { reason: "stale", daysSince: 20, readSince: 6 } }))).toBe(
			"Your last edition came out 2 weeks ago. You finished 6 articles since.",
		)
	})

	it("asks to publish a draft a week old", () => {
		expect(
			editionNudge(
				next({
					draft: { items: 2, days: 8 },
					nudge: { reason: "draft", daysSince: 3, readSince: 0 },
				}),
			),
		).toBe("You started it 8 days ago. Ready to publish it?")
	})
})
