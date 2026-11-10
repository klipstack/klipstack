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

	it("waits for the sign-in, and fails when it does", () => {
		expect(after({ type: "sending" }, { type: "signInNeeded" })).toEqual({ phase: "signingIn" })
		expect(after({ type: "signInNeeded" }, { type: "signInFailed" })).toEqual({
			phase: "failed",
			failure: { reason: "not_connected" },
		})
	})
})
