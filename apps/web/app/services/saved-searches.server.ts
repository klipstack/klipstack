import { cleanSavedSearchName, cleanTagName, withoutNul } from "@klipstack/api-contract/names"
import {
	parseSearchQuery,
	QUERY_MAX,
	renameTagOperator,
} from "@klipstack/api-contract/search-query"
import { and, byName, db, eq, savedSearches, sql, type Tx } from "@klipstack/db"

export interface SavedSearchRow {
	id: string
	name: string
	/** The `?q=` of the search page, as typed. Parsed only when it is opened. */
	query: string
}

/** The query as stored: as typed, without the space around it. Null when it cannot be one. */
export function cleanSavedQuery(raw: string): string | null {
	const query = raw.trim()
	if (query.length === 0 || query.length > QUERY_MAX) return null
	return withoutNul(query) ? query : null
}

const columns = { id: savedSearches.id, name: savedSearches.name, query: savedSearches.query }

/** All the user's saved searches, by name. */
export async function listSavedSearches(userId: string): Promise<SavedSearchRow[]> {
	return db
		.select(columns)
		.from(savedSearches)
		.where(eq(savedSearches.userId, userId))
		.orderBy(byName(savedSearches.name), savedSearches.id)
}

/** One of the user's saved searches by name, whatever its case, as the unique index compares. */
export async function findSavedSearchByName(
	userId: string,
	rawName: string,
): Promise<SavedSearchRow | null> {
	const name = cleanSavedSearchName(rawName)
	if (!name) return null
	const [row] = await db
		.select(columns)
		.from(savedSearches)
		.where(
			and(eq(savedSearches.userId, userId), sql`lower(${savedSearches.name}) = lower(${name})`),
		)
	return row ?? null
}

/**
 * A tag was renamed, or merged into another: the user's saved queries follow it, in the caller's
 * transaction. `tag:` and `-tag:` of the old name point at the new one; a saved search's name is
 * the user's and stays. A query that would grow past the limit is left as it was.
 */
export async function rewriteSavedSearchTags(
	tx: Tx,
	userId: string,
	from: string,
	to: string,
): Promise<void> {
	const rows = await tx
		.select({ id: savedSearches.id, query: savedSearches.query })
		.from(savedSearches)
		.where(eq(savedSearches.userId, userId))
	for (const row of rows) {
		const query = renameTagOperator(row.query, from, to)
		if (query !== row.query)
			await tx.update(savedSearches).set({ query }).where(eq(savedSearches.id, row.id))
	}
}

/**
 * The tags a query names in `tag:` or `-tag:`, cleaned and lowercased: the tokens
 * `renameTagOperator` rewrites.
 */
function tagsNamedIn(query: string): Set<string> {
	const names = new Set<string>()
	for (const token of parseSearchQuery(query).tokens) {
		const name = token.key === "tag" && token.value ? cleanTagName(token.value) : null
		if (name) names.add(name.toLowerCase())
	}
	return names
}

/**
 * The user's saved searches whose query names the tag (`tag:` or `-tag:`, whatever its case), by
 * name. Without the tag they would find nothing. In the caller's transaction: `deleteTag` calls it.
 */
export async function savedSearchesNamingTag(
	tx: Tx,
	userId: string,
	tag: string,
): Promise<SavedSearchRow[]> {
	const wanted = tag.toLowerCase()
	const rows = await tx
		.select(columns)
		.from(savedSearches)
		.where(eq(savedSearches.userId, userId))
		.orderBy(byName(savedSearches.name), savedSearches.id)
	return rows.filter((row) => tagsNamedIn(row.query).has(wanted))
}

/**
 * For the tags page: the names of the saved searches that name each tag, keyed by the tag's name
 * lowercased. The searches come in the order given.
 */
export function savedSearchNamesByTag(searches: SavedSearchRow[]): Map<string, string[]> {
	const byTag = new Map<string, string[]>()
	for (const search of searches)
		for (const tag of tagsNamedIn(search.query))
			byTag.set(tag, [...(byTag.get(tag) ?? []), search.name])
	return byTag
}
