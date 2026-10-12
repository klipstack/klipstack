import { describe, expect, it } from "vitest"
import {
	chosenTopic,
	searchHint,
	topicMenu,
	topicQuery,
	type TopicsInList,
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
