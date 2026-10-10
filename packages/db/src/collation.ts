import { type SQL, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import type pg from "pg"

/**
 * Names in the order people expect: case aside, an accented letter beside its plain one ("Árbol"
 * after "apple", not after "zeta" as by code point). For ORDER BY only, never for an index: ICU
 * collations change with ICU versions too.
 */
export const byName = (value: SQL | AnyPgColumn): SQL => sql`${value} collate "und-x-icu"`

/**
 * What in the current database sorts text with a collation an OS or ICU update can change. A btree
 * index built under one version of such a collation is out of order under the next, and a unique
 * index can then hold duplicates (see docs/self-hosting/postgres-collation.md). Empty when the
 * database uses the builtin provider (or libc's byte order, C) and no index names a collation of
 * its own. Sorting a query with an ICU collation is fine: only indexes keep the old order.
 */
export async function collationProblems(client: pg.Pool | pg.PoolClient): Promise<string[]> {
	const problems: string[] = []
	const { rows: databases } = await client.query<{
		name: string
		provider: string
		collate: string
	}>(
		`select datname as name, datlocprovider as provider, datcollate as collate
		from pg_database where datname = current_database()`,
	)
	for (const db of databases) {
		const stable =
			db.provider === "b" || (db.provider === "c" && ["C", "POSIX"].includes(db.collate))
		if (!stable) {
			const provider = db.provider === "i" ? "ICU" : "libc"
			problems.push(`database ${db.name} sorts with the ${provider} collation ${db.collate}`)
		}
	}
	const { rows: indexes } = await client.query<{ index: string; collation: string }>(
		`select distinct i.indexrelid::regclass::text as index, c.collname as collation
		from pg_index i
		cross join unnest(i.indcollation::oid[]) as k(oid)
		join pg_collation c on c.oid = k.oid
		join pg_class r on r.oid = i.indexrelid
		join pg_namespace n on n.oid = r.relnamespace
		where c.collprovider in ('c', 'i') and c.collname not in ('C', 'POSIX')
			and n.nspname not in ('pg_catalog', 'information_schema')
		order by 1, 2`,
	)
	for (const { index, collation } of indexes) {
		problems.push(`index ${index} sorts with the collation ${collation}`)
	}
	return problems
}
