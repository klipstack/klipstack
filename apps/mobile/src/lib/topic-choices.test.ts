import { afterEach, describe, expect, it, vi } from "vitest"
import {
	chooseFilter,
	chooseTopic,
	filterOf,
	forgetListChoices,
	onTopicChange,
	sortOf,
	topicOf,
} from "./topic-choices"

afterEach(forgetListChoices)

describe("each list's topic", () => {
	it("is every topic until one is chosen, and each list keeps its own", () => {
		expect(topicOf("inbox")).toBeNull()
		chooseTopic("inbox", "t1")
		expect(topicOf("inbox")).toBe("t1")
		expect(topicOf("archive")).toBeNull()
	})

	it("tells listeners about a change, not about the same choice again", () => {
		const listener = vi.fn()
		const off = onTopicChange(listener)
		chooseTopic("inbox", "none")
		chooseTopic("inbox", "none")
		expect(listener).toHaveBeenCalledTimes(1)
		off()
		chooseTopic("inbox", null)
		expect(listener).toHaveBeenCalledTimes(1)
	})

	it("keeps each list's filter and order beside its topic", () => {
		chooseTopic("inbox", "t1")
		chooseFilter("inbox", "read", "oldest")
		expect([filterOf("inbox"), sortOf("inbox"), topicOf("inbox")]).toEqual(["read", "oldest", "t1"])
		expect([filterOf("starred"), sortOf("starred")]).toEqual([null, null])
		// Back to the filter's own order.
		chooseFilter("inbox", "unread", null)
		expect([filterOf("inbox"), sortOf("inbox")]).toEqual(["unread", null])
	})

	it("goes with the session: the next reader starts with every topic, all of each list", () => {
		chooseFilter("archive", "finished", null)
		chooseTopic("inbox", "t1")
		chooseTopic("starred", "none")
		const listener = vi.fn()
		onTopicChange(listener)
		forgetListChoices()
		expect(topicOf("inbox")).toBeNull()
		expect(topicOf("starred")).toBeNull()
		expect(filterOf("archive")).toBeNull()
		expect(listener).toHaveBeenCalled()
	})
})
