import { afterEach, describe, expect, it, vi } from "vitest"
import { countTopicSearch } from "./topic-use"

// The browser's beacon is the boundary: what it would send is recorded instead.
const sent: string[] = []
vi.stubGlobal("navigator", {
	sendBeacon: (url: string, body: FormData) => sent.push(`${url} ${String(body.get("use"))}`),
})
afterEach(() => {
	sent.length = 0
})

describe("countTopicSearch", () => {
	it("counts a search that brings in a topic, or no topic, and nothing else", () => {
		countTopicSearch('topic:"Psyche" minds', "minds")
		countTopicSearch("-has:topic", 'topic:"Psyche"')
		expect(sent).toEqual(["/topics/use topic_filter_search", "/topics/use topic_filter_search"])
	})

	it("does not count the same topic sent again, other words, or a search without a topic", () => {
		countTopicSearch('topic:"Psyche"', 'topic:"Psyche"')
		countTopicSearch('topic:"Psyche" sleep', 'topic:"Psyche" dreams')
		countTopicSearch("sleep", 'topic:"Psyche"')
		expect(sent).toEqual([])
	})
})
