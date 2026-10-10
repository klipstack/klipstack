import { describe, expect, it } from "vitest"
import type { FeedListItem, FeedSection } from "~/services/feeds.server"
import { latestFeedItems } from "./feed-layout"

function item(id: string, age: number, saved = false): FeedListItem {
	return {
		id,
		url: `https://example.com/${id}`,
		title: id,
		author: null,
		excerpt: null,
		sortAt: new Date(2026, 8, 22 - age),
		publishedAt: null,
		isNew: false,
		documentId: saved ? `doc-${id}` : null,
		sortKey: id,
	}
}
function source(id: string, items: FeedListItem[]): FeedSection {
	return {
		id,
		title: id,
		siteUrl: "https://example.com",
		trouble: false,
		lastError: null,
		lastSuccessAt: null,
		lastPostAt: null,
		hasItems: !!items.length,
		items,
		newCount: 0,
		moreItems: 0,
	}
}
describe("latest feed selection", () => {
	it("mixes sources by the newest eligible post, skips saved posts, and caps the overview", () => {
		const sections = [
			source("busy", [item("saved", 0, true), item("busy", 5), item("older", 6)]),
			source("quiet", [item("quiet", 1)]),
			source("other", [item("other", 2)]),
			source("fourth", [item("fourth", 3)]),
		]
		expect(latestFeedItems(sections).map(({ item }) => item.id)).toEqual([
			"quiet",
			"other",
			"fourth",
		])
	})
	it("never repeats syndicated URLs in the overview", () => {
		const same = item("shared", 0)
		expect(
			latestFeedItems([
				source("one", [same]),
				source("two", [{ ...same, id: "copy" }]),
				source("three", [item("different", 1)]),
			]),
		).toHaveLength(2)
	})
	it("handles empty and fully saved subscriptions", () => {
		expect(latestFeedItems([])).toEqual([])
		expect(
			latestFeedItems([source("empty", []), source("saved", [item("saved", 0, true)])]),
		).toEqual([])
	})
})
