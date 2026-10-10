import { ExtractError } from "@klipstack/extract"
import { describe, expect, it, vi } from "vitest"
import { log } from "./log"

describe("worker log", () => {
	it("adds frames for unexpected errors, not for expected extraction failures", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
		log.warn("extract: failed", { documentId: "d1", error: new TypeError("secret") })
		log.warn("images: skip", new ExtractError("http_error", "HTTP 404 for https://x.test/secret"))
		const calls = spy.mock.calls
		spy.mockRestore()
		expect(JSON.stringify(calls)).not.toContain("secret")
		expect(calls[0]?.slice(0, 2)).toEqual([
			"[worker] extract: failed",
			{ documentId: "d1", error: "TypeError" },
		])
		expect(calls[0]?.[2]).toMatch(/^\nTypeError\n {4}at /)
		expect(calls[1]).toEqual(["[worker] images: skip", { error: "ExtractError code=http_error" }])
	})
})
