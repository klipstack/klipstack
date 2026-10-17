import type { ArticleSummary, Topic } from "@klipstack/sdk"
import { KlipstackApiError } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	confirmation,
	oklchHex,
	PHONE_SHELF,
	phoneShelf,
	spine,
	topicsBusy,
	topicRefusal,
	topicsNotice,
	type TopicsAnswer,
	turnOffQuestion,
} from "./topic-shelves"

const NOW = new Date("2026-10-12T12:00:00Z")

function article(id: string, extra: Partial<ArticleSummary> = {}): ArticleSummary {
	return {
		id,
		title: `Title ${id}`,
		site: "example.com",
		readingMinutes: 5,
		savedAt: "2026-09-01T00:00:00Z",
		...extra,
	} as ArticleSummary
}

function topic(articles: number, latest: number): Topic {
	return {
		id: "t",
		name: "Writing",
		description: "On writing.",
		articles,
		savedThisWeek: 0,
		toRead: 0,
		lastReadAt: null,
		latest: Array.from({ length: latest }, (_, i) => article(String(i))),
	}
}

describe("oklchHex", () => {
	it("converts the web's oklch colors to sRGB hex", () => {
		expect(oklchHex(0, 0, 0)).toBe("#000000")
		expect(oklchHex(1, 0, 0)).toBe("#ffffff")
		// sRGB red, as CSS Color 4 writes it in oklch.
		expect(oklchHex(0.628, 0.2577, 29.23)).toBe("#ff0000")
	})
})

describe("phoneShelf", () => {
	it("shows every article of a topic that fits", () => {
		expect(phoneShelf(topic(3, 3))).toMatchObject({ more: 0 })
		expect(phoneShelf(topic(3, 3)).books.map((b) => b.id)).toEqual(["0", "1", "2"])
	})

	it("ends a full shelf in how many more there are", () => {
		const shelf = phoneShelf(topic(40, PHONE_SHELF))
		expect(shelf.books).toHaveLength(PHONE_SHELF - 1)
		expect(shelf.more).toBe(40 - (PHONE_SHELF - 1))
	})

	it("is empty for a topic without its latest articles", () => {
		expect(phoneShelf({ ...topic(2, 0), latest: undefined })).toEqual({ books: [], more: 2 })
	})
})

describe("spine", () => {
	it("is thicker for a longer read, its height and color stable for the article and its site", () => {
		const short = spine(article("a", { readingMinutes: 1 }), "light", NOW)
		const long = spine(article("a", { readingMinutes: 60 }), "light", NOW)
		expect(long.width).toBeGreaterThan(short.width)
		expect(short.height).toBe(long.height)
		expect(spine(article("b"), "light", NOW).color).toBe(spine(article("c"), "light", NOW).color)
		expect(spine(article("a"), "dark", NOW).color).not.toBe(spine(article("a"), "light", NOW).color)
	})

	it("says the article was saved this week", () => {
		expect(spine(article("a", { savedAt: "2026-10-10T00:00:00Z" }), "light", NOW).recent).toBe(true)
		expect(spine(article("a"), "light", NOW).recent).toBe(false)
	})

	it("names the article by its title, else its site", () => {
		expect(spine(article("a"), "light", NOW).label).toBe("Title a")
		expect(spine(article("a", { title: null }), "light", NOW).label).toBe("example.com")
		expect(spine(article("a", { title: null, site: null }), "light", NOW).label).toBe("Untitled")
	})
})

describe("topicsNotice", () => {
	const answer = (extra: Partial<TopicsAnswer>): TopicsAnswer => ({
		stage: "active",
		items: [],
		...extra,
	})

	it("leaves the stages the screen shows in full to it: off and the proposal", () => {
		expect(topicsNotice(answer({ stage: "off" }))).toBeNull()
		expect(
			topicsNotice(
				answer({ stage: "proposed", proposed: [{ id: "1", name: "Cooking", description: "" }] }),
			),
		).toBeNull()
	})

	it("says how far the first topics are", () => {
		expect(
			topicsNotice(answer({ stage: "waiting", progress: { count: 7, needed: 25 } })),
		).toMatchObject({
			body: "Your first topics come when you have saved 25 articles: 7 of 25 so far.",
		})
		expect(topicsNotice(answer({ stage: "proposing" }))?.title).toBe("Proposing your first topics…")
	})

	it("says the library is being sorted, or waits for next month", () => {
		expect(topicsNotice(answer({ sorting: 1, sortingPaused: null }))?.body).toBe(
			"Sorting your library into its topics: 1 article to go.",
		)
		expect(
			topicsNotice(
				answer({ sorting: 3, sortingPaused: { resumesAt: "2026-11-01T00:00:00Z" } }),
				"en-US",
			)?.body,
		).toBe(
			"Sorting stopped for this month: 3 articles are waiting, and sorting starts again on November 1. Nothing is lost.",
		)
		// With the month's cap, as servers since 2026-10-17 send it.
		expect(
			topicsNotice(
				answer({
					sorting: 1,
					sortingPaused: { resumesAt: "2026-11-01T00:00:00Z", max: 2000 },
				}),
				"en-US",
			)?.body,
		).toBe(
			"Sorting stopped for this month: 2,000 articles were sorted, the most an account can. 1 article is waiting, and sorting starts again on November 1. Nothing is lost.",
		)
		expect(topicsNotice(answer({ sorting: 3, sortingPaused: { resumesAt: null } }))?.body).toBe(
			"This server sorts no articles into topics: 3 articles are waiting.",
		)
	})

	it("says nothing while every article is sorted, and nothing for an account without topics", () => {
		expect(
			topicsNotice(answer({ items: [topic(1, 1)], sorting: 0, sortingPaused: null })),
		).toBeNull()
		expect(topicsNotice(answer({ stage: "unavailable" }))).toBeNull()
	})

	it("says when there are no topics right now", () => {
		expect(topicsNotice(answer({ sorting: 0 }))?.body).toBe(
			"No topics right now. New ones appear as you save more articles.",
		)
	})
})

describe("topicsBusy", () => {
	const answer = (extra: Partial<TopicsAnswer>): TopicsAnswer => ({
		stage: "active",
		items: [],
		...extra,
	})

	it("asks again while the server is on it: proposing, or sorting and not paused", () => {
		expect(topicsBusy(answer({ stage: "proposing" }))).toBe(true)
		expect(topicsBusy(answer({ sorting: 3, sortingPaused: null }))).toBe(true)
	})

	it("waits for the reader otherwise", () => {
		expect(topicsBusy(answer({ sorting: 3, sortingPaused: { resumesAt: null } }))).toBe(false)
		expect(topicsBusy(answer({ sorting: 0, sortingPaused: null }))).toBe(false)
		for (const stage of ["unavailable", "off", "waiting", "proposed"] as const)
			expect(topicsBusy(answer({ stage }))).toBe(false)
	})
})

describe("confirmation", () => {
	const proposed = [{ id: "a" }, { id: "b" }, { id: "c" }]

	it("sends every proposed topic, under its own name, when the reader changes nothing", () => {
		expect(confirmation(proposed, {})).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }])
	})

	it("leaves out the unchecked ones, and sends the names typed, an empty one as none", () => {
		expect(
			confirmation(proposed, {
				a: { kept: false, name: "Kept?" },
				b: { kept: true, name: "  Trips " },
				c: { kept: true, name: "   " },
			}),
		).toEqual([{ id: "b", name: "Trips" }, { id: "c" }])
	})
})

describe("turnOffQuestion", () => {
	it("says the topics go, and names the saved searches that would find nothing", () => {
		const base = "This deletes your topics and where each article was. It can't be undone."
		expect(turnOffQuestion([{ name: "Tagged", query: "tag:x" }])).toBe(base)
		expect(
			turnOffQuestion([
				{ name: "Tagged", query: "tag:x" },
				{ name: "Science", query: 'topic:"Physics" unread' },
			]),
		).toBe(`${base} 1 saved search names topics and will find nothing in them: “Science”.`)
		expect(
			turnOffQuestion([
				{ name: "A", query: "topic:a" },
				{ name: "B", query: "topic:b unread" },
				{ name: "Any topic", query: "has:topic" },
				{ name: "C", query: "-topic:c" },
			]),
		).toMatch(/3 saved searches name topics and will find nothing in them: “A”, “B”, “C”\.$/)
	})
})

describe("topicRefusal", () => {
	it("says the server's refusals in the reader's words, and anything else as it is", () => {
		const refused = (code: string) => new KlipstackApiError(409, code as never, "server words")
		expect(topicRefusal(refused("name_taken"))).toBe("Another topic has that name.")
		expect(topicRefusal(refused("not_found"))).toBe("That topic is gone.")
		expect(topicRefusal(refused("forbidden"))).toBe("Topics are not turned on for your account.")
		expect(topicRefusal(refused("invalid_request"))).toBe("A topic name has 1 to 60 characters.")
		expect(topicRefusal(refused("already_done"))).toBe("Your topics are confirmed already.")
		expect(topicRefusal(refused("unavailable"))).toBe("Topics are not set up on this server.")
		expect(topicRefusal(new Error("Network request failed"))).toBe("Network request failed")
	})
})
