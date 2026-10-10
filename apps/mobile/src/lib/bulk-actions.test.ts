import type { ArticleSummary } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import { actedOn, afterAction, bulkActions, inView, stillShown } from "./bulk-actions"

const article = (fields: Partial<ArticleSummary> = {}): ArticleSummary =>
	({
		id: "a",
		status: "ready",
		starred: false,
		shortlisted: false,
		location: "inbox",
		archivedAt: null,
		finished: false,
		finishedAt: null,
		opened: true,
		progress: 0.4,
		trashedAt: null,
		...fields,
	}) as ArticleSummary

describe("bulkActions", () => {
	const actions = (cards: ArticleSummary[]) => bulkActions(cards).actions

	it("offers nothing without a selection", () => {
		expect(bulkActions([])).toEqual({ kind: "none", actions: [] })
	})

	it("applies a state when any article lacks it", () => {
		const cards = [article({ starred: true, finished: true }), article({ location: "archive" })]
		expect(actions(cards)).toEqual(["star", "archive", "finish", "tag", "delete"])
	})

	it("takes a state away when all articles have it", () => {
		const cards = [article({ starred: true, location: "archive", finished: true })]
		expect(actions(cards)).toEqual(["unstar", "unarchive", "unread", "tag", "delete"])
	})

	it("leaves failed saves out of everything but Delete", () => {
		expect(actions([article({ status: "failed" })])).toEqual(["delete"])
		const cards = [article({ status: "failed" }), article({ starred: true })]
		expect(actions(cards)[0]).toBe("unstar")
		expect(actedOn(cards, "unstar")).toEqual([cards[1]])
		expect(actedOn(cards, "delete")).toEqual(cards)
	})

	it("only restores articles in the trash, and not with others", () => {
		const trashed = article({ trashedAt: "2026-09-20T10:00:00.000Z" })
		expect(bulkActions([trashed])).toEqual({ kind: "trash", actions: ["restore"] })
		expect(bulkActions([trashed, article()])).toEqual({ kind: "mixed", actions: [] })
	})
})

describe("afterAction", () => {
	const now = "2026-09-27T10:00:00.000Z"

	it("archives what it finishes", () => {
		const done = afterAction(article(), "finish", now)
		expect(done).toMatchObject({ finished: true, location: "archive", archivedAt: now })
	})

	it("marks for the next edition and takes the mark off, and no list loses the article", () => {
		const marked = afterAction(article(), "shortlist", now)
		expect(marked.shortlisted).toBe(true)
		expect(afterAction(marked, "unshortlist", now).shortlisted).toBe(false)
		expect(inView("inbox", marked)).toBe(true)
	})

	it("starts an article over when marked unread, where it is", () => {
		const done = afterAction(article({ finished: true, location: "archive" }), "unread", now)
		expect(done).toMatchObject({ finished: false, opened: false, progress: 0 })
		expect(done.location).toBe("archive")
	})

	it("takes a restored article out of the trash", () => {
		const trashed = article({ trashedAt: "2026-09-20T10:00:00.000Z" })
		expect(afterAction(trashed, "restore", now).trashedAt).toBeNull()
	})

	it("moves articles out of the views they leave", () => {
		expect(inView("inbox", afterAction(article(), "archive", now))).toBe(false)
		expect(inView("archive", afterAction(article(), "archive", now))).toBe(true)
		expect(inView("starred", afterAction(article({ starred: true }), "unstar", now))).toBe(false)
		expect(inView("starred", afterAction(article({ starred: true }), "archive", now))).toBe(true)
		expect(inView("archive", afterAction(article({ location: "archive" }), "delete", now))).toBe(
			false,
		)
	})

	it("keeps a search's results after an action, but not one just deleted", () => {
		const search = { query: "tag:ai" }
		const item = article()
		expect(stillShown(search, item, afterAction(item, "archive", now))).toBe(true)
		expect(stillShown(search, item, afterAction(item, "delete", now))).toBe(false)
		expect(stillShown({ view: "inbox" }, item, afterAction(item, "archive", now))).toBe(false)
		const trashed = article({ trashedAt: "2026-09-20T10:00:00.000Z" })
		expect(stillShown({ query: "in:trash" }, trashed, afterAction(trashed, "restore", now))).toBe(
			true,
		)
	})

	it("keeps the trash to trashed articles", () => {
		const trashed = article({ trashedAt: "2026-09-20T10:00:00.000Z" })
		expect(inView("trash", trashed)).toBe(true)
		expect(inView("trash", afterAction(trashed, "restore", now))).toBe(false)
		expect(inView("trash", afterAction(article(), "delete", now))).toBe(true)
	})
})
