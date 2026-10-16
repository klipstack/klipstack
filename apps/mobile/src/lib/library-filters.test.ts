import type { ArticleSummary } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	archivedReadNotice,
	defaultSort,
	filterLine,
	filterMenu,
	inFilter,
	narrowKept,
	sortsFor,
	stillInFilter,
} from "./library-filters"

const article = (id: string, fields: Partial<ArticleSummary> = {}): ArticleSummary =>
	({
		id,
		url: `https://example.com/${id}`,
		savedAt: "2026-10-01T00:00:00.000Z",
		status: "ready",
		opened: false,
		finished: false,
		readingMinutes: 20,
		...fields,
	}) as ArticleSummary

describe("filterMenu", () => {
	it("offers All, then the view's filters with articles in them, with their counts", () => {
		const menu = filterMenu("inbox", { progress: 2, unread: 5, again: 0, read: 1, x: 0 }, null)
		expect(menu.map((c) => [c.label, c.count, c.on])).toEqual([
			["All", null, true],
			["Continue reading", 2, false],
			["Unread", 5, false],
			["Read", 1, false],
		])
	})

	it("keeps the chosen filter when it holds nothing now", () => {
		const menu = filterMenu("archive", { unfinished: 3, finished: 0 }, "finished")
		expect(menu.map((c) => [c.value, c.count, c.on])).toEqual([
			[null, null, false],
			["unfinished", 3, false],
			["finished", 0, true],
		])
	})

	it("offers every filter, uncounted, without counts", () => {
		expect(filterMenu("starred", null, "long").map((c) => [c.label, c.count, c.on])).toEqual([
			["All", null, false],
			["Not finished", null, false],
			["Finished", null, false],
			["Quick reads", null, false],
			["Long reads", null, true],
			["From X", null, false],
		])
	})
})

describe("sorting", () => {
	it("sorts Inbox only", () => {
		expect(sortsFor("inbox")).toEqual(["recent", "newest", "oldest", "shortest", "longest"])
		expect(sortsFor("archive")).toEqual([])
	})

	it("shows what is in progress most recently read first, the rest newest first", () => {
		expect(defaultSort("progress")).toBe("recent")
		expect(defaultSort(null)).toBe("newest")
		expect(defaultSort("read")).toBe("newest")
	})
})

describe("inFilter", () => {
	it("decides Inbox's filters as the server does", () => {
		const fresh = article("a")
		const started = article("b", { opened: true, progress: 0.3 })
		const read = article("c", { opened: true, finished: true })
		expect(["unread", "progress", "read"].map((f) => inFilter("inbox", f as never, fresh))).toEqual(
			[true, false, false],
		)
		expect(inFilter("inbox", "progress", started)).toBe(true)
		expect(inFilter("inbox", "read", read)).toBe(true)
		expect(inFilter("inbox", "unread", article("d", { status: "failed" }))).toBe(false)
	})

	it("leaves read articles out of Inbox's lengths, but not out of the archive's", () => {
		const long = article("a", { readingMinutes: 30 })
		expect(inFilter("inbox", "long", long)).toBe(true)
		expect(inFilter("inbox", "long", article("b", { readingMinutes: 29 }))).toBe(false)
		expect(inFilter("inbox", "long", { ...long, finished: true })).toBe(false)
		expect(inFilter("archive", "long", { ...long, finished: true })).toBe(true)
		expect(inFilter("inbox", "long", article("c", { readingMinutes: null }))).toBe(false)
	})

	it("says when it can't tell", () => {
		// A short post is not a quick read; the summary doesn't say which it is.
		expect(inFilter("inbox", "quick", article("a", { readingMinutes: 10 }))).toBeNull()
		expect(inFilter("inbox", "quick", article("b", { readingMinutes: 11 }))).toBe(false)
		expect(inFilter("inbox", "again", article("c"))).toBeNull()
		expect(inFilter("inbox", "again", article("d", { opened: true }))).toBe(false)
	})

	it("finds X's posts by their address", () => {
		expect(inFilter("starred", "x", article("a", { url: "https://x.com/someone/status/1" }))).toBe(
			true,
		)
		expect(inFilter("starred", "x", article("b", { url: "https://example.com/x.com/" }))).toBe(
			false,
		)
	})
})

it("takes an article out of a filtered list once it no longer belongs, and keeps it when unsure", () => {
	const unread = article("a")
	expect(stillInFilter("inbox", "read", unread)).toBe(false)
	expect(stillInFilter("inbox", "unread", unread)).toBe(true)
	expect(stillInFilter("inbox", "again", unread)).toBe(true)
	expect(stillInFilter("inbox", null, unread)).toBe(true)
})

describe("narrowKept", () => {
	const kept = [
		article("long", { readingMinutes: 45, savedAt: "2026-10-03T00:00:00.000Z" }),
		article("short", { readingMinutes: 4, savedAt: "2026-10-02T00:00:00.000Z" }),
		article("unknown", { readingMinutes: null, savedAt: "2026-10-01T00:00:00.000Z" }),
		article("started", { opened: true, readingMinutes: 12, savedAt: "2026-09-30T00:00:00.000Z" }),
	]
	const ids = (items: ArticleSummary[] | null) => items?.map((a) => a.id) ?? null

	it("keeps the kept order for Newest first and Recently read", () => {
		expect(ids(narrowKept(kept, "inbox", null, "newest"))).toEqual([
			"long",
			"short",
			"unknown",
			"started",
		])
		expect(ids(narrowKept(kept, "inbox", "progress", "recent"))).toEqual(["started"])
	})

	it("sorts by age and length, unknown lengths last both ways", () => {
		expect(ids(narrowKept(kept, "inbox", null, "oldest"))).toEqual([
			"started",
			"unknown",
			"short",
			"long",
		])
		expect(ids(narrowKept(kept, "inbox", null, "shortest"))).toEqual([
			"short",
			"started",
			"long",
			"unknown",
		])
		expect(ids(narrowKept(kept, "inbox", null, "longest"))).toEqual([
			"long",
			"started",
			"short",
			"unknown",
		])
	})

	it("narrows to the filter, and gives up when the summaries can't say", () => {
		expect(ids(narrowKept(kept, "inbox", "unread", "oldest"))).toEqual(["unknown", "short", "long"])
		expect(narrowKept(kept, "inbox", "again", "newest")).toBeNull()
		expect(narrowKept(kept, "inbox", "quick", "newest")).toBeNull()
		expect(ids(narrowKept(kept, "inbox", "read", "newest"))).toEqual([])
	})
})

it("says what was archived, and what a filtered list shows", () => {
	expect(archivedReadNotice(0)).toBe("Nothing to archive: no read articles in Inbox.")
	expect(archivedReadNotice(1)).toBe("1 article archived")
	expect(archivedReadNotice(12)).toBe("12 articles archived")
	expect(filterLine("read", 1)).toBe("Read · 1 article")
	expect(filterLine("unfinished", 3)).toBe("Not finished · 3 articles")
	expect(filterLine("unread", undefined)).toBe("Unread")
})
