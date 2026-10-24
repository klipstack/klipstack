import { db, eq, session, twoFactor, user } from "@klipstack/db"
// Relative, not "~/": the CLI runs in the image without the web app's tsconfig (Dockerfile).
import { AppError, notFound } from "../lib/app-error"
import { deleteAccount } from "./account.server"
import { AUDIT_REASON_MAX, newCorrelationId, recordAudit } from "./admin-audit.server"
import type { RoleTarget } from "./admin-roles.server"

/**
 * Deletes an account for the operator CLI (scripts/admin.ts): the deletion Settings runs, images
 * included, with an `account.delete` audit event in the same transaction. Not undoable. `confirm`
 * must be the account's email. An admin's account is refused: revoke the role first.
 */
export async function deleteAccountAsOperator(
	target: RoleTarget,
	{ confirm, reason }: { confirm: string; reason: string },
): Promise<{ userId: string; email: string }> {
	const why = reason.trim()
	if (!why || why.length > AUDIT_REASON_MAX)
		throw new AppError(
			"invalid_request",
			`A reason of 1 to ${AUDIT_REASON_MAX} characters is required.`,
		)
	const where =
		"email" in target
			? eq(user.email, target.email.trim().toLowerCase())
			: eq(user.id, target.userId)
	const [account] = await db
		.select({ id: user.id, email: user.email, role: user.role })
		.from(user)
		.where(where)
	if (!account) throw notFound("No such account.")
	if (account.role === "admin")
		throw new AppError("invalid_request", "That account is an admin: revoke the role first.")
	if (confirm.trim().toLowerCase() !== account.email.toLowerCase())
		throw new AppError("invalid_request", "--confirm must be the account's email address.")
	await deleteAccount(account.id, (tx) =>
		recordAudit(tx, {
			actor: { kind: "operator-cli" },
			action: "account.delete",
			targetKind: "user",
			targetId: account.id,
			correlationId: newCorrelationId(),
			metadata: { reason: why },
		}),
	)
	return { userId: account.id, email: account.email }
}

/**
 * Removes an account's two-factor authentication for the operator CLI: for a reader who lost both
 * the authenticator app and the backup codes, once the operator has checked it is really them (a
 * reply from the account's address, say: the CLI can't check). The secret and backup codes are
 * deleted, every session ends, and an `account.reset_two_factor` audit event commits with it. The
 * reader then signs in without a code, and may set it up again.
 */
export async function resetTwoFactorAsOperator(
	target: RoleTarget,
	{ reason }: { reason: string },
): Promise<{ userId: string; changed: boolean; sessionsEnded: number }> {
	const why = reason.trim()
	if (!why || why.length > AUDIT_REASON_MAX)
		throw new AppError(
			"invalid_request",
			`A reason of 1 to ${AUDIT_REASON_MAX} characters is required.`,
		)
	const where =
		"email" in target
			? eq(user.email, target.email.trim().toLowerCase())
			: eq(user.id, target.userId)
	return db.transaction(async (tx) => {
		const [account] = await tx
			.select({ id: user.id, on: user.twoFactorEnabled })
			.from(user)
			.where(where)
			.for("update")
		if (!account) throw notFound("No such account.")
		const removed = await tx
			.delete(twoFactor)
			.where(eq(twoFactor.userId, account.id))
			.returning({ id: twoFactor.id })
		if (!account.on && removed.length === 0)
			return { userId: account.id, changed: false, sessionsEnded: 0 }
		await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, account.id))
		const ended = await tx
			.delete(session)
			.where(eq(session.userId, account.id))
			.returning({ id: session.id })
		await recordAudit(tx, {
			actor: { kind: "operator-cli" },
			action: "account.reset_two_factor",
			targetKind: "user",
			targetId: account.id,
			correlationId: newCorrelationId(),
			metadata: { reason: why },
		})
		return { userId: account.id, changed: true, sessionsEnded: ended.length }
	})
}
