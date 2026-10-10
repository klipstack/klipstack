import { describe, expect, it } from "vitest"
import { assertLocal, assertOwned, EMAIL, loginLinkUrl, newState } from "./local"

describe("local ownership boundary", () => {
	const env = {
		DATABASE_URL: "postgres://user:password@localhost:5433/development",
		STORAGE_DRIVER: "fs",
	}
	it("accepts local storage and database without retaining credentials", () => {
		expect(assertLocal(env)).toBe("localhost:5433/development")
	})
	it.each([
		{ ...env, NODE_ENV: "production" },
		{ ...env, STORAGE_DRIVER: "s3" },
		{ ...env, DATABASE_URL: "postgres://production.example.com/app" },
		{ ...env, DATABASE_URL: `${env.DATABASE_URL}?host=production.example.com` },
	])("refuses external or production targets", (unsafe) => {
		expect(() => assertLocal(unsafe)).toThrow()
	})
	it("does not take over an account just because its email matches", () => {
		const state = newState("local", "/storage", "reader", "2026-09-22")
		expect(() => assertOwned(null, [{ id: "someone", email: EMAIL }])).toThrow()
		expect(() => assertOwned(state, [{ id: "someone", email: EMAIL }])).toThrow()
		expect(() => assertOwned(state, [{ id: state.userId, email: "changed@example.com" }])).toThrow()
		expect(() => assertOwned(state, [{ id: state.userId, email: EMAIL }])).not.toThrow()
	})
	it("links to better-auth's magic-link check on the app's own address", () => {
		const link = new URL(loginLinkUrl("https://demo.example.com/", "t0k"))
		expect(link.origin).toBe("https://demo.example.com")
		expect(link.pathname).toBe("/api/auth/magic-link/verify")
		expect(Object.fromEntries(link.searchParams)).toEqual({
			token: "t0k",
			callbackURL: "/home",
			errorCallbackURL: "/login",
		})
	})
})
