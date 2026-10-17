import { randomUUID } from "node:crypto"
import {
	apiKeys,
	db,
	documents,
	documentVersions,
	eq,
	feedItemDismissals,
	feedItems,
	feeds,
	highlights,
	subscriptions,
	user as userTable,
} from "@klipstack/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	openArticle,
	purgeArticles,
	restoreArticles,
	saveReadingPosition,
	trashArticles,
	undoArchive,
	updateArticles,
} from "~/commands/articles.server"
import { saveFeedItem } from "~/commands/saving.server"
import { revokeApiKey } from "./api-keys.server"
import { getDocument, restoreDocument, setNote } from "./documents.server"
import { dismissFeedItem, renameSubscription, restoreFeedItem, unsubscribe } from "./feeds.server"
import {
	createHighlight,
	deleteHighlight,
	getHighlight,
	restoreHighlight,
	updateHighlight,
} from "./highlights.server"

// One user's rows, and another user who calls every service with their ids.
const owner = `test-owner-${randomUUID()}`
const other = `${owner}-other`
const ids = {} as Record<"doc" | "highlight" | "key" | "feed" | "item" | "subscription", string>

const row = async <T>(query: Promise<T[]>) => (await query)[0]

beforeAll(async () => {
	await db.insert(userTable).values([
		{ id: owner, name: "Owner", email: `${owner}@example.com`, prefs: { feeds: "on" } },
		{ id: other, name: "Other", email: `${other}@example.com`, prefs: { feeds: "on" } },
	])
	const text = "Alpha bravo charlie delta."
	const doc = await row(
		db
			.insert(documents)
			.values({
				userId: owner,
				sourceUrl: "https://example.com/o",
				urlHash: owner,
				status: "ready",
			})
			.returning(),
	)
	const version = await row(
		db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: `<p>${text}</p>`,
				text,
				textHash: "o",
				extractor: "test",
				extractorVersion: "1",
			})
			.returning(),
	)
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	const highlight = await row(
		db
			.insert(highlights)
			.values({
				userId: owner,
				documentId: doc!.id,
				versionId: version!.id,
				startOffset: 6,
				endOffset: 19,
				exact: "bravo charlie",
			})
			.returning(),
	)
	const key = await row(
		db
			.insert(apiKeys)
			.values({ userId: owner, name: "k", prefix: "klip_o", keyHash: owner })
			.returning(),
	)
	const feed = await row(
		db
			.insert(feeds)
			.values({ url: `https://example.com/${owner}.xml`, urlHash: owner })
			.returning(),
	)
	const item = await row(
		db
			.insert(feedItems)
			.values({
				feedId: feed!.id,
				guid: owner,
				url: "https://example.com/post",
				urlHash: `p-${owner}`,
			})
			.returning(),
	)
	const subscription = await row(
		db.insert(subscriptions).values({ userId: owner, feedId: feed!.id, title: "Mine" }).returning(),
	)
	await db.insert(feedItemDismissals).values({ userId: owner, itemId: item!.id })
	Object.assign(ids, {
		doc: doc!.id,
		highlight: highlight!.id,
		key: key!.id,
		feed: feed!.id,
		item: item!.id,
		subscription: subscription!.id,
	})
})

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, owner))
	await db.delete(userTable).where(eq(userTable.id, other))
	await db.delete(feeds).where(eq(feeds.id, ids.feed))
})

const snapshot = async () => ({
	doc: await db.query.documents.findFirst({ where: eq(documents.id, ids.doc) }),
	highlight: await db.query.highlights.findFirst({ where: eq(highlights.id, ids.highlight) }),
	key: await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, ids.key) }),
	subscription: await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, ids.subscription),
	}),
	dismissals: await db.query.feedItemDismissals.findMany({
		where: eq(feedItemDismissals.itemId, ids.item),
	}),
})

describe("another user's ids", () => {
	it("find nothing and change nothing", async () => {
		const before = await snapshot()

		expect(await getDocument(other, ids.doc)).toBeUndefined()
		expect(await getHighlight(other, ids.highlight)).toBeNull()
		expect(await updateHighlight(other, ids.highlight, { note: "mine", color: 2 })).toBeNull()
		expect(await setNote(other, ids.doc, "mine")).toBeNull()
		await expect(openArticle(other, ids.doc)).rejects.toMatchObject({ code: "not_found" })
		expect(await trashArticles(other, [ids.doc])).toEqual({ trashed: [], notFound: [ids.doc] })
		expect(await restoreDocument(other, ids.doc)).toBe(false)
		expect((await restoreArticles(other, [ids.doc])).notFound).toEqual([ids.doc])
		expect(await unsubscribe(other, ids.subscription)).toBe(false)
		await expect(saveFeedItem(other, ids.item)).rejects.toMatchObject({ code: "not_found" })
		expect(await dismissFeedItem(other, ids.item)).toBe(false)
		expect(
			await createHighlight({
				userId: other,
				documentId: ids.doc,
				input: { exact: "bravo charlie" },
			}),
		).toMatchObject({ ok: false })
		await deleteHighlight(other, ids.highlight)
		for (const changes of [
			{ location: "archive" as const },
			{ starred: true },
			{ title: "Mine" },
			{ finished: false },
			{ finished: true },
			{ addTags: ["mine"] },
		])
			expect((await updateArticles(other, { ids: [ids.doc], ...changes })).notFound).toEqual([
				ids.doc,
			])
		expect(await undoArchive(other, [ids.doc])).toEqual([])
		await expect(saveReadingPosition(other, ids.doc, { position: 0.5 })).rejects.toMatchObject({
			code: "not_found",
		})
		await renameSubscription(other, ids.subscription, "Mine now")
		await restoreFeedItem(other, ids.item)
		await revokeApiKey(other, ids.key)
		expect((await purgeArticles(other, [ids.doc])).notFound).toEqual([ids.doc])

		expect(await snapshot()).toEqual(before)
		// A deleted highlight can't be brought back by someone else either.
		await deleteHighlight(owner, ids.highlight)
		await restoreHighlight(other, ids.highlight)
		expect(await getHighlight(owner, ids.highlight)).toBeNull()
	})
})
