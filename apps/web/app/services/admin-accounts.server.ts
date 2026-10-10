import { db, eq, user } from "@klipstack/db"
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
