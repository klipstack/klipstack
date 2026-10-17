import { describe, expect, it, vi } from "vitest"
import { createConsentGate } from "./ai-consent"

describe("the consent gate", () => {
	it("asks first, and sends only after Continue, once the sheet is gone", () => {
		const ask = vi.fn()
		const gate = createConsentGate(ask)
		const send = vi.fn()
		gate.request(false, send)
		expect([ask.mock.calls.length, send.mock.calls.length]).toEqual([1, 0])
		gate.given()
		expect(send).not.toHaveBeenCalled()
		gate.dismissed()
		expect(send).toHaveBeenCalledTimes(1)
		gate.dismissed()
		expect(send).toHaveBeenCalledTimes(1)
	})

	it("sends nothing when the sheet closes without consent, even after an earlier one", () => {
		const gate = createConsentGate(() => {})
		const first = vi.fn()
		gate.request(false, first)
		gate.dismissed()
		expect(first).not.toHaveBeenCalled()

		// Given once, then asked again (taken back in Account): the old Continue does not count.
		gate.request(false, () => {})
		gate.given()
		gate.dismissed()
		const later = vi.fn()
		gate.request(false, later)
		gate.dismissed()
		expect(later).not.toHaveBeenCalled()
	})

	it("sends at once, without asking, once the account agreed", () => {
		const ask = vi.fn()
		const send = vi.fn()
		createConsentGate(ask).request(true, send)
		expect([ask.mock.calls.length, send.mock.calls.length]).toEqual([0, 1])
	})
})
