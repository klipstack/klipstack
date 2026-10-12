import { describe, expect, it } from "vitest"
import { suggest, valueItems } from "./search-suggest"

const TODAY = "2026-09-20"
/** Suggestions with the caret at the end of the query. */
const at = (q: string) => suggest(q, q.length, TODAY)
const inserts = (q: string) => at(q)?.items.map((i) => i.insert) ?? null

describe("suggest", () => {
	it("offers the keys that two or more letters start", () => {
		expect(inserts("si")).toEqual(["site:"])
		expect(inserts("IS")).toEqual(["is:"])
		expect(inserts("a")).toBeNull()
		expect(inserts("sitting")).toBeNull()
	})

	it("keeps the dash, and leaves out what cannot be negated", () => {
		expect(inserts("-is")).toEqual(["-is:"])
		expect(inserts("-sa")).toBeNull()
		expect(inserts("-sort:")).toBeNull()
		expect(inserts("-saved:")).toBeNull()
	})

	it("offers a key's values, all of them or those that start as typed", () => {
		expect(inserts("in:")).toEqual(["in:library ", "in:archive ", "in:trash ", "in:anywhere "])
		expect(inserts("in:a")).toEqual(["in:archive ", "in:anywhere "])
		expect(inserts("is:UN")).toEqual(["is:unread "])
		expect(inserts("-has:")).toEqual(["-has:highlights ", "-has:note ", "-has:tags "])
	})

	it("offers nothing for a finished or an impossible value, an unknown key, or a title", () => {
		expect(inserts("is:unread")).toBeNull()
		expect(inserts("is:zz")).toBeNull()
		expect(inserts("label:w")).toBeNull()
		expect(inserts("title:sch")).toBeNull()
		expect(inserts('is:"un')).toBeNull()
	})

	it("offers dates that fit the key, with what they mean", () => {
		expect(at("saved:")?.items).toEqual([
			{ insert: "saved:7d ", hint: "search.suggest.last7d" },
			{ insert: "saved:1m ", hint: "search.suggest.lastMonth" },
			{ insert: "saved:1y ", hint: "search.suggest.lastYear" },
			{ insert: "saved:2026-09 ", hint: "search.suggest.thisMonth" },
			{ insert: "saved:2026 ", hint: "search.suggest.thisYear" },
		])
		expect(inserts("published:20")).toEqual(["published:2026-09 ", "published:2026 "])
		expect(inserts("before:")).toEqual(["before:2026-09-20 ", "before:2026-09 ", "before:2026 "])
		expect(inserts("after:2026")).toEqual(["after:2026-09-20 ", "after:2026-09 "])
		expect(inserts("saved:1999")).toBeNull()
	})

	it("asks the library for sites and authors, from the first character or before", () => {
		expect(at("site:")).toEqual({
			start: 0,
			end: 5,
			items: [],
			remote: { key: "site", prefix: "", negated: false },
		})
		expect(at("-author:gra")?.remote).toEqual({ key: "author", prefix: "gra", negated: true })
		expect(at('author:"paul gr')?.remote).toEqual({
			key: "author",
			prefix: "paul gr",
			negated: false,
		})
		expect(at('author:"Paul Graham"')).toBeNull()
	})

	it("asks the library for tags too", () => {
		expect(at("-tag:ru")?.remote).toEqual({ key: "tag", prefix: "ru", negated: true })
	})

	it("offers topics only to a reader who has them, and asks the library for their names", () => {
		const withTopics = (q: string) => suggest(q, q.length, TODAY, { topics: true })
		expect(inserts("to")).toBeNull()
		expect(at("topic:wr")).toBeNull()
		expect(withTopics("to")?.items.map((i) => i.insert)).toEqual(["topic:"])
		expect(withTopics('-topic:"personal g')?.remote).toEqual({
			key: "topic",
			prefix: "personal g",
			negated: true,
		})
		expect(withTopics("has:")?.items.map((i) => i.insert)).toEqual([
			"has:highlights ",
			"has:note ",
			"has:tags ",
			"has:topic ",
		])
		expect(
			valueItems({ key: "topic", prefix: "", negated: false }, ['Say "No"', "Writing"]),
		).toEqual([{ insert: 'topic:"Say No" ' }, { insert: "topic:Writing " }])
	})

	it("completes only the token that ends at the caret, and says where it is", () => {
		const q = "wombat is:un in:archive"
		expect(suggest(q, 12, TODAY)).toMatchObject({ start: 7, end: 12 })
		expect(suggest(q, 10, TODAY)).toBeNull()
		expect(suggest(q, 6, TODAY)).toBeNull()
		expect(suggest("wombat ", 7, TODAY)).toBeNull()
		expect(suggest('"in:', 4, TODAY)).toBeNull()
	})
})

describe("valueItems", () => {
	it("writes the values as operators, quoting the ones with spaces", () => {
		const remote = { key: "author" as const, prefix: "gra", negated: false }
		expect(valueItems(remote, ["Paul Graham", 'Tim "T" Urban', "Lois"])).toEqual([
			{ insert: 'author:"Paul Graham" ' },
			{ insert: 'author:"Tim T Urban" ' },
			{ insert: "author:Lois " },
		])
		expect(valueItems({ key: "site", prefix: "", negated: true }, ["example.com"])).toEqual([
			{ insert: "-site:example.com " },
		])
	})
})
