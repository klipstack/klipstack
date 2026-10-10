import { randomUUID } from "node:crypto"
import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import {
	aiThreads,
	assets,
	db,
	documents,
	documentVersions,
	eq,
	highlights,
	inArray,
	pool,
	user,
} from "@klipstack/db"
import { FAILED_RETENTION_DAYS } from "@klipstack/queue"
import { getStorage } from "@klipstack/storage"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { purgeOrphanAssets, purgeTrash } from "./jobs/purge"

// Every call is scoped to these two users: a shared development database keeps everyone else's.
const owner = `purge-${randomUUID()}`
const other = `purge-${randomUUID()}`
const owners = [owner, other]
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

beforeAll(async () => {
	await db
		.insert(user)
		.values(owners.map((id) => ({ id, name: "Purge", email: `${id}@example.com` })))
})
afterAll(async () => {
	await db.delete(user).where(inArray(user.id, owners))
	await pool.end()
})

async function article(
	userId: string,
	{
		html,
		deletedAt,
		status = "ready",
		leadImageAssetId,
	}: {
		html?: string
		deletedAt?: Date
		status?: typeof documents.$inferInsert.status
		leadImageAssetId?: string
	} = {},
) {
	const [doc] = await db
		.insert(documents)
		.values({
			userId,
			sourceUrl: `https://example.com/${randomUUID()}`,
			urlHash: randomUUID(),
			status,
			deletedAt,
			leadImageAssetId,
		})
		.returning({ id: documents.id })
	if (html)
		await db.insert(documentVersions).values({
			documentId: doc!.id,
			version: 1,
			html,
			text: "text",
			textHash: "hash",
			extractor: "test",
			extractorVersion: "1",
		})
	return doc!.id
}

async function image(userId: string, createdAt = ago(2)) {
	const [row] = await db
		.insert(assets)
		.values({
			userId,
			sha256: randomUUID(),
			storageKey: `u/${userId}/${randomUUID()}`,
			contentType: "image/png",
			bytes: 1,
			createdAt,
		})
		.returning({ id: assets.id })
	return row!.id
}

const exists = async (
	table: typeof documents | typeof assets | typeof highlights | typeof aiThreads,
	id: string,
) => (await db.select({ id: table.id }).from(table).where(eq(table.id, id))).length === 1

describe("purgeTrash", () => {
	it("deletes what has been in the trash past its retention, and nothing else", async () => {
		const kept = await article(owner, { html: "<p>x</p>" })
		const [version] = await db
			.select({ id: documentVersions.id })
			.from(documentVersions)
			.where(eq(documentVersions.documentId, kept))
		const recent = await article(owner, { deletedAt: ago(TRASH_RETENTION_DAYS - 1) })
		const expired = await article(owner, { deletedAt: ago(TRASH_RETENTION_DAYS + 1) })
		const failedRecent = await article(owner, {
			status: "failed",
			deletedAt: ago(FAILED_RETENTION_DAYS - 1),
		})
		const failedExpired = await article(owner, {
			status: "failed",
			deletedAt: ago(FAILED_RETENTION_DAYS + 1),
		})
		const [highlight] = await db
			.insert(highlights)
			.values({
				userId: owner,
				documentId: kept,
				versionId: version!.id,
				startOffset: 0,
				endOffset: 1,
				exact: "x",
				deletedAt: ago(TRASH_RETENTION_DAYS + 1),
			})
			.returning({ id: highlights.id })
		const [thread] = await db
			.insert(aiThreads)
			.values({
				userId: owner,
				documentId: kept,
				versionId: version!.id,
				startOffset: 0,
				endOffset: 1,
				exact: "x",
				action: "explain",
				deletedAt: ago(TRASH_RETENTION_DAYS + 1),
			})
			.returning({ id: aiThreads.id })

		expect(await purgeTrash(owners)).toEqual({ documents: 2, highlights: 1, aiThreads: 1 })
		expect(await exists(documents, kept)).toBe(true)
		expect(await exists(documents, recent)).toBe(true)
		expect(await exists(documents, failedRecent)).toBe(true)
		expect(await exists(documents, expired)).toBe(false)
		expect(await exists(documents, failedExpired)).toBe(false)
		expect(await exists(highlights, highlight!.id)).toBe(false)
		expect(await exists(aiThreads, thread!.id)).toBe(false)
	})
})

describe("purgeOrphanAssets", () => {
	it("removes images no article of their owner uses, after a day", async () => {
		const inHtml = await image(owner)
		const inTrashedHtml = await image(owner)
		const lead = await image(owner)
		const unused = await image(owner)
		const fresh = await image(owner, new Date())
		// Named only in someone else's article: that does not keep it.
		const elsewhere = await image(owner)
		await article(owner, {
			html: `<p><img src="/assets/${inHtml}"><img src="/assets/${inHtml}"></p>`,
		})
		await article(owner, {
			html: `<figure><img src="/assets/${inTrashedHtml}"></figure>`,
			deletedAt: ago(1),
		})
		await article(owner, { leadImageAssetId: lead })
		await article(other, { html: `<img src="/assets/${elsewhere}">` })

		expect(await purgeOrphanAssets(owners)).toBe(2)
		for (const id of [inHtml, inTrashedHtml, lead, fresh])
			expect(await exists(assets, id)).toBe(true)
		for (const id of [unused, elsewhere]) expect(await exists(assets, id)).toBe(false)
	})

	it("reads only well-formed ids from the HTML", async () => {
		const kept = await image(owner)
		await article(owner, {
			html: `<p>/assets/not-an-id-------------------------- and <img src="/assets/${kept}.png"></p>`,
		})
		expect(await purgeOrphanAssets(owners)).toBe(0)
		expect(await exists(assets, kept)).toBe(true)
	})

	it("keeps the row of a file it could not delete, to try again tomorrow", async () => {
		const stuck = await image(owner)
		const failing = vi.spyOn(getStorage(), "delete").mockRejectedValueOnce(new Error("down"))
		expect(await purgeOrphanAssets(owners)).toBe(0)
		expect(await exists(assets, stuck)).toBe(true)
		failing.mockRestore()
		expect(await purgeOrphanAssets(owners)).toBe(1)
		expect(await exists(assets, stuck)).toBe(false)
	})

	it("touches no one outside the users it is given", async () => {
		const outsider = `purge-${randomUUID()}`
		await db.insert(user).values({ id: outsider, name: "Other", email: `${outsider}@example.com` })
		const theirs = await image(outsider)
		expect(await purgeOrphanAssets(owners)).toBe(0)
		expect(await purgeOrphanAssets([])).toBe(0)
		expect(await exists(assets, theirs)).toBe(true)
		await db.delete(user).where(eq(user.id, outsider))
	})
})
