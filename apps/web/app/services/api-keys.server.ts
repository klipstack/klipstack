import { createHash, randomBytes } from "node:crypto"
import { and, apiKeys, db, desc, eq, isNull, user as userTable } from "@klipstack/db"
import { AppError } from "~/lib/app-error"

export const API_KEY_PREFIX = "klip_"

export function hashApiKey(raw: string): string {
	return createHash("sha256").update(raw).digest("hex")
}

/** Create a key. The raw value is returned exactly once and never stored. */
export async function createApiKey(
	userId: string,
	name: string,
): Promise<{ id: string; raw: string; prefix: string }> {
	const raw = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`
	const prefix = raw.slice(0, API_KEY_PREFIX.length + 6)
	const row = await db.transaction(async (tx) => {
		const [owner] = await tx.select().from(userTable).where(eq(userTable.id, userId)).for("update")
		if (!owner?.emailVerified)
			throw new AppError(
				"verification_required",
				"Verify your email before creating an API key or connecting an app.",
			)
		const [created] = await tx
			.insert(apiKeys)
			.values({
				userId,
				name: name.trim().slice(0, 60) || "API key",
				prefix,
				keyHash: hashApiKey(raw),
			})
			.returning({ id: apiKeys.id })
		return created
	})
	if (!row) throw new Error("api key insert returned nothing")
	return { id: row.id, raw, prefix }
}

export async function listApiKeys(userId: string) {
	return db
		.select({
			id: apiKeys.id,
			name: apiKeys.name,
			prefix: apiKeys.prefix,
			lastUsedAt: apiKeys.lastUsedAt,
			createdAt: apiKeys.createdAt,
		})
		.from(apiKeys)
		.where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
		.orderBy(desc(apiKeys.createdAt))
}

/** False when the user has no such key, or it was revoked already. */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
	const rows = await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
		.returning({ id: apiKeys.id })
	return rows.length > 0
}

/** Resolve a bearer token to its owner. Touches `last_used_at` at most once per minute. */
export async function userForApiKey(raw: string) {
	if (!raw.startsWith(API_KEY_PREFIX) || raw.length < 20) return null
	const [row] = await db
		.select({ id: apiKeys.id, owner: userTable, lastUsedAt: apiKeys.lastUsedAt })
		.from(apiKeys)
		.innerJoin(userTable, eq(userTable.id, apiKeys.userId))
		.where(
			and(
				eq(apiKeys.keyHash, hashApiKey(raw)),
				isNull(apiKeys.revokedAt),
				eq(userTable.emailVerified, true),
			),
		)
		.limit(1)
	if (!row) return null
	if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
		await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
	}
	return row.owner
}
