import { describe, expect, it } from "vitest"
import { isOlder, parseClient, parseVersion } from "./client"

describe("parseClient", () => {
	it("reads the platform and version", () => {
		expect(parseClient("ios/1.4.0")).toEqual({ platform: "ios", version: [1, 4, 0] })
		expect(parseClient(" android/0.10.2 ")).toEqual({ platform: "android", version: [0, 10, 2] })
	})

	it("refuses anything else", () => {
		for (const header of [
			null,
			undefined,
			"",
			"ios",
			"ios/1.4",
			"ios/1.4.0-beta",
			"web/1.0.0",
			"IOS/1.0.0",
		]) {
			expect(parseClient(header)).toBeNull()
		}
	})
})

describe("isOlder", () => {
	it("compares each part as a number", () => {
		expect(isOlder([1, 9, 0], [1, 10, 0])).toBe(true)
		expect(isOlder([1, 10, 0], [1, 9, 9])).toBe(false)
		expect(isOlder([2, 0, 0], [2, 0, 0])).toBe(false)
		expect(isOlder([0, 1, 0], [0, 1, 1])).toBe(true)
	})
})

describe("parseVersion", () => {
	it("reads a bare version", () => {
		expect(parseVersion("0.1.0")).toEqual([0, 1, 0])
		expect(parseVersion("latest")).toBeNull()
	})
})
