import { describe, expect, it } from "vitest"
import { IDLE, type TabEvent, type TabStatus, transition } from "./save-flow"

const saved = { ok: true, status: 201, id: "1", readUrl: "https://k/read/1" }
const refused = { ok: false, status: 502, error: "http_502" }

/** The status after each event in turn, from idle. */
const after = (...events: TabEvent[]) => events.reduce(transition, IDLE as TabStatus)

describe("a tab's save", () => {
	it("goes from sending to its outcome, then back to idle", () => {
		expect(after({ type: "sending" })).toEqual({ phase: "saving" })
		expect(after({ type: "sending" }, { type: "answered", result: saved })).toEqual({
			phase: "saved",
			result: saved,
		})
		expect(after({ type: "sending" }, { type: "answered", result: refused })).toEqual({
			phase: "failed",
			failure: { reason: "refused", result: refused },
		})
		expect(after({ type: "sending" }, { type: "answered", result: saved }, { type: "faded" })).toBe(
			IDLE,
		)
	})

	it("fades only an outcome, never a save under way", () => {
		const saving = after({ type: "sending" })
		expect(transition(saving, { type: "faded" })).toBe(saving)
		const signingIn = after({ type: "signInNeeded" })
		expect(transition(signingIn, { type: "faded" })).toBe(signingIn)
	})

	it("goes back to idle, quietly, when the reader closes the sign-in", () => {
		expect(after({ type: "signInNeeded" }, { type: "signInAbandoned" })).toBe(IDLE)
		// A save that started again meanwhile is not the closed sign-in's.
		const saving = after({ type: "signInNeeded" }, { type: "sending" })
		expect(transition(saving, { type: "signInAbandoned" })).toBe(saving)
	})

	it("waits for the sign-in, and fails when it does", () => {
		expect(after({ type: "sending" }, { type: "signInNeeded" })).toEqual({ phase: "signingIn" })
		expect(after({ type: "signInNeeded" }, { type: "signInFailed" })).toEqual({
			phase: "failed",
			failure: { reason: "not_connected" },
		})
	})

	it("starts one save at a time", () => {
		expect(after({ type: "clicked" })).toEqual({ phase: "starting" })
		const starting = after({ type: "clicked" })
		expect(transition(starting, { type: "clicked" })).toBe(starting)
		// A click while sending enters "saving" again, a new object, so its toast shows again.
		const saving = after({ type: "clicked" }, { type: "sending" })
		const again = transition(saving, { type: "clicked" })
		expect(again).toEqual({ phase: "saving" })
		expect(again).not.toBe(saving)
		// After an outcome, or while waiting on the sign-in, a click starts a new save.
		expect(
			after({ type: "sending" }, { type: "answered", result: saved }, { type: "clicked" }),
		).toEqual({
			phase: "starting",
		})
		expect(after({ type: "signInNeeded" }, { type: "clicked" })).toEqual({ phase: "starting" })
	})
})
