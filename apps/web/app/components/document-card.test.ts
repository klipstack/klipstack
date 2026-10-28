import { FAILURE_CODES } from "@klipstack/api-contract"
import { describe, expect, it } from "vitest"
import { failureKey } from "./document-card"

describe("failureKey", () => {
	it.each(FAILURE_CODES)("gives %s its own message", (code) => {
		expect(failureKey(code)).toBe(`failure.${code}`)
	})

	it("reads the code of a reason with the site's status", () => {
		expect(failureKey("http_error:403")).toBe("failure.http_error")
	})

	it("falls back to unknown for a code it doesn't know", () => {
		expect(failureKey("from_the_future")).toBe("failure.unknown")
		expect(failureKey(null)).toBe("failure.unknown")
	})
})
