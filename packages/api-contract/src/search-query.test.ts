import { describe, expect, it } from "vitest"
import {
	addOperator,
	canSaveSearch,
	defaultSavedSearchName,
	OPERATORS_MAX,
	parseSearchQuery,
	QUERY_MAX,
	removeOperator,
	renameTagOperator,
	renameTopicOperator,
	textOnly,
	topicsNamedIn,
} from "./search-query"

const filters = (q: string) => parseSearchQuery(q).filters
const saved = (value: string) => filters(`saved:${value}`)[0]?.value

describe("parseSearchQuery", () => {
	it("splits words from operators", () => {
		const query = parseSearchQuery("makers in:archive schedule is:starred")
		expect(query.text).toBe("makers schedule")
		expect(query.filters).toEqual([
			{ key: "in", value: "archive", negated: false },
			{ key: "is", value: "starred", negated: false },
		])
		expect(query.ignored).toEqual([])
	})

	it("reads every operator", () => {
		expect(
			filters("in:trash is:quick has:note site:nytimes.com author:graham title:schedule via:feed"),
		).toEqual([
			{ key: "in", value: "trash", negated: false },
			{ key: "is", value: "quick", negated: false },
			{ key: "has", value: "note", negated: false },
			{ key: "site", value: "nytimes.com", negated: false },
			{ key: "author", value: "graham", negated: false },
			{ key: "title", value: "schedule", negated: false },
			{ key: "via", value: "feed", negated: false },
		])
	})

	it("ignores the case of keys and fixed values, and keeps the case of text values", () => {
		expect(filters("IN:Archive Author:Graham")).toEqual([
			{ key: "in", value: "archive", negated: false },
			{ key: "author", value: "Graham", negated: false },
		])
	})

	it("negates with a dash, and leaves -word to the full-text search", () => {
		const query = parseSearchQuery("-is:finished -in:archive -boring")
		expect(query.filters).toEqual([
			{ key: "is", value: "finished", negated: true },
			{ key: "in", value: "archive", negated: true },
		])
		expect(query.text).toBe("-boring")
	})

	it("reads tags as whole names, cleaned the way names are", () => {
		expect(filters('tag:rust -tag:"Machine  Learning" TAG:Later has:tags')).toEqual([
			{ key: "tag", value: "rust", negated: false },
			{ key: "tag", value: "Machine Learning", negated: true },
			{ key: "tag", value: "Later", negated: false },
			{ key: "has", value: "tags", negated: false },
		])
		// No tag can have that name: reported, not searched as text.
		const bad = parseSearchQuery(`tag:a,b tag:${"x".repeat(51)} rust`)
		expect(bad.filters).toEqual([])
		expect(bad.ignored).toEqual(["tag:a,b", `tag:${"x".repeat(51)}`])
		expect(bad.text).toBe("rust")
		expect(addOperator("is:unread", "tag", "machine learning")).toBe(
			'is:unread tag:"machine learning"',
		)
		expect(removeOperator('rust tag:"machine learning" tag:web', "tag", "Machine Learning")).toBe(
			"rust tag:web",
		)
	})

	it("reads topics as whole names, cleaned the way names are", () => {
		expect(
			filters('topic:Writing -topic:"Personal  Growth" TOPIC:ai has:topic -has:topic'),
		).toEqual([
			{ key: "topic", value: "Writing", negated: false },
			{ key: "topic", value: "Personal Growth", negated: true },
			{ key: "topic", value: "ai", negated: false },
			{ key: "has", value: "topic", negated: false },
			{ key: "has", value: "topic", negated: true },
		])
		// No topic can have that name: reported, not searched as text.
		const bad = parseSearchQuery(`topic:${"x".repeat(61)} rust`)
		expect(bad.filters).toEqual([])
		expect(bad.ignored).toEqual([`topic:${"x".repeat(61)}`])
		expect(addOperator("is:unread", "topic", "Personal Growth")).toBe(
			'is:unread topic:"Personal Growth"',
		)
	})

	it("keeps unknown keys, URLs, times and quoted tokens as text", () => {
		for (const q of [
			"https://example.com/a?b=1",
			"note: remember",
			"10:30",
			"label:work",
			'"site:foo"',
			'-"in:trash"',
			"site:",
			'site:""',
		]) {
			const query = parseSearchQuery(q)
			expect(query.filters, q).toEqual([])
			expect(query.ignored, q).toEqual([])
			expect(query.text, q).toBe(q)
		}
	})

	it("keeps a quoted phrase in one token, closed or not", () => {
		expect(parseSearchQuery('"exact  phrase" in:library').text).toBe('"exact  phrase"')
		expect(parseSearchQuery('"never closed in:library').filters).toEqual([])
	})

	it("reports the values a key does not take, and searches for none of them", () => {
		const query = parseSearchQuery("zebra is:unred in:box saved:soon via:carrier sort:best")
		expect(query.text).toBe("zebra")
		expect(query.filters).toEqual([])
		expect(query.ignored).toEqual(["is:unred", "in:box", "saved:soon", "via:carrier", "sort:best"])
	})

	it("does not negate dates or the sort", () => {
		const query = parseSearchQuery("-saved:7d -sort:oldest -before:2026")
		expect(query.filters).toEqual([])
		expect(query.sort).toBeNull()
		expect(query.ignored).toEqual(["-saved:7d", "-sort:oldest", "-before:2026"])
	})

	it("lets the last sort win", () => {
		expect(parseSearchQuery("sort:oldest sort:Longest").sort).toBe("longest")
		expect(parseSearchQuery("zebra").sort).toBeNull()
	})

	it("reads periods", () => {
		expect(saved("2026")).toEqual({ from: { date: "2026-01-01" }, to: { date: "2027-01-01" } })
		expect(saved("2026-12")).toEqual({ from: { date: "2026-12-01" }, to: { date: "2027-01-01" } })
		expect(saved("2028-02-29")).toEqual({
			from: { date: "2028-02-29" },
			to: { date: "2028-03-01" },
		})
		expect(filters("published:0099")[0]?.value).toEqual({
			from: { date: "0099-01-01" },
			to: { date: "0100-01-01" },
		})
	})

	it("reads comparisons against the whole period", () => {
		expect(saved(">2026-08")).toEqual({ from: { date: "2026-09-01" }, to: null })
		expect(saved(">=2026-08")).toEqual({ from: { date: "2026-08-01" }, to: null })
		expect(saved("<2026-08")).toEqual({ from: null, to: { date: "2026-08-01" } })
		expect(saved("<=2026-08")).toEqual({ from: null, to: { date: "2026-09-01" } })
	})

	it("reads ranges, both ends included", () => {
		expect(saved("2026-01..2026-03")).toEqual({
			from: { date: "2026-01-01" },
			to: { date: "2026-04-01" },
		})
		expect(saved("2026-03-05..2026-03-05")).toEqual({
			from: { date: "2026-03-05" },
			to: { date: "2026-03-06" },
		})
	})

	it("reads relative dates", () => {
		expect(saved("7d")).toEqual({ from: { ago: 7, unit: "d" }, to: null })
		expect(saved("2W")).toEqual({ from: { ago: 2, unit: "w" }, to: null })
		expect(saved("3m")).toEqual({ from: { ago: 3, unit: "m" }, to: null })
		expect(saved("1y")).toEqual({ from: { ago: 1, unit: "y" }, to: null })
	})

	it("reads before: and after: as saved dates", () => {
		expect(filters("before:2026-08-15 after:2026")).toEqual([
			{ key: "saved", value: { from: null, to: { date: "2026-08-15" } }, negated: false },
			{ key: "saved", value: { from: { date: "2026-01-01" }, to: null }, negated: false },
		])
	})

	it("refuses what is not a date", () => {
		for (const value of [
			"2026-02-30",
			"2026-13",
			"0000",
			"26",
			">7d",
			"0d",
			"2026-03..2026-01",
			"2026..",
			"yesterday",
		]) {
			expect(parseSearchQuery(`saved:${value}`).ignored, value).toEqual([`saved:${value}`])
		}
		expect(parseSearchQuery("before:7d").ignored).toEqual(["before:7d"])
	})

	it("uses Library as the search location and ignores the old Inbox name", () => {
		expect(parseSearchQuery("in:library").ignored).toEqual([])
		expect(parseSearchQuery("in:inbox").ignored).toEqual(["in:inbox"])
	})

	it("ignores the operators past the cap", () => {
		const many = Array.from({ length: OPERATORS_MAX + 2 }, () => "is:long")
		const query = parseSearchQuery(many.join(" "))
		expect(query.filters).toHaveLength(OPERATORS_MAX)
		expect(query.ignored).toEqual(["is:long", "is:long"])
	})

	it("cuts the query before parsing", () => {
		const query = parseSearchQuery(`${"a".repeat(QUERY_MAX)} in:trash`)
		expect(query.filters).toEqual([])
		expect(query.text).toHaveLength(QUERY_MAX)
	})

	it("records where each token is", () => {
		const q = '  zebra  -author:"Paul Graham" is:unred'
		const { tokens } = parseSearchQuery(q)
		expect(tokens.map((t) => [t.kind, q.slice(t.start, t.end)])).toEqual([
			["text", "zebra"],
			["operator", '-author:"Paul Graham"'],
			["ignored", "is:unred"],
		])
		expect(tokens[1]).toMatchObject({ key: "author", value: "Paul Graham" })
		expect(tokens[2]).toMatchObject({ key: "is", value: "unred" })
	})
})

describe("editing a query", () => {
	it("removes the operators of a key, negated and ignored ones too", () => {
		expect(removeOperator('"a  phrase" in:archive zebra -in:trash in:box', "in")).toBe(
			'"a  phrase" zebra',
		)
	})

	it("removes one value of a key", () => {
		expect(removeOperator("is:starred zebra IS:Unread -is:starred", "is", "starred")).toBe(
			"zebra IS:Unread",
		)
	})

	it("appends an operator, quoting a value with spaces", () => {
		expect(addOperator("zebra ", "in", "archive")).toBe("zebra in:archive")
		expect(addOperator("", "is", "starred")).toBe("is:starred")
		expect(addOperator("zebra", "author", 'Paul "PG" Graham')).toBe('zebra author:"Paul PG Graham"')
	})

	it("keeps only the words", () => {
		expect(textOnly('in:archive "exact phrase" is:unred -boring sort:oldest')).toBe(
			'"exact phrase" -boring',
		)
		expect(textOnly("in:archive")).toBe("")
	})
})

describe("a tag renamed in a query", () => {
	it("rewrites plain, quoted and negated tokens, and leaves the rest as typed", () => {
		expect(renameTagOperator("is:unread tag:old site:x", "old", "new")).toBe(
			"is:unread tag:new site:x",
		)
		expect(renameTagOperator('zebra  tag:"deep work" -tag:later', "deep work", "focus")).toBe(
			"zebra  tag:focus -tag:later",
		)
		expect(renameTagOperator("-tag:old  zebra", "old", "new")).toBe("-tag:new  zebra")
	})

	it("quotes a new name with a space", () => {
		expect(renameTagOperator("tag:ml zebra", "ml", "machine learning")).toBe(
			'tag:"machine learning" zebra',
		)
	})

	it("matches whatever the case, and however the spaces were typed", () => {
		expect(renameTagOperator("TAG:OLD", "old", "new")).toBe("tag:new")
		expect(renameTagOperator('tag:"Deep  Work"', "deep work", "focus")).toBe("tag:focus")
	})

	it("leaves other tags, other operators and words alone", () => {
		const q = 'tag:older tag:"old news" site:old title:old old "tag:old"'
		expect(renameTagOperator(q, "old", "new")).toBe(q)
	})

	it("drops the repeat a merge leaves, by sign", () => {
		expect(renameTagOperator("tag:old zebra tag:New", "old", "new")).toBe("tag:new zebra")
		expect(renameTagOperator("tag:new -tag:old -tag:new", "old", "new")).toBe("tag:new -tag:new")
		expect(renameTagOperator("-tag:new tag:old", "old", "new")).toBe("-tag:new tag:new")
	})

	it("leaves a query that would grow past the limit", () => {
		const q = `${"z".repeat(QUERY_MAX - 6)} tag:a`
		expect(renameTagOperator(q, "a", "a longer name")).toBe(q)
		expect(renameTagOperator(q, "a", "b")).toBe(`${"z".repeat(QUERY_MAX - 6)} tag:b`)
	})
})

describe("a topic renamed, merged or split in a query", () => {
	it("points topic: and -topic: at the new name, quoting it when it has a space", () => {
		expect(renameTopicOperator("is:unread topic:Writing site:x", "Writing", ["Craft"])).toBe(
			"is:unread topic:Craft site:x",
		)
		expect(renameTopicOperator('-topic:"personal growth" zebra', "Personal Growth", ["Self"])).toBe(
			"-topic:Self zebra",
		)
		expect(renameTopicOperator("topic:ml", "ML", ["Machine Learning"])).toBe(
			'topic:"Machine Learning"',
		)
	})

	it("matches names with quotes without them", () => {
		expect(renameTopicOperator('topic:"Say No"', 'Say "No"', ['Say "Yes"'])).toBe('topic:"Say Yes"')
	})

	it("writes one token for each topic a split made, which widen", () => {
		expect(renameTopicOperator("topic:Writing is:unread", "Writing", ["Craft", "Audience"])).toBe(
			"topic:Craft topic:Audience is:unread",
		)
		expect(renameTopicOperator("-topic:Writing", "Writing", ["Craft", "Audience"])).toBe(
			"-topic:Craft -topic:Audience",
		)
	})

	it("drops the repeats a merge makes, and leaves other tokens alone", () => {
		expect(renameTopicOperator("topic:Writing topic:Startups", "Writing", ["Startups"])).toBe(
			"topic:Startups",
		)
		expect(renameTopicOperator("topic:Startups topic:Writing x", "Writing", ["Startups"])).toBe(
			"topic:Startups x",
		)
		const q = 'topic:Writer topic:"Writing club" tag:Writing Writing "topic:Writing"'
		expect(renameTopicOperator(q, "Writing", ["Craft"])).toBe(q)
	})

	it("drops the topic's tokens when nothing takes its place", () => {
		expect(renameTopicOperator("topic:Writing is:unread -topic:writing", "Writing", [])).toBe(
			"is:unread",
		)
		expect(renameTopicOperator("topic:Writing", "Writing", [])).toBe("")
	})

	it("leaves a query past the limit as it was", () => {
		const q = `${"z".repeat(QUERY_MAX - 8)} topic:a`
		expect(renameTopicOperator(q, "a", ["bbbbbbbb"])).toBe(q)
	})
})

describe("topicsNamedIn", () => {
	it("lists each topic once, as written, negated or not", () => {
		expect(topicsNamedIn('topic:Writing -topic:"Personal Growth" topic:writing tag:x')).toEqual([
			"Writing",
			"Personal Growth",
		])
		expect(topicsNamedIn('Writing "topic:Writing"')).toEqual([])
	})
})

describe("canSaveSearch", () => {
	it("refuses a query the search would cut", () => {
		expect(canSaveSearch("z".repeat(200))).toBe(true)
		expect(canSaveSearch("z".repeat(201))).toBe(false)
	})
})

describe("defaultSavedSearchName", () => {
	it("names a search by its query, or by its tag when it is one tag", () => {
		expect(defaultSavedSearchName("  deep   work ")).toBe("deep work")
		expect(defaultSavedSearchName('tag:"work advice"')).toBe("work advice")
		expect(defaultSavedSearchName("-tag:ai")).toBe("-tag:ai")
		expect(defaultSavedSearchName('topic:"Personal Growth"')).toBe("Personal Growth")
		expect(defaultSavedSearchName("-topic:Writing")).toBe("-topic:Writing")
		expect(defaultSavedSearchName("z".repeat(80))).toHaveLength(50)
	})
})
