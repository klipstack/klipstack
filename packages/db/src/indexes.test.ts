import { afterAll, describe, expect, it } from "vitest"
import { pool } from "./client"

afterAll(() => pool.end())

/** The columns of single-column foreign keys that lead an index, in `table.column` form. */
async function indexedForeignKeys(): Promise<string[]> {
	const { rows } = await pool.query<{ key: string }>(`
		select c.conrelid::regclass::text || '.' || a.attname as key
		from pg_constraint c
		join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
		where c.contype = 'f' and array_length(c.conkey, 1) = 1
			and c.connamespace = 'public'::regnamespace
			and exists (
				select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
			)`)
	return rows.map((row) => row.key)
}

describe("foreign key indexes", () => {
	it("index the posts' captures: deleting an account's captures must not scan every post", async () => {
		expect(await indexedForeignKeys()).toContain("document_via.raw_id")
	})
})
