import { randomBytes } from "node:crypto"
import { and, db, eq, gt, invites, isNull, or, sql, type Tx } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { type AuditActor, newCorrelationId, recordAudit } from "../services/admin-audit.server"
import { INVITE_NOTE_MAX, type InviteExpiry } from "./admin-constants"
import { withAuthTransaction } from "./auth-db.server"
import { withSignupAllowed } from "./signup-gate.server"

export function normalizeInviteCode(code: string) {
	return code.trim().toUpperCase().replace(/\s+/g, "")
}

export function generateInviteCode() {
	return randomBytes(6)
		.toString("base64url")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 8)
		.padEnd(8, "K")
}

export async function findUsableInvite(code: string, tx: Tx | typeof db = db) {
	const normalized = normalizeInviteCode(code)
	if (!normalized) return null
	const [row] = await tx
		.select()
		.from(invites)
		.where(
			and(
				eq(invites.code, normalized),
				isNull(invites.usedBy),
				isNull(invites.usedAt),
				// Revoking also shortens the expiry, but that is for code from before `revoked_at`.
				isNull(invites.revokedAt),
				or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
			),
		)
		.limit(1)
		.for("update")
	return row && (!row.expiresAt || row.expiresAt > new Date()) ? row : null
}

/** Throws unless exactly this invite was still usable: a signup never commits without its invite. */
export async function consumeInvite(code: string, userId: string, tx: Tx | typeof db = db) {
	const normalized = normalizeInviteCode(code)
	const used = await tx
		.update(invites)
		.set({ usedBy: userId, usedAt: new Date() })
		.where(
			and(
				eq(invites.code, normalized),
				isNull(invites.usedBy),
				isNull(invites.usedAt),
				isNull(invites.revokedAt),
			),
		)
		.returning({ id: invites.id })
	if (used.length !== 1)
		throw new APIError("FORBIDDEN", { code: "INVITE_REQUIRED", message: "Invalid invite." })
}

/** Lock the invite before auth touches the database. Any error rolls everything back. */
export function signupWithInvite<T extends { response: { user: { id: string } } }>(
	code: string | undefined,
	create: () => Promise<T>,
) {
	return withAuthTransaction(async (tx) => {
		const invite = code ? await findUsableInvite(code, tx) : null
		if (!invite)
			throw new APIError("FORBIDDEN", { code: "INVITE_REQUIRED", message: "Invalid invite." })
		const result = await withSignupAllowed(create)
		await consumeInvite(invite.code, result.response.user.id, tx)
		return result
	})
}

const EXPIRY_DAYS: Record<InviteExpiry, number | null> = {
	"1d": 1,
	"7d": 7,
	"30d": 30,
	never: null,
}

/**
 * Inserts an invite and its audit event in the caller's transaction. The expiry is computed from
 * the database's clock. The event holds the invite's internal ID, never its code or note.
 */
export async function insertInvite(
	tx: Tx,
	{
		actor,
		correlationId,
		note,
		expiry,
	}: { actor: AuditActor; correlationId: string; note?: string | null; expiry: InviteExpiry },
): Promise<{ id: string; code: string }> {
	const code = generateInviteCode()
	const days = EXPIRY_DAYS[expiry]
	const [row] = await tx
		.insert(invites)
		.values({
			code,
			createdBy: actor.kind === "user" ? actor.userId : null,
			note: note?.trim().slice(0, INVITE_NOTE_MAX) || null,
			expiresAt: days === null ? null : sql`now() + ${days} * interval '1 day'`,
		})
		.returning({ id: invites.id })
	if (!row) throw new Error("invite insert returned nothing")
	await recordAudit(tx, {
		actor,
		action: "invite.create",
		targetKind: "invite",
		targetId: row.id,
		correlationId,
		metadata: { inviteId: row.id, expiry },
	})
	return { id: row.id, code }
}

/** The operator CLI's invite (`pnpm --filter @klipstack/web invite`): no expiry, as before. */
export async function createInvite({ note }: { note?: string } = {}) {
	const { code } = await db.transaction((tx) =>
		insertInvite(tx, {
			actor: { kind: "operator-cli" },
			correlationId: newCorrelationId(),
			note,
			expiry: "never",
		}),
	)
	return code
}
