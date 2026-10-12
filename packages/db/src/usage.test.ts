import { describe, expect, it } from "vitest"
import { topicLimits } from "./usage"

describe("topicLimits", () => {
	it("reads both caps, 0 included, and falls back to the defaults for anything else", () => {
		expect(topicLimits({})).toEqual({ topics: 100, sorts: 1000 })
		expect(
			topicLimits({ LIMIT_TOPICS_PER_MONTH: "5", LIMIT_TOPIC_SORTS_PER_MONTH: "2500" }),
		).toEqual({ topics: 5, sorts: 2500 })
		// 0 stops the work; it is not unset.
		expect(topicLimits({ LIMIT_TOPICS_PER_MONTH: "0", LIMIT_TOPIC_SORTS_PER_MONTH: "0" })).toEqual({
			topics: 0,
			sorts: 0,
		})
		for (const bad of ["", " ", "-1", "1.5", "lots"])
			expect(
				topicLimits({ LIMIT_TOPICS_PER_MONTH: bad, LIMIT_TOPIC_SORTS_PER_MONTH: bad }),
				JSON.stringify(bad),
			).toEqual({ topics: 100, sorts: 1000 })
	})
})
