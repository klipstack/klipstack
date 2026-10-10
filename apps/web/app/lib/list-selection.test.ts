import { describe, expect, it } from "vitest"
import { bulkActions } from "./bulk-actions"
import {
	INITIAL_LIST_STATE,
	isSelecting,
	type ListAction,
	type ListState,
	listReducer,
	selectionScope,
} from "./list-selection"

const ids = ["a", "b", "c", "d", "e"]
const run = (...actions: ListAction[]) => actions.reduce(listReducer, INITIAL_LIST_STATE)
const checked = (s: ListState) => [...s.checked].sort()
const move = (step: number, extend = false): ListAction => ({
	type: "move",
	step,
	visible: ids,
	extend,
})

describe("list selection", () => {
	it("x toggles the cursor's card, or the first one", () => {
		const s = run({ type: "toggle-cursor", visible: ids })
		expect(s.cursor).toBe("a")
		expect(checked(s)).toEqual(["a"])
		expect(checked(listReducer(s, { type: "toggle-cursor", visible: ids }))).toEqual([])
	})

	it("shift+j extends from where the range began, and shift+k shrinks it back", () => {
		let s = run(move(1), move(1)) // cursor on b
		s = listReducer(s, move(1, true)) // c
		s = listReducer(s, move(1, true)) // d
		expect(checked(s)).toEqual(["b", "c", "d"])
		s = listReducer(s, move(-1, true))
		expect(checked(s)).toEqual(["b", "c"])
	})

	it("a range adds to what was checked before it, and a plain move starts a new one", () => {
		let s = run(move(1), { type: "toggle-cursor", visible: ids }) // a
		s = listReducer(s, move(1)) // b, not checked
		s = listReducer(s, move(1)) // c
		s = listReducer(s, move(1, true)) // d
		expect(checked(s)).toEqual(["a", "c", "d"])
	})

	it("shift-click checks the range from the card toggled last", () => {
		let s = run({ type: "click", id: "b", range: false, visible: ids })
		s = listReducer(s, { type: "click", id: "d", range: true, visible: ids })
		expect(checked(s)).toEqual(["b", "c", "d"])
		s = listReducer(s, { type: "click", id: "a", range: true, visible: ids })
		expect(checked(s)).toEqual(["a", "b"])
	})

	it("Escape clears the selection first, then the cursor", () => {
		let s = run(move(1), { type: "toggle-cursor", visible: ids })
		s = listReducer(s, { type: "escape" })
		expect(checked(s)).toEqual([])
		expect(s.cursor).toBe("a")
		s = listReducer(s, { type: "escape" })
		expect(s.cursor).toBeNull()
	})

	it("Select turns selecting on with nothing checked; Done clears", () => {
		let s = run({ type: "toggle-mode" })
		expect(isSelecting(s)).toBe(true)
		s = listReducer(s, { type: "click", id: "c", range: false, visible: ids })
		s = listReducer(s, { type: "toggle-mode" })
		expect(isSelecting(s)).toBe(false)
		expect(checked(s)).toEqual([])
	})

	it("forgets cards that left the list, and keeps the same state when none did", () => {
		const s = run({ type: "check-all", ids })
		expect(listReducer(s, { type: "prune", ids })).toBe(s)
		expect(checked(listReducer(s, { type: "prune", ids: ["a", "e"] }))).toEqual(["a", "e"])
		expect(checked(listReducer(s, { type: "uncheck", ids: ["a", "e"] }))).toEqual(["b", "c", "d"])
	})

	it("selects all in the section the selection or the cursor is in", () => {
		const sections = [
			["a", "b"],
			["t1", "t2"],
		]
		expect(selectionScope(sections, new Set(["t2"]), "a")).toEqual(["t1", "t2"])
		expect(selectionScope(sections, new Set(), "t1")).toEqual(["t1", "t2"])
		expect(selectionScope(sections, new Set(), null)).toEqual(["a", "b"])
	})
})

describe("bulk actions", () => {
	const card = (over: Partial<Parameters<typeof bulkActions>[0][number]> = {}) => ({
		status: "ready",
		deletedAt: null,
		starredAt: null,
		shortlistedAt: null,
		archivedAt: null,
		readAt: null,
		...over,
	})
	const now = new Date()

	it("apply a state when any lacks it, and take it away when all have it", () => {
		expect(bulkActions([card(), card({ starredAt: now, shortlistedAt: now })]).actions).toEqual([
			"star",
			"shortlist",
			"archive",
			"finish",
			"tag",
			"delete",
		])
		const all = { starredAt: now, shortlistedAt: now, archivedAt: now, readAt: now }
		expect(bulkActions([card(all)]).actions).toEqual([
			"unstar",
			"unshortlist",
			"unarchive",
			"unread",
			"tag",
			"delete",
		])
	})

	it("offer only Restore in the trash, and nothing for trash and live together", () => {
		expect(bulkActions([card({ deletedAt: now })])).toEqual({ kind: "trash", actions: ["restore"] })
		expect(bulkActions([card(), card({ deletedAt: now })]).kind).toBe("mixed")
		expect(bulkActions([]).kind).toBe("none")
	})

	it("leave failed saves out of the toggles", () => {
		expect(bulkActions([card({ status: "failed" })]).actions).toEqual(["delete"])
		expect(bulkActions([card({ status: "failed" }), card({ starredAt: now })]).actions[0]).toBe(
			"unstar",
		)
	})
})
