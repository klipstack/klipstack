import { afterAll, describe, expect, it } from "vitest"
import { pool } from "./client"
import { collationProblems } from "./collation"

afterAll(() => pool.end())

describe("collationProblems", () => {
	it("names an index that sorts with an ICU or libc collation", async () => {
		const client = await pool.connect()
		try {
			await client.query("begin")
			await client.query(`create temp table collation_probe (name text collate "und-x-icu")`)
			await client.query("create index collation_probe_name on collation_probe (name)")
			const problems = await collationProblems(client)
			expect(problems).toContain("index collation_probe_name sorts with the collation und-x-icu")
		} finally {
			await client.query("rollback")
			client.release()
		}
	})

	it("leaves out an index in byte order", async () => {
		const client = await pool.connect()
		try {
			await client.query("begin")
			await client.query(`create temp table collation_probe (name text collate "C")`)
			await client.query("create index collation_probe_name on collation_probe (name)")
			const problems = await collationProblems(client)
			expect(problems.filter((p) => p.includes("collation_probe"))).toEqual([])
		} finally {
			await client.query("rollback")
			client.release()
		}
	})
})
