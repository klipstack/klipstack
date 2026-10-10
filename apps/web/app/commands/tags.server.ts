import { Id, TAG_NAME_REFUSED, TagName } from "@klipstack/api-contract"
import { cleanTagName } from "@klipstack/api-contract/names"
import { and, db, documentTags, eq, ne, sql, tags } from "@klipstack/db"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import {
	rewriteSavedSearchTags,
	type SavedSearchRow,
	savedSearchesNamingTag,
} from "~/services/saved-searches.server"
import { findOrCreate, findTagByName, getTag, type TagRow } from "~/services/tags.server"

/**
 * The user's tags themselves, for the web, the API and MCP alike. Tags go on articles through
 * `updateArticles`, which makes the ones it needs.
 */

const NO_TAG = "No tag with that id."

const name = (raw: string) => {
	const clean = cleanTagName(parseInput(TagName, raw))
	if (!clean) throw new AppError("invalid_request", TAG_NAME_REFUSED)
	return clean
}

/**
 * Makes a tag with no articles yet: for the API and MCP, where an assistant may set a vocabulary up
 * first. A name the user has already (whatever its case) answers with that tag, `created: false`.
 */
export async function createTag(
	userId: string,
	rawName: string,
): Promise<{ tag: TagRow; created: boolean }> {
	const clean = name(rawName)
	const existing = await findTagByName(userId, clean)
	if (existing) return { tag: existing, created: false }
	await db.transaction((tx) => findOrCreate(tx, userId, [clean]))
	const tag = await findTagByName(userId, clean)
	if (!tag) throw new Error("tag not found after creating it")
	return { tag, created: true }
}

/**
 * Renames a tag. A name another tag has already merges the two: that tag gets the articles and
 * this one goes (`merged`; `tag` is the one that stays). The user's saved searches follow the tag
 * (`tag:old` becomes `tag:new`).
 */
export async function renameTag(
	userId: string,
	id: string,
	rawName: string,
): Promise<{ tag: TagRow; merged: boolean }> {
	const tagId = parseInput(Id, id)
	const clean = name(rawName)
	const renamed = await db.transaction(async (tx) => {
		const [tag] = await tx
			.select({ id: tags.id, name: tags.name })
			.from(tags)
			.where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
			.for("update")
		if (!tag) throw notFound(NO_TAG)
		const [other] = await tx
			.select({ id: tags.id, name: tags.name })
			.from(tags)
			.where(
				and(
					eq(tags.userId, userId),
					ne(tags.id, tagId),
					sql`lower(${tags.name}) = lower(${clean})`,
				),
			)
		if (!other) {
			await tx.update(tags).set({ name: clean }).where(eq(tags.id, tagId))
			await rewriteSavedSearchTags(tx, userId, tag.name, clean)
			return { id: tagId, merged: false }
		}
		await tx.execute(
			sql`insert into ${documentTags} (document_id, tag_id) select ${documentTags.documentId}, ${other.id}::uuid from ${documentTags} where ${documentTags.tagId} = ${tagId}::uuid on conflict do nothing`,
		)
		await tx.delete(tags).where(eq(tags.id, tagId))
		await rewriteSavedSearchTags(tx, userId, tag.name, other.name)
		return { id: other.id, merged: true }
	})
	const tag = await getTag(userId, renamed.id)
	if (!tag) throw notFound(NO_TAG)
	return { tag, merged: renamed.merged }
}

/**
 * Deletes a tag; its articles stay. A tag the user's saved searches name (`tag:` or `-tag:`) is
 * refused (`tag_in_saved_searches`, with those searches) unless `force`: without it they would find
 * nothing, and nobody would know why. Forced, the saved searches stay as they are, and find nothing
 * until a tag has the name again. The deleted tag, as it was.
 */
export async function deleteTag(
	userId: string,
	id: string,
	{ force = false }: { force?: boolean } = {},
): Promise<TagRow> {
	const tagId = parseInput(Id, id)
	const tag = await getTag(userId, tagId)
	if (!tag) throw notFound(NO_TAG)
	await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ id: tags.id, name: tags.name })
			.from(tags)
			.where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
			.for("update")
		if (!locked) throw notFound(NO_TAG)
		if (!force) {
			const named: SavedSearchRow[] = await savedSearchesNamingTag(tx, userId, locked.name)
			if (named.length > 0)
				throw new AppError(
					"tag_in_saved_searches",
					"Saved searches name this tag, and would find nothing without it. Delete it with force to do it anyway.",
					{ details: { savedSearches: named } },
				)
		}
		await tx.delete(tags).where(eq(tags.id, tagId))
	})
	return tag
}
