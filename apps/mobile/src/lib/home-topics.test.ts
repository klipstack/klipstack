import type { Topic } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { HOME_CHIPS, homeTopicChoice, topicHeading, homeTopicsCard } from "./home-topics"

function topic(id: string, toRead: number, lastReadAt: string | null = null): Topic {
	return {
		id,
		name: id,
		description: "",
		articles: toRead + 1,
		savedThisWeek: 0,
		toRead,
		lastReadAt,
	}
}

const WEEK_AGO = "2026-10-05T00:00:00Z"
const LAST_MONTH = "2026-09-01T00:00:00Z"

describe("homeTopicChoice", () => {
	const topics = [
		topic("Writing", 9, WEEK_AGO),
		topic("Science", 4, WEEK_AGO),
		topic("Startups", 7, WEEK_AGO),
		topic("History", 2, LAST_MONTH),
		topic("Cooking", 3, WEEK_AGO),
		topic("Done", 0, null),
	]

	it("offers the topics with something to read, most first: the biggest as chips, the rest under More", () => {
		const choice = homeTopicChoice(topics, null)!
		expect(choice.chips.map((t) => t.id)).toEqual(["Writing", "Startups", "Science", "Cooking"])
		expect(choice.chips).toHaveLength(HOME_CHIPS)
		expect(choice.more.map((t) => t.id)).toEqual(["History"])
		expect(choice.chosen).toBeNull()
	})

	it("offers as something different the topic read from least lately", () => {
		expect(homeTopicChoice(topics, null)!.different).toBe("History")
	})

	it("adds a topic chosen from More to the chips", () => {
		const choice = homeTopicChoice(topics, { id: "History", different: false })!
		expect(choice.chips.map((t) => t.id)).toEqual([
			"Writing",
			"Startups",
			"Science",
			"Cooking",
			"History",
		])
		expect(choice.more).toEqual([])
		expect(choice.chosen).toMatchObject({ topic: { id: "History" }, different: false })
	})

	it("keeps something different the same topic once the reader reads from it", () => {
		// Read from just now: another topic is least lately read, but the choice stands.
		const read = topics.map((t) =>
			t.id === "History" ? { ...t, lastReadAt: "2026-10-12T00:00:00Z" } : t,
		)
		const choice = homeTopicChoice(read, { id: "History", different: true })!
		expect(choice.different).toBe("History")
		expect(choice.chosen).toMatchObject({ topic: { id: "History" }, different: true })
		// Under More still: chosen as something different, it is no chip of its own.
		expect(choice.chips.map((t) => t.id)).toEqual(["Writing", "Startups", "Science", "Cooking"])
		expect(choice.more.map((t) => t.id)).toEqual(["History"])
		expect(choice.pick).toEqual({ id: "History", different: true })
	})

	it("drops a choice that is no topic now, or has nothing to read: Home shows everything", () => {
		for (const pick of [
			{ id: "Gone", different: false },
			{ id: "Done", different: false },
			{ id: "Done", different: true },
		]) {
			const choice = homeTopicChoice(topics, pick)!
			expect(choice.chosen).toBeNull()
			// Anything is the one filled, and something different is another topic to choose.
			expect(choice.pick).toBeNull()
			expect(choice.different).toBe("History")
		}
	})

	it("is nothing without a topic to read from", () => {
		expect(homeTopicChoice([topic("Done", 0)], null)).toBeNull()
		expect(homeTopicChoice([], null)).toBeNull()
	})
})

describe("topicHeading", () => {
	it("says how much is left to read, or why the topic is offered", () => {
		expect(topicHeading({ topic: topic("Writing", 9), different: false })).toEqual({
			title: "Writing",
			line: "9 to read",
			all: "Everything in Writing",
		})
		expect(topicHeading({ topic: topic("History", 1, LAST_MONTH), different: true }).line).toBe(
			"Something different: the topic you haven't read from in the longest time.",
		)
		expect(topicHeading({ topic: topic("History", 1), different: true }).line).toBe(
			"Something different: a topic you haven't read from yet.",
		)
	})
})

describe("homeTopicsCard", () => {
	it("invites a reader with topics off and the invitation open, saying how many articles", () => {
		expect(homeTopicsCard({ stage: "off", invitation: true, progress: { count: 40 } })).toEqual({
			kind: "invitation",
			count: 40,
		})
		expect(homeTopicsCard({ stage: "off", invitation: false, progress: { count: 40 } })).toBeNull()
	})

	it("says the first topics are ready until opened or put off", () => {
		expect(homeTopicsCard({ stage: "proposed", card: true })).toMatchObject({ kind: "ready" })
		expect(homeTopicsCard({ stage: "proposed", card: false })).toBeNull()
	})

	it("says nothing in the other stages, nor from a server that doesn't say", () => {
		expect(homeTopicsCard({ stage: "active", card: true, invitation: true })).toBeNull()
		expect(homeTopicsCard({ stage: "unavailable" })).toBeNull()
		expect(homeTopicsCard({ stage: "off" })).toBeNull()
	})
})
