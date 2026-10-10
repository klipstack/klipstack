import { TAG_NAME_REFUSED } from "@klipstack/api-contract"
import {
	cleanTagName,
	TAGS_PER_ARTICLE_MAX,
	TAGS_PER_USER_MAX,
} from "@klipstack/api-contract/names"
import {
	and,
	byName,
	db,
	documents,
	documentTags,
	eq,
	inArray,
	sql,
	type Tx,
	tags,
} from "@klipstack/db"
import { AppError } from "~/lib/app-error"

export interface TagRow {
	id: string
	name: string
	/** Articles with the tag, the trash left out. */
	articles: number
}

/**
 * Articles with the tag, the trash left out. By hand: Drizzle writes the columns of a `sql` field
 * without their table in a select with no join.
 */
export const tagArticleCount = sql<number>`(select count(*)::int from document_tags dt inner join documents d on d.id = dt.document_id where dt.tag_id = "tags"."id" and d.deleted_at is null)`

/** All the user's tags, by name. A tag outlives its articles: some have none. */
export async function listTags(userId: string): Promise<TagRow[]> {
	return db
		.select({ id: tags.id, name: tags.name, articles: tagArticleCount })
		.from(tags)
		.where(eq(tags.userId, userId))
		.orderBy(byName(tags.name), tags.id)
}

/** The user's tag with that id, with its article count. */
export async function getTag(userId: string, id: string): Promise<TagRow | null> {
	const [tag] = await db
		.select({ id: tags.id, name: tags.name, articles: tagArticleCount })
		.from(tags)
		.where(and(eq(tags.userId, userId), eq(tags.id, id)))
	return tag ?? null
}

/** The user's tag with that name, whatever its case; null when there is none, or no tag could have it. */
export async function findTagByName(userId: string, rawName: string): Promise<TagRow | null> {
	const name = cleanTagName(rawName)
	if (!name) return null
	const [tag] = await db
		.select({ id: tags.id, name: tags.name, articles: tagArticleCount })
		.from(tags)
		.where(and(eq(tags.userId, userId), sql`lower(${tags.name}) = lower(${name})`))
	return tag ?? null
}

/** Every name cleaned, one per spelling; refuses one that cannot be a name. */
function cleanNames(names: string[]): string[] {
	const byKey = new Map<string, string>()
	for (const raw of names) {
		const name = cleanTagName(raw)
		if (!name) throw new AppError("invalid_request", TAG_NAME_REFUSED)
		if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name)
	}
	return [...byKey.values()]
}

/** Postgres lowers both sides: its rules and JavaScript's differ for a few letters. */
const lowerNameIn = (names: string[]) =>
	sql`lower(${tags.name}) in (${sql.join(
		names.map((n) => sql`lower(${n})`),
		sql`, `,
	)})`

/** The ids of the tags with these names, creating the missing ones; `created` has those. */
export async function findOrCreate(
	tx: Tx,
	userId: string,
	names: string[],
): Promise<{ ids: string[]; created: string[] }> {
	if (names.length === 0) return { ids: [], created: [] }
	let created: string[] = []
	const find = () =>
		tx
			.select({ id: tags.id, name: tags.name })
			.from(tags)
			.where(and(eq(tags.userId, userId), lowerNameIn(names)))
	const existing = new Set((await find()).map((t) => t.name.toLowerCase()))
	const missing = names.filter((n) => !existing.has(n.toLowerCase()))
	if (missing.length > 0) {
		const [row] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(tags)
			.where(eq(tags.userId, userId))
		if ((row?.n ?? 0) + missing.length > TAGS_PER_USER_MAX)
			throw new AppError(
				"too_many_tags",
				`A library holds up to ${TAGS_PER_USER_MAX} tags. Nothing was changed.`,
			)
		// Another tab may have made the same tag a moment ago: the unique index settles it.
		const rows = await tx
			.insert(tags)
			.values(missing.map((name) => ({ userId, name })))
			.onConflictDoNothing()
			.returning({ id: tags.id })
		created = rows.map((r) => r.id)
	}
	return { ids: (await find()).map((t) => t.id), created }
}

/** What `changeTagsIn` did: (article, tag) pairs it added and took off, and the tags it created. */
export interface TagChanges {
	added: Array<{ documentId: string; tagId: string }>
	removed: Array<{ documentId: string; tagId: string }>
	created: string[]
}

/**
 * Adds and removes tags on articles of the user, in the caller's transaction (the caller has
 * checked the ids). Names match whatever their case; the missing ones are created. Removing a tag
 * that is not there is not an error. A refusal (`AppError`) rolls the transaction back.
 */
export async function changeTagsIn(
	tx: Tx,
	{
		userId,
		documentIds,
		add = [],
		remove = [],
	}: {
		userId: string
		documentIds: string[]
		add?: string[]
		remove?: string[]
	},
): Promise<TagChanges> {
	const adding = cleanNames(add)
	const removing = cleanNames(remove)
	const changes: TagChanges = { added: [], removed: [], created: [] }
	if (documentIds.length === 0 || (adding.length === 0 && removing.length === 0)) return changes
	const owned = await tx
		.select({ id: documents.id })
		.from(documents)
		.where(and(eq(documents.userId, userId), inArray(documents.id, documentIds)))
	const ids = owned.map((d) => d.id)
	if (ids.length === 0) return changes
	if (removing.length > 0) {
		const gone = await tx
			.select({ id: tags.id })
			.from(tags)
			.where(and(eq(tags.userId, userId), lowerNameIn(removing)))
		if (gone.length > 0)
			changes.removed = await tx
				.delete(documentTags)
				.where(
					and(
						inArray(documentTags.documentId, ids),
						inArray(
							documentTags.tagId,
							gone.map((t) => t.id),
						),
					),
				)
				.returning({ documentId: documentTags.documentId, tagId: documentTags.tagId })
	}
	if (adding.length > 0) {
		const { ids: tagIds, created } = await findOrCreate(tx, userId, adding)
		changes.created = created
		changes.added = await tx
			.insert(documentTags)
			.values(ids.flatMap((documentId) => tagIds.map((tagId) => ({ documentId, tagId }))))
			.onConflictDoNothing()
			.returning({ documentId: documentTags.documentId, tagId: documentTags.tagId })
		const counts = await tx
			.select({ documentId: documentTags.documentId, n: sql<number>`count(*)::int` })
			.from(documentTags)
			.where(inArray(documentTags.documentId, ids))
			.groupBy(documentTags.documentId)
		const over = counts.find((c) => c.n > TAGS_PER_ARTICLE_MAX)
		if (over)
			throw new AppError(
				"too_many_article_tags",
				`Article ${over.documentId} would have more than ${TAGS_PER_ARTICLE_MAX} tags. Nothing was changed.`,
				{ details: { articleId: over.documentId } },
			)
	}
	await tx.update(documents).set({ updatedAt: new Date() }).where(inArray(documents.id, ids))
	return changes
}

/** `changeTagsIn` in a transaction of its own, for the demo account and tests. */
export const changeTags = (input: Parameters<typeof changeTagsIn>[1]) =>
	db.transaction((tx) => changeTagsIn(tx, input))

/** The tags of an article, as names by name. */
export async function documentTagList(documentId: string): Promise<string[]> {
	const rows = await db
		.select({ name: tags.name })
		.from(documentTags)
		.innerJoin(tags, eq(tags.id, documentTags.tagId))
		.where(eq(documentTags.documentId, documentId))
		.orderBy(byName(tags.name))
	return rows.map((r) => r.name)
}

/** For `has:tags` and `tag:` in the search: the article has a tag (with that name). */
export function articleHasTag(name?: string) {
	return sql`exists (select 1 from ${documentTags} inner join ${tags} on ${tags.id} = ${documentTags.tagId} where ${documentTags.documentId} = ${documents.id}${name === undefined ? sql`` : sql` and lower(${tags.name}) = lower(${name})`})`
}
