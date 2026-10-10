import { resources } from "@klipstack/i18n"
import { describe, expect, it } from "vitest"
import { isKeyOf, isNsKey } from "./i18n-keys"

describe("isNsKey", () => {
	it("accepts a key with its namespace", () => {
		expect(isNsKey("auth:login.invalid")).toBe(true)
		expect(isNsKey("common:nav.settings")).toBe(true)
	})
	it("refuses plain text, a missing key, a group and an unknown namespace", () => {
		for (const value of [
			"Invalid email",
			"auth:login.nope",
			"auth:login",
			"nope:login.invalid",
			"auth:",
			"auth:constructor",
		])
			expect(isNsKey(value)).toBe(false)
	})
})

describe("isKeyOf", () => {
	it("is true for a map's own keys only", () => {
		const { actions } = resources.en.admin.audit
		expect(isKeyOf(actions, Object.keys(actions)[0]!)).toBe(true)
		expect(isKeyOf(actions, "toString")).toBe(false)
		expect(isKeyOf(actions, "no.such.action")).toBe(false)
	})
})
