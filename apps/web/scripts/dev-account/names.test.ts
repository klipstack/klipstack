import { describe, expect, it } from "vitest"
import { isThrowaway, newAccount } from "./names"

describe("throwaway accounts", () => {
	it("are recognized only by both their id and their address", () => {
		const account = newAccount("phone")
		expect(account.email).toBe("phone@throwaway.klipstack.test")
		expect(isThrowaway(account)).toBe(true)
		expect(isThrowaway({ ...account, email: "reader@demo.klipstack.test" })).toBe(false)
		expect(isThrowaway({ ...account, id: "demo-reader-1" })).toBe(false)
		expect(isThrowaway({ id: account.id, email: "x@throwaway.klipstack.test.example.com" })).toBe(
			false,
		)
	})
	it("refuses a name that would change the address", () => {
		expect(() => newAccount("me@example.com")).toThrow()
		expect(() => newAccount("Phone")).toThrow()
	})
})
