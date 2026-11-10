import { describe, expect, it } from "vitest"
import {
	canBegin,
	IDLE,
	type ResizeEvent,
	type ResizeFlow,
	sessionOf,
	transition,
} from "./highlight-resize-flow"

type S = { draft: string }
const a: S = { draft: "a" }
const b: S = { draft: "b" }
const after = (...events: ResizeEvent<S>[]) => events.reduce(transition, IDLE as ResizeFlow<S>)
const failed = (error = "network") =>
	after(
		{ type: "begin", mode: "pointer", session: a },
		{ type: "sent", session: a, before: null },
		{ type: "answered", error },
	)

describe("a highlight's resize", () => {
	it("drags, saves and goes back to idle", () => {
		expect(after({ type: "begin", mode: "pointer", session: a })).toEqual({
			phase: "pointer",
			session: a,
		})
		expect(
			after(
				{ type: "begin", mode: "keyboard", session: a },
				{ type: "moved", session: b },
				{ type: "sent", session: b, before: "old" },
			),
		).toEqual({ phase: "saving", session: b, before: "old" })
		expect(
			after(
				{ type: "begin", mode: "pointer", session: a },
				{ type: "sent", session: a, before: null },
				{ type: "answered", error: null },
			),
		).toBe(IDLE)
	})

	it("keeps one resize at a time, and a save can't be cancelled", () => {
		const dragging = after({ type: "begin", mode: "pointer", session: a })
		expect(transition(dragging, { type: "begin", mode: "keyboard", session: b })).toBe(dragging)
		const saving = transition(dragging, { type: "sent", session: a, before: null })
		expect(transition(saving, { type: "cancelled" })).toBe(saving)
		expect(transition(saving, { type: "sent", session: b, before: null })).toBe(saving)
		expect(sessionOf(saving)).toBe(a)
	})

	it("after a failure, waits for the refresh before a retry or a new resize", () => {
		const waiting = failed()
		expect(waiting).toEqual({ phase: "failed", attempt: a, error: "network", refreshed: false })
		expect(sessionOf(waiting)).toBeNull()
		expect(canBegin(waiting)).toBe(false)
		expect(transition(waiting, { type: "begin", mode: "keyboard", session: b })).toBe(waiting)
		expect(transition(waiting, { type: "sent", session: a, before: null })).toBe(waiting)

		const fresh = transition(waiting, { type: "refreshed", attempt: a })
		expect(fresh).toEqual({ phase: "failed", attempt: a, error: "network", refreshed: true })
		expect(canBegin(fresh)).toBe(true)
		// A retry sends again; a new resize drops the failure.
		expect(transition(fresh, { type: "sent", session: a, before: null }).phase).toBe("saving")
		expect(transition(fresh, { type: "begin", mode: "keyboard", session: b })).toEqual({
			phase: "keyboard",
			session: b,
		})
	})

	it("takes only the refresh of the attempt that failed", () => {
		const waiting = failed()
		expect(transition(waiting, { type: "refreshed", attempt: b })).toBe(waiting)
		// A late refresh of an earlier failure does not unblock a later one.
		expect(transition(IDLE as ResizeFlow<S>, { type: "refreshed", attempt: a })).toBe(IDLE)
	})

	it("keeps the attempt with every failure until it settles", () => {
		const fresh = transition(failed(), { type: "refreshed", attempt: a })
		expect(transition(fresh, { type: "refused", error: "highlight_changed" })).toEqual({
			phase: "failed",
			attempt: a,
			error: "highlight_changed",
			refreshed: true,
		})
		expect(transition(fresh, { type: "settled" })).toBe(IDLE)
	})

	it("drops a session whose highlight went away, never a failure", () => {
		expect(after({ type: "begin", mode: "pointer", session: a }, { type: "gone" })).toBe(IDLE)
		const waiting = failed()
		expect(transition(waiting, { type: "gone" })).toBe(waiting)
	})
})
