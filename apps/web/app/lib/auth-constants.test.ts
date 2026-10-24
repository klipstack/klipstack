import { describe, expect, it } from "vitest"
import { OPTIONAL_SCOPES, optionalScopesFor } from "./auth-constants"

describe("optionalScopesFor", () => {
	it("gives the mobile app no optional scopes", () => {
		expect(optionalScopesFor("klipstack-mobile")).toEqual([])
		expect(optionalScopesFor("klipstack-extension")).toEqual([])
		expect(optionalScopesFor("klipstack-cli")).toBe(OPTIONAL_SCOPES)
		expect(optionalScopesFor(null)).toBe(OPTIONAL_SCOPES)
	})
})
