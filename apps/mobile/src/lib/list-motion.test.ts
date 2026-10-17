import type { ArticleSummary } from "@klipstack/sdk"
import { describe, expect, it } from "vitest"
import {
	type Act,
	actionMotion,
	advance,
	entering,
	motionState,
	settle,
	withLeaving,
} from "./list-motion"

function article(id: string, extra: Partial<ArticleSummary> = {}): ArticleSummary {
	return {
		id,
		location: "inbox",
		trashedAt: null,
		savedAt: "2026-09-01T00:00:00Z",
		...extra,
	} as ArticleSummary
}

const ids = (list: { id: string }[]) => list.map((a) => a.id).join("")

describe("actionMotion", () => {
	it("stamps an article archived out of a list, and lifts away the rest that leave", () => {
		const inbox = article("a")
		const archived = article("a", { location: "archive" })
		expect(actionMotion(inbox, archived, false)).toBe("archive")
		expect(actionMotion(inbox, article("a", { trashedAt: "2026-10-17T00:00:00Z" }), false)).toBe(
			"lift",
		)
		// Out of the archive, back to the Inbox: lifted, not stamped.
		expect(actionMotion(archived, inbox, false)).toBe("lift")
	})

	it("stamps an article archived where it stays, and plays nothing for other changes there", () => {
		expect(actionMotion(article("a"), article("a", { location: "archive" }), true)).toBe("stamp")
		expect(actionMotion(article("a"), article("a", { starred: true }), true)).toBeNull()
	})
})

describe("withLeaving", () => {
	it("keeps a leaving article where it was, after the one before it", () => {
		const shown = [article("a"), article("b"), article("c"), article("d")]
		expect(ids(withLeaving(shown, [shown[0]!, shown[2]!, shown[3]!], new Set(["b"])))).toBe("abcd")
		// The first one, and two in a row.
		expect(ids(withLeaving(shown, [shown[2]!, shown[3]!], new Set(["a", "b"])))).toBe("abcd")
		// Done leaving: gone.
		expect(ids(withLeaving(shown, [shown[0]!, shown[2]!], new Set(["b"])))).toBe("abc")
	})

	it("keeps a newcomer where the list puts it", () => {
		const shown = [article("a"), article("b")]
		const next = [article("n"), article("a")]
		expect(ids(withLeaving(shown, next, new Set(["b"])))).toBe("nab")
	})
})

describe("entering", () => {
	const newer = { savedAt: "2026-10-17T12:00:00Z" }

	it("drops in a save newer than the list, and brings back one undone", () => {
		const shown = [article("a"), article("b")]
		const next = [article("n", newer), article("a"), article("u"), article("b")]
		const motions = entering(shown, next, new Set(["u"]))
		expect(motions.get("n")).toBe("arrive")
		expect(motions.get("u")).toBe("return")
		expect(motions.size).toBe(2)
	})

	it("plays nothing on a first load, for an older save, or for a further page", () => {
		const next = [article("n", newer), article("a")]
		expect(entering(null, next, new Set()).size).toBe(0)
		expect(entering([], next, new Set()).size).toBe(0)
		const older = article("old", { savedAt: "2026-08-01T00:00:00Z" })
		expect(entering([article("a")], [older, article("a")], new Set()).size).toBe(0)
		// Below the last article shown: the next page, however new.
		expect(entering([article("a")], [article("a"), article("p", newer)], new Set()).size).toBe(0)
	})
})

describe("advance and settle", () => {
	const archive: Act = { motion: "archive", date: "Oct 17, 2026" }

	it("keeps an archived article on screen until it has played, then lets it go", () => {
		const [a, b, c] = [article("a"), article("b"), article("c")]
		let state = advance(motionState(null), [a, b, c], new Map())
		state = advance(state, [a, c], new Map([["b", archive]]))
		expect(ids(state.data!)).toBe("abc")
		expect(state.playing.get("b")).toEqual(archive)
		// An edit while it plays keeps it.
		state = advance(state, [a, { ...c, starred: true }], new Map())
		expect(ids(state.data!)).toBe("abc")
		state = settle(state, "b")
		expect(ids(state.data!)).toBe("ac")
		expect(state.playing.size).toBe(0)
	})

	it("lets an article that left without an action go at once, and brings back an undone one", () => {
		const [a, b] = [article("a"), article("b")]
		let state = advance(motionState(null), [a, b], new Map())
		expect(ids(advance(state, [a], new Map()).data!)).toBe("a")
		state = advance(state, [a], new Map([["b", { motion: "lift", date: "" }]]))
		state = settle(state, "b")
		state = advance(state, [a, b], new Map())
		expect(state.playing.get("b")?.motion).toBe("return")
	})
})
