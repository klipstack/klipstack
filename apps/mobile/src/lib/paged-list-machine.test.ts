import { describe, expect, it } from "vitest"
import {
	type Page,
	type PagedList,
	type PagedListEvent,
	pagedListStart,
	pagedListTransition,
} from "./paged-list-machine"

type Item = { id: string }
const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }))
const page = (next: string | null, ...ids: string[]): Page<Item> => ({
	items: items(...ids),
	nextCursor: next,
})

function run(state: PagedList<Item>, ...events: PagedListEvent<Item>[]): PagedList<Item> {
	return events.reduce(pagedListTransition, state)
}

/** Loaded once: a, b, and a next page. */
function shown() {
	const loading = run(pagedListStart(), { type: "load" })
	return run(loading, { type: "loaded", ticket: loading.ticket, page: page("c1", "a", "b") })
}

describe("a paged list", () => {
	it("adds the next page, without the ones it already shows", () => {
		const asking = run(shown(), { type: "more" })
		expect(asking.more).toEqual({ status: "loading", ticket: asking.ticket })
		const next = run(asking, {
			type: "moreLoaded",
			ticket: asking.ticket,
			page: page(null, "b", "c"),
		})
		expect(next).toMatchObject({
			items: items("a", "b", "c"),
			next: null,
			more: { status: "idle" },
		})
	})

	it("asks for one next page at a time, and none past the end", () => {
		const asking = run(shown(), { type: "more" })
		expect(pagedListTransition(asking, { type: "more" })).toBe(asking)
		const end = run(asking, { type: "moreLoaded", ticket: asking.ticket, page: page(null, "c") })
		expect(pagedListTransition(end, { type: "more" })).toBe(end)
	})

	it("drops a load's answer once a later load started", () => {
		const first = run(shown(), { type: "load" })
		const second = run(first, { type: "load" })
		expect(run(second, { type: "loaded", ticket: first.ticket, page: page(null, "x") })).toBe(
			second,
		)
		expect(run(second, { type: "loadFailed", ticket: first.ticket, message: "No" })).toBe(second)
	})

	it("starts over for another query: the old query's next page doesn't land in the new list", () => {
		const asking = run(shown(), { type: "more" }, { type: "refreshing", on: true })
		const other = run(asking, { type: "asked" })
		// Empty, and nothing on its way: no spinner at the end, and its own next page can load.
		expect(other).toMatchObject({ items: null, next: null, refreshing: false })
		expect(other.more).toEqual({ status: "idle" })
		const late = page("c9", "old")
		expect(run(other, { type: "moreLoaded", ticket: asking.ticket, page: late })).toBe(other)
		expect(run(other, { type: "moreFailed", ticket: asking.ticket, message: "No" })).toBe(other)
	})

	it("says when the next page fails", () => {
		const asking = run(shown(), { type: "more" })
		const failed = run(asking, { type: "moreFailed", ticket: asking.ticket, message: "Offline" })
		expect(failed).toMatchObject({ error: "Offline", more: { status: "failed" } })
	})

	it("stops saying a reload failed once a next page loads", () => {
		const again = run(shown(), { type: "load" })
		const failed = run(again, { type: "loadFailed", ticket: again.ticket, message: "Offline" })
		expect(failed).toMatchObject({ error: "Offline", items: items("a", "b") })
		const asked = run(failed, { type: "more" })
		const more = run(asked, { type: "moreLoaded", ticket: asked.ticket, page: page(null, "c") })
		expect(more).toMatchObject({ error: null, items: items("a", "b", "c") })
	})

	it("doesn't ask for a failed next page again until the list loads again", () => {
		const asking = run(shown(), { type: "more" })
		const failed = run(asking, { type: "moreFailed", ticket: asking.ticket, message: "Offline" })
		expect(pagedListTransition(failed, { type: "more" })).toBe(failed)
		// A load that fails too (still offline) doesn't free it either.
		const again = run(failed, { type: "load" })
		const stillOff = run(again, { type: "loadFailed", ticket: again.ticket, message: "Offline" })
		expect(pagedListTransition(stillOff, { type: "more" })).toBe(stillOff)
		const back = run(stillOff, { type: "load" })
		const loaded = run(back, { type: "loaded", ticket: back.ticket, page: page("c1", "a", "b") })
		expect(run(loaded, { type: "more" }).more.status).toBe("loading")
	})

	it("asks for a failed next page again when the reader taps Try Again", () => {
		const asking = run(shown(), { type: "more" })
		const failed = run(asking, { type: "moreFailed", ticket: asking.ticket, message: "Offline" })
		const again = run(failed, { type: "retryMore" })
		expect(again.more).toEqual({ status: "loading", ticket: again.ticket })
		const more = run(again, { type: "moreLoaded", ticket: again.ticket, page: page(null, "c") })
		expect(more).toMatchObject({ error: null, items: items("a", "b", "c") })
		// Only after a failure: not while one loads, nor when nothing failed.
		expect(pagedListTransition(asking, { type: "retryMore" })).toBe(asking)
		expect(pagedListTransition(shown(), { type: "retryMore" }).more.status).toBe("idle")
	})

	it("drops a next page asked before an edit, and lets the next one load", () => {
		const asking = run(shown(), { type: "more" })
		const edited = run(asking, {
			type: "edited",
			change: (list) => list.filter((item) => item.id !== "a"),
		})
		expect(edited.items).toEqual(items("b"))
		const late = run(edited, { type: "moreFailed", ticket: asking.ticket, message: "No" })
		expect(late).toMatchObject({ error: null, more: { status: "idle" }, items: items("b") })
	})

	it("shows what was kept offline only while it shows nothing", () => {
		const loading = run(pagedListStart(), { type: "load" })
		const kept = run(loading, {
			type: "loadFailed",
			ticket: loading.ticket,
			message: "Offline",
			kept: items("k"),
		})
		expect(kept).toMatchObject({ items: items("k"), error: "Offline" })
		const again = run(shown(), { type: "load" })
		const failed = run(again, {
			type: "loadFailed",
			ticket: again.ticket,
			message: "Offline",
			kept: items("k"),
		})
		expect(failed.items).toEqual(items("a", "b"))
	})
})
