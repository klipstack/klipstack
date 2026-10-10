import { describe, expect, it } from "vitest"
import { fitsIn, homeShelves } from "./home-shelves"

const doc = (id: string, minutesLeft: number | null) => ({ id, minutesLeft })
const ids = (docs: { id: string }[]) => docs.map((d) => d.id)

describe("homeShelves", () => {
	it("narrows each section to what fits, in its own order", () => {
		const candidates = {
			reading: [doc("r20", 20), doc("r4", 4)],
			recent: [doc("n30", 30), doc("n5", 5), doc("post", null), doc("n2", 2)],
			rediscover: [doc("o10", 10), doc("o3", 3)],
		}
		expect(homeShelves(candidates, null)).toEqual({
			reading: [candidates.reading[0], candidates.reading[1]],
			recent: candidates.recent.slice(0, 3),
			rediscover: candidates.rediscover,
		})
		const five = homeShelves(candidates, 5)
		expect(ids(five.reading)).toEqual(["r4"])
		expect(ids(five.recent)).toEqual(["n5", "n2"])
		expect(ids(five.rediscover)).toEqual(["o3"])
	})

	it("shows each article once, the first section that has it keeping it", () => {
		const shelves = homeShelves(
			{ reading: [], recent: [doc("a", 5), doc("b", 5)], rediscover: [doc("b", 5), doc("c", 5)] },
			null,
		)
		expect(ids(shelves.recent)).toEqual(["a", "b"])
		expect(ids(shelves.rediscover)).toEqual(["c"])
	})
})

describe("fitsIn", () => {
	it("counts what has no time only when any length goes", () => {
		expect(fitsIn(doc("post", null), null)).toBe(true)
		expect(fitsIn(doc("post", null), 60)).toBe(false)
		expect(fitsIn(doc("a", 15), 15)).toBe(true)
		expect(fitsIn(doc("a", 16), 15)).toBe(false)
	})
})
