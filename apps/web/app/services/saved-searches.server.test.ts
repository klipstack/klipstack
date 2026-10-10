import { SAVED_SEARCHES_PER_USER_MAX } from "@klipstack/api-contract/names"
import { QUERY_MAX } from "@klipstack/api-contract/search-query"
import { db, inArray, user as userTable } from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	createSavedSearch,
	deleteSavedSearch,
	renameSavedSearch,
} from "~/commands/saved-searches.server"
import { createTag, renameTag } from "~/commands/tags.server"
import { buildExport } from "./export.server"
import { listSavedSearches, savedSearchNamesByTag } from "./saved-searches.server"

const userId = `test-saved-searches-${Date.now()}`
const otherId = `${userId}-other`
const fullId = `${userId}-full`

const byName = async (owner = userId) =>
	Object.fromEntries((await listSavedSearches(owner)).map((s) => [s.name, s.query]))

beforeAll(async () => {
	await db
		.insert(userTable)
		.values(
			[userId, otherId, fullId].map((id) => ({ id, name: "Saved", email: `${id}@example.com` })),
		)
})

afterAll(async () => {
	await db.delete(userTable).where(inArray(userTable.id, [userId, otherId, fullId]))
})

describe("createSavedSearch", () => {
	it("cleans the name and keeps the query as typed", async () => {
		const saved = await createSavedSearch(userId, {
			name: "  To  read ",
			query: '  is:unread  "deep  work" ',
		})
		expect(saved).toMatchObject({ name: "To read", query: 'is:unread  "deep  work"' })
		await createSavedSearch(userId, { name: 'a "quoted", name', query: "zebra" })
		expect(await byName()).toEqual({
			'a "quoted", name': "zebra",
			"To read": 'is:unread  "deep  work"',
		})
	})

	it("refuses a name or a query that cannot be one", async () => {
		for (const name of ["", "   ", "x".repeat(51), "nul\u0000"])
			await expect(createSavedSearch(userId, { name: name, query: "zebra" })).rejects.toMatchObject(
				{
					code: "invalid_request",
				},
			)
		for (const query of ["", "  ", "z".repeat(QUERY_MAX + 1), "nul\u0000"])
			await expect(createSavedSearch(userId, { name: "Fine", query: query })).rejects.toMatchObject(
				{
					code: "invalid_request",
				},
			)
		expect(
			await createSavedSearch(userId, { name: "x".repeat(50), query: "z".repeat(QUERY_MAX) }),
		).toBeTruthy()
	})

	it("refuses a name that differs only in case; the same query twice is fine", async () => {
		await expect(
			createSavedSearch(userId, { name: "TO READ", query: "other" }),
		).rejects.toMatchObject({
			code: "name_taken",
		})
		expect(await createSavedSearch(userId, { name: "Zebras", query: "zebra" })).toMatchObject({
			query: "zebra",
		})
		// Another user's names are theirs.
		expect(await createSavedSearch(otherId, { name: "To read", query: "is:unread" })).toMatchObject(
			{
				name: "To read",
			},
		)
	})

	it("stops at the limit", async () => {
		for (let i = 0; i < SAVED_SEARCHES_PER_USER_MAX; i++)
			await createSavedSearch(fullId, { name: `Search ${i}`, query: `word${i}` })
		await expect(
			createSavedSearch(fullId, { name: "One more", query: "zebra" }),
		).rejects.toMatchObject({
			code: "too_many_saved_searches",
		})
		await expect(
			createSavedSearch(fullId, { name: "search 0", query: "zebra" }),
		).rejects.toMatchObject({
			code: "name_taken",
		})
		const [first] = await listSavedSearches(fullId)
		await deleteSavedSearch(fullId, first!.id)
		expect(await createSavedSearch(fullId, { name: "One more", query: "zebra" })).toBeTruthy()
	})

	it("lists by name, whatever the case", async () => {
		await createSavedSearch(otherId, { name: "alpha", query: "a" })
		await createSavedSearch(otherId, { name: "Beta", query: "b" })
		expect((await listSavedSearches(otherId)).map((s) => s.name)).toEqual([
			"alpha",
			"Beta",
			"To read",
		])
	})
})

describe("the export", () => {
	it("has the saved searches, by name, without their ids", async () => {
		expect((await buildExport(otherId)).savedSearches).toEqual([
			{ name: "alpha", query: "a" },
			{ name: "Beta", query: "b" },
			{ name: "To read", query: "is:unread" },
		])
	})
})

describe("renameSavedSearch and deleteSavedSearch", () => {
	const idOf = async (name: string, owner = userId) =>
		(await listSavedSearches(owner)).find((s) => s.name === name)!.id

	it("renames, to another case too, and keeps the query", async () => {
		const id = await idOf("Zebras")
		expect(await renameSavedSearch(userId, id, " zebras ")).toEqual({
			id,
			name: "zebras",
			query: "zebra",
		})
		expect(await renameSavedSearch(userId, id, "Striped  horses")).toMatchObject({
			name: "Striped horses",
		})
	})

	it("refuses a bad name and a name another one has", async () => {
		const id = await idOf("Striped horses")
		await expect(renameSavedSearch(userId, id, " ")).rejects.toMatchObject({
			code: "invalid_request",
		})
		await expect(renameSavedSearch(userId, id, "to READ")).rejects.toMatchObject({
			code: "name_taken",
		})
	})

	it("never touches another user's rows", async () => {
		const id = await idOf("Striped horses")
		await expect(renameSavedSearch(otherId, id, "Stolen")).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(deleteSavedSearch(otherId, id)).rejects.toMatchObject({ code: "not_found" })
		expect(await byName()).toHaveProperty("Striped horses", "zebra")
		await deleteSavedSearch(userId, id)
		await expect(deleteSavedSearch(userId, id)).rejects.toMatchObject({ code: "not_found" })
	})
})

describe("a tag renamed or merged", () => {
	it("rewrites the saved queries of that user, and only those", async () => {
		const { tag } = await createTag(userId, "old")
		await createTag(otherId, "old")
		await createSavedSearch(userId, { name: "Pinned", query: "tag:old" })
		await createSavedSearch(userId, { name: "Mixed", query: "is:unread -TAG:Old site:x" })
		await createSavedSearch(userId, { name: "Untouched", query: "tag:older old" })
		await createSavedSearch(otherId, { name: "Theirs", query: "tag:old" })
		expect(await renameTag(userId, tag.id, "brand new")).toMatchObject({ merged: false })
		expect(await byName()).toMatchObject({
			Pinned: 'tag:"brand new"',
			Mixed: 'is:unread -tag:"brand new" site:x',
			Untouched: "tag:older old",
		})
		expect(await byName(otherId)).toMatchObject({ Theirs: "tag:old" })
	})

	it("points a merge at the tag that stays, and drops the repeat", async () => {
		const { tag: going } = await createTag(userId, "going")
		await createTag(userId, "Staying")
		await createSavedSearch(userId, { name: "Both", query: "tag:going zebra tag:staying" })
		await createSavedSearch(userId, { name: "One", query: "tag:GOING" })
		expect(await renameTag(userId, going.id, "staying")).toMatchObject({
			tag: { name: "Staying" },
			merged: true,
		})
		expect(await byName()).toMatchObject({ Both: "tag:Staying zebra", One: "tag:Staying" })
	})

	it("leaves a query that would grow past the limit", async () => {
		const { tag } = await createTag(userId, "a")
		const query = `${"z".repeat(QUERY_MAX - 6)} tag:a`
		await createSavedSearch(userId, { name: "Long", query: query })
		await renameTag(userId, tag.id, "a much longer name")
		expect(await byName()).toMatchObject({ Long: query })
	})
})

describe("savedSearchNamesByTag", () => {
	it("lists, by tag, the saved searches that name it, dash or not, whatever the case", () => {
		const row = (name: string, query: string) => ({ id: name, name, query })
		const byTag = savedSearchNamesByTag([
			row("A", 'tag:"Deep  Work" -tag:later'),
			row("B", "is:unread TAG:LATER tag:later"),
			row("C", 'later deep work title:"tag:later"'),
		])
		expect(Object.fromEntries(byTag)).toEqual({ "deep work": ["A"], later: ["A", "B"] })
	})
})
