import { describe, expect, it } from "vitest"
import { groupRiver, riverPosts } from "./feed-river"

const now = new Date("2026-10-17T15:00:00Z")
const at = (iso: string) => new Date(iso)

function item(id: string, sortAt: string, extra: { url?: string; isNew?: boolean } = {}) {
	return {
		id,
		url: extra.url ?? `https://example.com/${id}`,
		sortAt: at(sortAt),
		isNew: extra.isNew ?? false,
		documentId: null,
	}
}

const section = (id: string, items: ReturnType<typeof item>[]) => ({
	id,
	title: `Blog ${id}`,
	siteUrl: `https://${id}.example.com/`,
	items,
})

describe("riverPosts", () => {
	it("puts every site's posts in one list, newest first, each with its source and day", () => {
		const posts = riverPosts(
			[
				section("a", [item("a2", "2026-10-17T09:00:00Z"), item("a1", "2026-10-12T09:00:00Z")]),
				section("b", [item("b1", "2026-10-16T22:00:00Z")]),
			],
			now,
			"UTC",
		)
		expect(posts.map((p) => [p.item.id, p.source.id, p.group])).toEqual([
			["a2", "a", "today"],
			["b1", "b", "yesterday"],
			["a1", "a", "week"],
		])
		expect(posts[1]?.source).toEqual({
			id: "b",
			title: "Blog b",
			siteUrl: "https://b.example.com/",
		})
	})

	it("keeps one copy of a post two feeds carry: the first in the list", () => {
		const shared = "https://example.com/shared"
		const posts = riverPosts(
			[
				section("a", [item("a1", "2026-10-17T09:00:00Z", { url: shared })]),
				section("b", [item("b1", "2026-10-17T10:00:00Z", { url: shared })]),
			],
			now,
			"UTC",
		)
		expect(posts.map((p) => p.item.id)).toEqual(["b1"])
	})

	it("dates the day in the reader's time zone", () => {
		// 01:00 UTC on the 17th is still the 16th in Buenos Aires (UTC-3).
		const posts = riverPosts(
			[section("a", [item("a1", "2026-10-17T01:00:00Z")])],
			now,
			"America/Argentina/Buenos_Aires",
		)
		expect(posts[0]?.group).toBe("yesterday")
	})
})

describe("groupRiver", () => {
	it("splits the chosen posts into runs of the same day, in order", () => {
		const posts = riverPosts(
			[
				section("a", [
					item("a3", "2026-10-17T12:00:00Z"),
					item("a2", "2026-10-17T09:00:00Z"),
					item("a1", "2026-10-01T09:00:00Z"),
				]),
				section("b", [item("b1", "2026-10-13T09:00:00Z")]),
			],
			now,
			"UTC",
		)
		const groups = groupRiver(posts, (p) => p.item.id !== "a2")
		expect(groups.map((g) => [g.group, g.posts.map((p) => p.item.id)])).toEqual([
			["today", ["a3"]],
			["week", ["b1"]],
			["month", ["a1"]],
		])
	})
})
