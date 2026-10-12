import { afterEach, describe, expect, it, vi } from "vitest"
import { chooseTopic, forgetTopics, onTopicChange, topicOf } from "./topic-choices"

afterEach(forgetTopics)

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

	it("goes with the session: the next reader starts with every topic", () => {
		chooseTopic("inbox", "t1")
		chooseTopic("starred", "none")
		const listener = vi.fn()
		onTopicChange(listener)
		forgetTopics()
		expect(topicOf("inbox")).toBeNull()
		expect(topicOf("starred")).toBeNull()
		expect(listener).toHaveBeenCalled()
	})
})
