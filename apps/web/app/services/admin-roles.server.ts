import { account as accounts, and, db, eq, session, sql, type UserRole, user } from "@klipstack/db"
// Relative, not "~/": the role CLI runs in the image without the web app's tsconfig (Dockerfile).
import { AppError, notFound } from "../lib/app-error"
import { AUDIT_REASON_MAX, newCorrelationId, recordAudit } from "./admin-audit.server"

/**
 * Role changes, for the operator CLI only (scripts/admin.ts). No route imports this: there is no
 * web path to a role change. Database access is the credential; the actor is `operator-cli`.
 */
export type RoleTarget = { email: string } | { userId: string }

export interface RoleChangeResult {
	userId: string
	role: UserRole
	changed: boolean
	sessionsRevoked: number
	/** Without it, an admin's /admin answers "set up two-factor first" (`authorizeAdmin`). */
	twoFactorEnabled: boolean
}

/**
 * One transaction: the role, the end of every browser session of that account (a fresh login is
 * required after a grant as well as a revoke), and the audit event. The row lock (FOR UPDATE) is
 * what an admin's own mutation waits on, or makes this wait: see `adminMutation`. The account's
 * OAuth grants are left alone, since they never carry admin authority.
 */
export async function changeRole(
	target: RoleTarget,
	role: UserRole,
	reason: string,
): Promise<RoleChangeResult> {
	const why = reason.trim()
	if (!why || why.length > AUDIT_REASON_MAX)
		throw new AppError(
			"invalid_request",
			`A reason of 1 to ${AUDIT_REASON_MAX} characters is required.`,
		)
	return db.transaction(async (tx) => {
		const where =
			"email" in target
				? eq(user.email, target.email.trim().toLowerCase())
				: eq(user.id, target.userId)
		const [account] = await tx
			.select({
				id: user.id,
				role: user.role,
				emailVerified: user.emailVerified,
				twoFactorEnabled: user.twoFactorEnabled,
			})
			.from(user)
			.where(where)
			.for("update")
		if (!account) throw notFound("No such account.")
		if (role === "admin" && !account.emailVerified)
			throw new AppError(
				"verification_required",
				"The account's email is not verified; admins must be verified.",
			)
		if (role === "admin") {
			const [password] = await tx
				.select({ id: accounts.id })
				.from(accounts)
				.where(and(eq(accounts.userId, account.id), eq(accounts.providerId, "credential")))
			// Admins confirm a recent sign-in with their password (admin.reauthenticate.ts).
			if (!password)
				throw new AppError(
					"invalid_request",
					"The account has no password; admins must have one. Set it in Settings, Account first.",
				)
		}
		const twoFactorEnabled = Boolean(account.twoFactorEnabled)
		if (account.role === role)
			return { userId: account.id, role, changed: false, sessionsRevoked: 0, twoFactorEnabled }

		await tx.update(user).set({ role }).where(eq(user.id, account.id))
		const ended = await tx
			.delete(session)
			.where(eq(session.userId, account.id))
			.returning({ id: session.id })
		await recordAudit(tx, {
			actor: { kind: "operator-cli" },
			action: role === "admin" ? "role.grant" : "role.revoke",
			targetKind: "user",
			targetId: account.id,
			correlationId: newCorrelationId(),
			metadata: {
				fromRole: account.role,
				toRole: role,
				sessionsRevoked: ended.length,
				reason: why,
			},
		})
		return {
			userId: account.id,
			role,
			changed: true,
			sessionsRevoked: ended.length,
			twoFactorEnabled,
		}
	})
}

export async function listAdmins(): Promise<
	Array<{
		id: string
		name: string
		email: string
		emailVerified: boolean
		twoFactorEnabled: boolean
		createdAt: Date
	}>
> {
	const result = await db.execute<{
		id: string
		name: string
		email: string
		email_verified: boolean
		two_factor_enabled: boolean | null
		created_at: Date
	}>(
		sql`select id, name, email, email_verified, two_factor_enabled, created_at from "user" where role = 'admin' order by created_at`,
	)
	return result.rows.map((row) => ({
		id: row.id,
		name: row.name,
		email: row.email,
		emailVerified: row.email_verified,
		twoFactorEnabled: Boolean(row.two_factor_enabled),
		createdAt: new Date(row.created_at),
	}))
}
