import { and, type SQL, sql } from "@klipstack/db"
import type { AnyPgColumn } from "drizzle-orm/pg-core"

export interface ModificationRange {
	updatedSince?: string
	updatedBefore?: string
}

/** Keep timestamp strings intact: converting to Date would lose PostgreSQL microseconds. */
export function modificationRange(column: AnyPgColumn, range: ModificationRange): SQL | undefined {
	return and(
		range.updatedSince ? sql`${column} >= ${range.updatedSince}::timestamptz` : undefined,
		range.updatedBefore ? sql`${column} < ${range.updatedBefore}::timestamptz` : undefined,
	)
}
