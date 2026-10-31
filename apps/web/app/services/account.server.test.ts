import { randomUUID } from "node:crypto"
import {
	apiKeys,
	assets,
	db,
	documents,
	documentVersions,
	eq,
	feeds,
	highlights,
	sql,
	subscriptions,
	tags,
	user as userTable,
} from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import { afterAll, describe, expect, it, vi } from "vitest"
import { deleteAccount } from "./account.server"

const userId = `test-account-${randomUUID()}`
let feedId: string

afterAll(async () => {
	await db.delete(userTable).where(eq(userTable.id, userId))
	if (feedId) await db.delete(feeds).where(eq(feeds.id, feedId))
})

/** Every public column that names a user, with what deleting the user does to its rows. */
async function userColumns() {
	const { rows } = await db.execute<{ table: string; column: string; rule: string | null }>(sql`
		select c.table_name as table, c.column_name as column, (
			select rc.delete_rule
			from information_schema.key_column_usage k
			join information_schema.referential_constraints rc
				on rc.constraint_name = k.constraint_name and rc.constraint_schema = k.constraint_schema
			join information_schema.constraint_column_usage u
				on u.constraint_name = rc.unique_constraint_name
				and u.constraint_schema = rc.unique_constraint_schema
			where k.table_schema = c.table_schema and k.table_name = c.table_name
				and k.column_name = c.column_name and u.table_name = 'user'
			limit 1
		) as rule
		from information_schema.columns c
		where c.table_schema = 'public' and c.column_name like '%user_id'`)
	return rows
}

describe("deleteAccount", () => {
	it("leaves no row of the account in any table, even when a stored file won't go", async () => {
		// Every table that names a user goes with it; the audit trail keeps its rows, without the name.
		for (const { table, column, rule } of await userColumns())
			expect(`${table}.${column} ${rule}`).toBe(
				`${table}.${column} ${table === "admin_audit_events" ? "SET NULL" : "CASCADE"}`,
			)

		await db.insert(userTable).values({ id: userId, name: "Gone", email: `${userId}@example.com` })
		const [doc] = await db
			.insert(documents)
			.values({ userId, sourceUrl: "https://example.com/gone", urlHash: userId, status: "ready" })
			.returning({ id: documents.id })
		const [version] = await db
			.insert(documentVersions)
			.values({
				documentId: doc!.id,
				version: 1,
				html: "<p>Gone</p>",
				text: "Gone",
				textHash: "gone",
				extractor: "test",
				extractorVersion: "1",
			})
			.returning({ id: documentVersions.id })
		await db.insert(highlights).values({
			userId,
			documentId: doc!.id,
			versionId: version!.id,
			startOffset: 0,
			endOffset: 4,
			exact: "Gone",
		})
		await db.insert(tags).values({ userId, name: "gone" })
		const [feed] = await db
			.insert(feeds)
			.values({ url: `https://example.com/${userId}.xml`, urlHash: `feed-${userId}` })
			.returning({ id: feeds.id })
		feedId = feed!.id
		await db.insert(subscriptions).values({ userId, feedId })
		await db
			.insert(apiKeys)
			.values({ userId, name: "k", prefix: "klip_x", keyHash: `hash-${userId}` })
		await db.insert(assets).values({
			userId,
			sha256: userId,
			storageKey: `gone/${userId}`,
			contentType: "image/webp",
			bytes: 1,
		})
		const failing = vi.spyOn(getStorage(), "delete").mockRejectedValue(new Error("storage is down"))

		await deleteAccount(userId)

		expect(failing).toHaveBeenCalledWith(`gone/${userId}`)
		failing.mockRestore()
		for (const { table, column } of await userColumns()) {
			const { rows } = await db.execute<{ n: number }>(
				sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${userId}`,
			)
			expect(`${table}: ${rows[0]?.n}`).toBe(`${table}: 0`)
		}
		// Feeds are shared: the feed stays for its other readers.
		expect(await db.query.feeds.findFirst({ where: eq(feeds.id, feedId) })).toBeDefined()
	})

	it("deletes with the worker's statement limit: a large account's cascade outlasts a request's", async () => {
		const id = `test-account-slow-${randomUUID()}`
		await db.insert(userTable).values({ id, name: "Slow", email: `${id}@example.com` })
		let limit: string | undefined
		await deleteAccount(id, async (tx) => {
			const { rows } = await tx.execute<{ setting: string }>(
				sql`select setting from pg_settings where name = 'statement_timeout'`,
			)
			limit = rows[0]?.setting
		})
		// The worker's default, 5 minutes, not the web's 15 s.
		expect(limit).toBe("300000")
		expect(await db.query.user.findFirst({ where: eq(userTable.id, id) })).toBeUndefined()
		// The rest of the process keeps the web limit: `set local` ends with the transaction.
		const { rows } = await db.execute<{ setting: string }>(
			sql`select setting from pg_settings where name = 'statement_timeout'`,
		)
		expect(rows[0]?.setting).toBe("15000")
	})
})
