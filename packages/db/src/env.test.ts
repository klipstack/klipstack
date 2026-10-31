import { describe, expect, it } from "vitest"
import { dbTimeouts, poolMax, sessionOptions } from "./env"

describe("poolMax", () => {
	it("defaults to 10 and reads a whole number", () => {
		expect(poolMax({})).toBe(10)
		expect(poolMax({ PG_POOL_MAX: "" })).toBe(10)
		expect(poolMax({ PG_POOL_MAX: "25" })).toBe(25)
	})
	it("refuses anything else", () => {
		for (const value of ["0", "-1", "2.5", "many", "1e3x"])
			expect(() => poolMax({ PG_POOL_MAX: value })).toThrow("PG_POOL_MAX")
	})
})

describe("dbTimeouts", () => {
	it("has defaults per process: the worker's statements may run longer", () => {
		expect(dbTimeouts("web", {})).toEqual({
			connectMs: 10_000,
			statementMs: 15_000,
			lockMs: 5_000,
			idleInTransactionMs: 30_000,
		})
		expect(dbTimeouts("worker", {})).toEqual({
			connectMs: 10_000,
			statementMs: 300_000,
			lockMs: 5_000,
			idleInTransactionMs: 30_000,
		})
	})
	it("reads each setting, 0 (no limit) included, and the worker's own statement limit", () => {
		const env = {
			PG_CONNECT_TIMEOUT_MS: "2000",
			PG_STATEMENT_TIMEOUT_MS: "0",
			PG_WORKER_STATEMENT_TIMEOUT_MS: "600000",
			PG_LOCK_TIMEOUT_MS: "1000",
			PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: "",
		}
		expect(dbTimeouts("web", env)).toEqual({
			connectMs: 2000,
			statementMs: 0,
			lockMs: 1000,
			idleInTransactionMs: 30_000,
		})
		expect(dbTimeouts("worker", env)).toEqual({
			connectMs: 2000,
			statementMs: 600_000,
			lockMs: 1000,
			idleInTransactionMs: 30_000,
		})
	})
	it("refuses anything but a whole number of milliseconds", () => {
		for (const name of [
			"PG_CONNECT_TIMEOUT_MS",
			"PG_STATEMENT_TIMEOUT_MS",
			"PG_WORKER_STATEMENT_TIMEOUT_MS",
			"PG_LOCK_TIMEOUT_MS",
			"PG_IDLE_IN_TRANSACTION_TIMEOUT_MS",
		])
			for (const value of ["-1", "2.5", "15s", "1e3x"])
				expect(() => {
					dbTimeouts("web", { [name]: value })
					dbTimeouts("worker", { [name]: value })
				}).toThrow(name)
	})
})

describe("sessionOptions", () => {
	it("sets the server-side limits on each connection, and leaves out the ones not given", () => {
		expect(
			sessionOptions({ statementMs: 15_000, lockMs: 5_000, idleInTransactionMs: 30_000 }),
		).toBe(
			"-c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000",
		)
		expect(sessionOptions({ idleInTransactionMs: 30_000 })).toBe(
			"-c idle_in_transaction_session_timeout=30000",
		)
	})
})
