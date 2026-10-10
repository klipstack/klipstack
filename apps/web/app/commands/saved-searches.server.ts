import { Id, SavedSearchName, SavedSearchQuery } from "@klipstack/api-contract"
import { cleanSavedSearchName, SAVED_SEARCHES_PER_USER_MAX } from "@klipstack/api-contract/names"
import { and, db, eq, ne, savedSearches, sql } from "@klipstack/db"
import { z } from "zod"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { isUniqueViolation } from "~/lib/postgres-errors.server"
import { cleanSavedQuery, type SavedSearchRow } from "~/services/saved-searches.server"

/** The user's saved searches, for the web and the API. */

const NO_SAVED_SEARCH = "No saved search with that id."
const columns = { id: savedSearches.id, name: savedSearches.name, query: savedSearches.query }

const nameTaken = () =>
	new AppError("name_taken", "Another saved search has that name already, whatever its case.")

const cleanName = (raw: string) => cleanSavedSearchName(parseInput(SavedSearchName, raw))!

const NewSavedSearch = z.object({ name: SavedSearchName, query: SavedSearchQuery })

/** Saves a query under a name. The same query may be saved twice; a name only once. */
export async function createSavedSearch(
	userId: string,
	input: { name: string; query: string },
): Promise<SavedSearchRow> {
	const { name, query } = parseInput(NewSavedSearch, input)
	const clean = cleanSavedSearchName(name)!
	const stored = cleanSavedQuery(query)!
	try {
		return await db.transaction(async (tx) => {
			const existing = await tx
				.select({ name: savedSearches.name })
				.from(savedSearches)
				.where(eq(savedSearches.userId, userId))
			// The name first: at the limit, "rename it" helps more than "delete one".
			if (existing.some((s) => s.name.toLowerCase() === clean.toLowerCase())) throw nameTaken()
			if (existing.length >= SAVED_SEARCHES_PER_USER_MAX)
				throw new AppError(
					"too_many_saved_searches",
					`An account holds up to ${SAVED_SEARCHES_PER_USER_MAX} saved searches.`,
				)
			const [row] = await tx
				.insert(savedSearches)
				.values({ userId, name: clean, query: stored })
				.returning(columns)
			return row!
		})
	} catch (error) {
		// Another tab took the name a moment ago, or Postgres lowers it by other rules than
		// JavaScript: the index has the last word.
		if (isUniqueViolation(error)) throw nameTaken()
		throw error
	}
}

/** Renames a saved search; its query stays. */
export async function renameSavedSearch(
	userId: string,
	id: string,
	rawName: string,
): Promise<SavedSearchRow> {
	const searchId = parseInput(Id, id)
	const name = cleanName(rawName)
	try {
		return await db.transaction(async (tx) => {
			const [taken] = await tx
				.select({ id: savedSearches.id })
				.from(savedSearches)
				.where(
					and(
						eq(savedSearches.userId, userId),
						ne(savedSearches.id, searchId),
						sql`lower(${savedSearches.name}) = lower(${name})`,
					),
				)
			if (taken) throw nameTaken()
			const [row] = await tx
				.update(savedSearches)
				.set({ name })
				.where(and(eq(savedSearches.id, searchId), eq(savedSearches.userId, userId)))
				.returning(columns)
			if (!row) throw notFound(NO_SAVED_SEARCH)
			return row
		})
	} catch (error) {
		if (isUniqueViolation(error)) throw nameTaken()
		throw error
	}
}

export async function deleteSavedSearch(userId: string, id: string): Promise<void> {
	const gone = await db
		.delete(savedSearches)
		.where(and(eq(savedSearches.id, parseInput(Id, id)), eq(savedSearches.userId, userId)))
		.returning({ id: savedSearches.id })
	if (gone.length === 0) throw notFound(NO_SAVED_SEARCH)
}
