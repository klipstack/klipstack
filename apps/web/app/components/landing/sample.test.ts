import { describe, expect, it } from "vitest"
import { TIME_CHOICES } from "~/lib/inbox-filters"
import { sampleShelves } from "./sample"

const ids = (shelves: ReturnType<typeof sampleShelves>) =>
	[...shelves.reading, ...shelves.recent, ...shelves.rediscover].map((s) => s.id)

describe("the landing page's sample Home", () => {
	it("offers the sample essay, which the walkthrough follows, at every time choice", () => {
		for (const minutes of [null, ...TIME_CHOICES.filter((m) => m < 60)])
			expect(ids(sampleShelves(minutes))).toContain("essay")
	})

	it("sorts by Home's rules: what fits, longer reads first as the time grows", () => {
		// The walk has 9 minutes left: past 5, so it stays only as where the reader left off.
		expect(sampleShelves(5)).toMatchObject({ pickUp: true })
		expect(ids(sampleShelves(5))).toEqual(["walk", "essay"])
		expect(ids(sampleShelves(15))).toEqual(["walk", "benches", "essay", "bread"])
		expect(ids(sampleShelves(30))).toEqual(["walk", "essay", "benches", "cards", "bread"])
		expect(sampleShelves(30)).toMatchObject({ pickUp: false })
	})
})
