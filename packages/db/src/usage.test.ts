import { describe, expect, it } from "vitest"
import type { PlanState } from "./plan"
import { topicLimits, translationCap } from "./usage"

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

describe("translationCap", () => {
	it("follows the plan, gives admins their own, and reads each variable", () => {
		expect(
			[
				["user", "unbilled"],
				["user", "trial"],
				["user", "free"],
				["user", "lapsed"],
				["admin", "trial"],
			].map(([role, state]) => translationCap(role as "user" | "admin", state as PlanState, {})),
		).toEqual([30, 30, 100, 30, 300])
		const env = {
			LIMIT_TRANSLATIONS_PER_MONTH: "5",
			LIMIT_TRIAL_TRANSLATIONS_PER_MONTH: "6",
			LIMIT_PAID_TRANSLATIONS_PER_MONTH: "7",
			LIMIT_TRANSLATIONS_PER_MONTH_ADMIN: "8",
		}
		expect(translationCap("user", "unbilled", env)).toBe(5)
		expect(translationCap("user", "trial", env)).toBe(6)
		expect(translationCap("user", "free", env)).toBe(7)
		expect(translationCap("admin", "free", env)).toBe(8)
		expect(translationCap("user", "unbilled", { LIMIT_TRANSLATIONS_PER_MONTH: "lots" })).toBe(30)
	})
})
