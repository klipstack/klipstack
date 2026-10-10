import { TAGS_PER_ARTICLE_MAX } from "@klipstack/api-contract/names"
import { db, documents, eq, inArray, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createSavedSearch } from "~/commands/saved-searches.server"
import { createTag, deleteTag, renameTag } from "~/commands/tags.server"
import { AppError } from "~/lib/app-error"
import { getDocument, listDocuments } from "./documents.server"
import { buildDocumentExport, buildExport } from "./export.server"
import { listSavedSearches } from "./saved-searches.server"
import { operatorValues, searchDocuments } from "./search.server"
import { changeTags, documentTagList, findTagByName, listTags } from "./tags.server"

const userId = `test-tags-${Date.now()}`
const otherId = `${userId}-other`
const ids: Record<string, string> = {}

async function addDocument(name: string, owner = userId, values = {}): Promise<string> {
	const [d] = await db
		.insert(documents)
		.values({
			userId: owner,
			sourceUrl: `https://example.com/${name}`,
			urlHash: `${owner}-${name}`,
			title: `Tagged ${name}`,
			status: "ready",
			...values,
		})
		.returning({ id: documents.id })
	return d!.id
}

const tagsByName = async (owner = userId) =>
	Object.fromEntries((await listTags(owner)).map((t) => [t.name, t.articles]))

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: userId, name: "Tags", email: `${userId}@example.com` },
		{ id: otherId, name: "Other", email: `${otherId}@example.com` },
	])
	for (const name of ["one", "two", "three"]) ids[name] = await addDocument(name)
	ids.trashed = await addDocument("trashed", userId, { deletedAt: new Date() })
	ids.foreign = await addDocument("foreign", otherId)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId]))
})

describe("changeTags", () => {
	it("creates tags by using them, once per spelling", async () => {
		await changeTags({ userId, documentIds: [ids.one!], add: ["Rust", "rust", " web  dev "] })
		expect(await documentTagList(ids.one!)).toEqual(["Rust", "web dev"])
		await changeTags({ userId, documentIds: [ids.two!], add: ["RUST"] })
		expect(await documentTagList(ids.two!)).toEqual(["Rust"])
		expect(await tagsByName()).toEqual({ Rust: 2, "web dev": 1 })
	})

	it("changes many articles at once and removes what is asked", async () => {
		await changeTags({
			userId,
			documentIds: [ids.one!, ids.two!, ids.three!],
			add: ["later"],
			remove: ["rust", "never there"],
		})
		expect(await documentTagList(ids.one!)).toEqual(["later", "web dev"])
		expect(await documentTagList(ids.two!)).toEqual(["later"])
		expect(await documentTagList(ids.three!)).toEqual(["later"])
	})

	it("keeps a tag that lost its articles", async () => {
		expect(await tagsByName()).toEqual({ later: 3, Rust: 0, "web dev": 1 })
	})

	it("refuses a bad name and changes nothing", async () => {
		await expect(
			changeTags({ userId, documentIds: [ids.one!], add: ["fine", 'not "fine"'] }),
		).rejects.toMatchObject({ code: "invalid_request" })
		expect(await documentTagList(ids.one!)).toEqual(["later", "web dev"])
	})

	it("refuses more tags than an article may have, and rolls back", async () => {
		const many = Array.from({ length: TAGS_PER_ARTICLE_MAX }, (_, i) => `bulk ${i}`)
		const error = await changeTags({ userId, documentIds: [ids.one!], add: many }).catch((e) => e)
		expect(error).toBeInstanceOf(AppError)
		expect(error).toMatchObject({
			code: "too_many_article_tags",
			details: { articleId: ids.one },
		})
		expect(await documentTagList(ids.one!)).toEqual(["later", "web dev"])
		expect(Object.keys(await tagsByName())).not.toContain("bulk 0")
	})

	it("never touches another user's articles or tags", async () => {
		await changeTags({ userId, documentIds: [ids.foreign!], add: ["later"] })
		expect(await documentTagList(ids.foreign!)).toEqual([])
		await changeTags({ userId: otherId, documentIds: [ids.foreign!], add: ["later"] })
		expect(await tagsByName(otherId)).toEqual({ later: 1 })
		expect((await tagsByName()).later).toBe(3)
	})

	it("counts leave out the trash", async () => {
		await changeTags({ userId, documentIds: [ids.trashed!], add: ["later"] })
		expect(await documentTagList(ids.trashed!)).toEqual(["later"])
		expect((await tagsByName()).later).toBe(3)
	})
})

describe("cards and articles", () => {
	it("carry their tags by name", async () => {
		await changeTags({ userId, documentIds: [ids.one!], add: ["Alpha", "zeta"] })
		const { items } = await listDocuments({ userId, view: "inbox" })
		expect(items.find((d) => d.id === ids.one)?.tags).toEqual(["Alpha", "later", "web dev", "zeta"])
		expect(items.find((d) => d.id === ids.two)?.tags).toEqual(["later"])
		// No row per tag: a join would list the article four times.
		expect(items.filter((d) => d.id === ids.one)).toHaveLength(1)
		expect((await getDocument(userId, ids.one!))?.tags).toEqual([
			"Alpha",
			"later",
			"web dev",
			"zeta",
		])
		const found = await searchDocuments({ userId, q: "Tagged one" })
		expect(found.items[0]?.tags).toEqual(["Alpha", "later", "web dev", "zeta"])
	})

	it("the export lists every tag, and each article's", async () => {
		const bundle = await buildExport(userId)
		// "Rust" is on no article any more; the trashed article is not exported, its tag is.
		expect(bundle.tags).toEqual(["Alpha", "later", "Rust", "web dev", "zeta"])
		const byTitle = Object.fromEntries(bundle.documents.map((d) => [d.title, d.tags]))
		expect(byTitle).toEqual({
			"Tagged one": ["Alpha", "later", "web dev", "zeta"],
			"Tagged two": ["later"],
			"Tagged three": ["later"],
		})
		expect((await buildDocumentExport(userId, ids.two!))?.tags).toEqual(["later"])
	})

	it("an article with no tags has an empty list", async () => {
		const id = await addDocument("bare")
		expect((await getDocument(userId, id))?.tags).toEqual([])
		const { items } = await listDocuments({ userId, view: "inbox" })
		expect(items.find((d) => d.id === id)?.tags).toEqual([])
	})
})

describe("search", () => {
	const found = async (q: string) =>
		(await searchDocuments({ userId, q: `${q} sort:oldest` })).items.map((d) =>
			d.title?.replace("Tagged ", ""),
		)

	it("finds the articles of a tag by its whole name, whatever the case", async () => {
		expect(await found("tag:later")).toEqual(["one", "two", "three"])
		expect(await found("tag:LATER")).toEqual(["one", "two", "three"])
		expect(await found('tag:"web dev"')).toEqual(["one"])
		// A part of a name is not the name.
		expect(await found("tag:web")).toEqual([])
		expect(await found("tag:late")).toEqual([])
	})

	it("repeats narrow, a dash leaves out, and words still count", async () => {
		expect(await found("tag:later tag:alpha")).toEqual(["one"])
		expect(await found("tag:later -tag:alpha")).toEqual(["two", "three"])
		expect(await found("tagged tag:later -tag:zeta two")).toEqual(["two"])
	})

	it("looks in the trash only when asked", async () => {
		expect(await found("tag:later in:trash")).toEqual(["trashed"])
		const result = await searchDocuments({ userId, q: "tag:later" })
		expect(result.trash?.items.map((d) => d.title)).toEqual(["Tagged trashed"])
	})

	it("tells the tagged from the rest", async () => {
		expect(await found("has:tags")).toEqual(["one", "two", "three"])
		expect(await found("-has:tags")).toEqual(["bare"])
	})

	it("offers the tags that hold what is typed, most articles first, the unused last", async () => {
		const values = (q = "") => operatorValues({ userId, key: "tag", q })
		expect(await values()).toEqual(["later", "Alpha", "web dev", "zeta", "Rust"])
		expect(await values("E")).toEqual(["later", "web dev", "zeta"])
		expect(await values("%")).toEqual([])
		expect(await operatorValues({ userId: otherId, key: "tag", q: "" })).toEqual(["later"])
	})
})

describe("createTag and findTagByName", () => {
	it("makes a tag with no articles, once, and finds it whatever the case", async () => {
		expect(await createTag(otherId, "  Reading   List ")).toMatchObject({
			created: true,
			tag: { name: "Reading List", articles: 0 },
		})
		const again = await createTag(otherId, "reading list")
		expect(again).toMatchObject({ created: false, tag: { name: "Reading List" } })
		expect(await findTagByName(otherId, "READING LIST")).toMatchObject({ id: again.tag.id })
		// Not the first user's, and not a name at all.
		expect(await findTagByName(userId, "Reading List")).toBeNull()
		expect(await findTagByName(otherId, "a,b")).toBeNull()
		await expect(createTag(otherId, 'no "quotes"')).rejects.toMatchObject({
			code: "invalid_request",
		})
		expect(await findTagByName(otherId, "later")).toMatchObject({ articles: 1 })
	})
})

describe("renameTag", () => {
	const idOf = async (name: string) => (await listTags(userId)).find((t) => t.name === name)!.id

	it("renames, and a change of case is a rename", async () => {
		expect(await renameTag(userId, await idOf("zeta"), "Zeta")).toMatchObject({
			tag: { name: "Zeta" },
			merged: false,
		})
		expect(await renameTag(userId, await idOf("Zeta"), "omega")).toMatchObject({ merged: false })
		expect(await documentTagList(ids.one!)).toEqual(["Alpha", "later", "omega", "web dev"])
	})

	it("merges into a tag that has the name already", async () => {
		// "one" has both; "two" has only "later".
		const result = await renameTag(userId, await idOf("later"), "OMEGA")
		expect(result).toMatchObject({ tag: { name: "omega" }, merged: true })
		expect(await documentTagList(ids.one!)).toEqual(["Alpha", "omega", "web dev"])
		expect(await documentTagList(ids.two!)).toEqual(["omega"])
		expect(Object.keys(await tagsByName())).not.toContain("later")
	})

	it("refuses a bad name, and knows only the user's tags", async () => {
		await expect(renameTag(userId, await idOf("omega"), " ")).rejects.toMatchObject({
			code: "invalid_request",
		})
		await expect(renameTag(otherId, await idOf("omega"), "stolen")).rejects.toMatchObject({
			code: "not_found",
		})
	})
})

describe("deleteTag", () => {
	it("deletes the tag and leaves the articles", async () => {
		const tag = (await listTags(userId)).find((t) => t.name === "omega")!
		await expect(deleteTag(otherId, tag.id)).rejects.toMatchObject({ code: "not_found" })
		expect(await deleteTag(userId, tag.id)).toMatchObject({ id: tag.id, name: "omega" })
		await expect(deleteTag(userId, tag.id)).rejects.toMatchObject({ code: "not_found" })
		expect(await documentTagList(ids.two!)).toEqual([])
		const [doc] = await db.select().from(documents).where(eq(documents.id, ids.two!))
		expect(doc?.deletedAt).toBeNull()
	})

	const savedQueries = async () =>
		Object.fromEntries((await listSavedSearches(userId)).map((s) => [s.name, s.query]))

	it("refuses a tag saved searches name, negated or in another case, and lists them", async () => {
		const { tag } = await createTag(userId, "Weekly Essays")
		const pinned = await createSavedSearch(userId, { name: "Pinned", query: 'tag:"weekly essays"' })
		const without = await createSavedSearch(userId, {
			name: "Without",
			query: 'is:unread -TAG:"Weekly   Essays"',
		})
		// Words, another tag, and a title that looks like the operator: none of them name it.
		await createSavedSearch(userId, {
			name: "Lookalikes",
			query: 'weekly essays tag:weekly title:"tag:weekly essays"',
		})
		// Another user's saved searches are theirs.
		await createSavedSearch(otherId, { name: "Theirs", query: 'tag:"weekly essays"' })
		await expect(deleteTag(userId, tag.id)).rejects.toMatchObject({
			code: "tag_in_saved_searches",
			details: { savedSearches: [pinned, without] },
		})
		expect(await findTagByName(userId, "weekly essays")).toMatchObject({ id: tag.id })
	})

	it("deletes a tag no saved search names, though some name others", async () => {
		const { tag } = await createTag(userId, "Essays")
		expect(await deleteTag(userId, tag.id)).toMatchObject({ id: tag.id })
	})

	it("deletes it anyway when forced, and leaves the saved searches as they are", async () => {
		const before = await savedQueries()
		const tag = (await findTagByName(userId, "Weekly Essays"))!
		expect(await deleteTag(userId, tag.id, { force: true })).toMatchObject({ id: tag.id })
		expect(await findTagByName(userId, "Weekly Essays")).toBeNull()
		expect(await savedQueries()).toEqual(before)
		expect(before).toMatchObject({ Without: 'is:unread -TAG:"Weekly   Essays"' })
	})
})

describe("order", () => {
	it("sorts names as people read them: case aside, an accent beside its letter", async () => {
		// By code point (the database's own collation) "Árbol" would come after "zeta".
		const owner = `${userId}-order`
		await db.insert(userTable).values({ id: owner, name: "Order", email: `${owner}@example.com` })
		try {
			const id = await addDocument("order", owner)
			await changeTags({
				userId: owner,
				documentIds: [id],
				add: ["zeta", "Árbol", "apple", "Banana"],
			})
			const expected = ["apple", "Árbol", "Banana", "zeta"]
			expect((await listTags(owner)).map((t) => t.name)).toEqual(expected)
			expect(await documentTagList(id)).toEqual(expected)
			expect((await getDocument(owner, id))?.tags).toEqual(expected)
			expect((await buildExport(owner)).tags).toEqual(expected)
		} finally {
			await db.delete(userTable).where(eq(userTable.id, owner))
		}
	})
})
