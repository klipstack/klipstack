import { describe, expect, it } from "vitest"
import {
	chosenTopic,
	keptOffline,
	topicToAsk,
	searchHint,
	topicMenu,
	topicQuery,
	type TopicsInList,
	topicEnded,
	topicStillThere,
} from "./library-topics"

const topics: TopicsInList = {
	items: [
		{ id: "w", name: "Writing", description: "On writing.", articles: 9, inView: 3 },
		{ id: "s", name: "Science", description: "On science.", articles: 4, inView: 1 },
		{ id: "h", name: "History", description: "On history.", articles: 2, inView: 0 },
	],
	none: 2,
	sorting: 0,
}

describe("the topic menu", () => {
	it("offers every topic, each topic with its count in the list, then No topic", () => {
		expect(topicMenu(topics, null)).toEqual([
			{ value: null, label: "Every topic", count: null, on: true },
			{ value: "w", label: "Writing", count: "3 articles", on: false },
			{ value: "s", label: "Science", count: "1 article", on: false },
			{ value: "h", label: "History", count: "None here", on: false },
			{ value: "none", label: "No topic", count: "2 articles", on: false },
		])
	})

	it("ticks the chosen topic, or No topic", () => {
		expect(
			topicMenu(topics, "s")
				.filter((i) => i.on)
				.map((i) => i.label),
		).toEqual(["Science"])
		expect(
			topicMenu(topics, "none")
				.filter((i) => i.on)
				.map((i) => i.label),
		).toEqual(["No topic"])
	})
})

describe("the chosen topic's line", () => {
	it("names the topic and what it holds", () => {
		expect(chosenTopic(topics, "w")).toEqual({ name: "Writing", description: "On writing." })
		expect(chosenTopic(topics, null)).toBeNull()
	})

	it("says what No topic holds, and how many are still being sorted", () => {
		expect(chosenTopic(topics, "none")).toEqual({
			name: "No topic",
			description: "Articles sorted into none of your topics. New topics grow from these.",
		})
		expect(chosenTopic({ ...topics, sorting: 1 }, "none")?.description).toBe(
			"Articles sorted into none of your topics. New topics grow from these. 1 more is still being sorted.",
		)
		expect(chosenTopic({ ...topics, sorting: 4 }, "none")?.description).toMatch(
			/ 4 more are still being sorted\.$/,
		)
	})

	it("is gone when the topic ended, or topics are off", () => {
		expect(topicStillThere(topics, "w")).toBe(true)
		expect(topicStillThere(topics, "none")).toBe(true)
		expect(topicStillThere(topics, "ended")).toBe(false)
		expect(topicStillThere({ items: [], none: 0, sorting: 0 }, "none")).toBe(false)
	})
})

describe("topics in the search", () => {
	it("searches a topic by its whole name, quoted when it has a space", () => {
		expect(topicQuery("Writing")).toBe("topic:Writing")
		expect(topicQuery("Personal Growth")).toBe('topic:"Personal Growth"')
	})

	it("mentions topic: and has:topic only to a reader with topics", () => {
		expect(searchHint(false)).toBe(
			"Search titles, text and notes. Try is:starred or site:example.com.",
		)
		expect(searchHint(true)).toBe(
			"Search titles, text and notes. Try is:starred, site:example.com or has:topic, or a topic below.",
		)
	})
})

describe("a list narrowed to a topic", () => {
	it("is not the copy of Inbox or Starred kept for offline reading", () => {
		expect(keptOffline("inbox", null)).toBe(true)
		expect(keptOffline("starred", null)).toBe(true)
		expect(keptOffline("inbox", "t1")).toBe(false)
		expect(keptOffline("starred", "none")).toBe(false)
		expect(keptOffline("archive", null)).toBe(false)
	})

	it("learns that its topic ended from a not_found, and only with a topic", () => {
		const notFound = Object.assign(new Error("No topic"), { code: "not_found" })
		expect(topicEnded("t1", notFound)).toBe(true)
		expect(topicEnded(null, notFound)).toBe(false)
		expect(topicEnded("t1", Object.assign(new Error("Slow"), { code: "rate_limited" }))).toBe(false)
		expect(topicEnded("t1", new TypeError("Network request failed"))).toBe(false)
	})
})

describe("the topic a list asks for", () => {
	it("is the chosen one once the reader's topics confirm it, and waits for them", () => {
		expect(topicToAsk(null, "loading")).toBeNull()
		expect(topicToAsk("w", "loading")).toBeUndefined()
		expect(topicToAsk("w", topics)).toBe("w")
		expect(topicToAsk("none", topics)).toBe("none")
	})

	it("is every topic when the topics can't load, or the chosen one ended", () => {
		expect(topicToAsk("w", "failed")).toBeNull()
		expect(topicToAsk("ended", topics)).toBeNull()
	})
})
