import { accountBilling, db, eq, user } from "@klipstack/db"
import { type AdminContext, adminMutation, auditActor } from "~/lib/admin.server"
import { notFound } from "~/lib/app-error"
import { recordAudit } from "./admin-audit.server"

/**
 * Gives an account the paid plan at no charge until `freeUntil`, in place of the free period it
 * would have (the founding year, or none); null takes that back. With its audit event, in one
 * transaction. Setting what is already set changes nothing and records nothing.
 */
export async function setFreeUntil(
	ctx: AdminContext,
	userId: string,
	freeUntil: Date | null,
): Promise<{ changed: boolean }> {
	return adminMutation(ctx, async (tx) => {
		const [account] = await tx
			.select({ freeUntil: accountBilling.freeUntil })
			.from(user)
			.leftJoin(accountBilling, eq(accountBilling.userId, user.id))
			.where(eq(user.id, userId))
			.for("update", { of: user })
		if (!account) throw notFound("No such account.")
		if ((account.freeUntil?.getTime() ?? null) === (freeUntil?.getTime() ?? null))
			return { changed: false }
		if (freeUntil)
			await tx
				.insert(accountBilling)
				.values({ userId, freeUntil })
				.onConflictDoUpdate({ target: accountBilling.userId, set: { freeUntil } })
		else await tx.delete(accountBilling).where(eq(accountBilling.userId, userId))
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: "billing.free_until",
			targetKind: "user",
			targetId: userId,
			correlationId: ctx.correlationId,
			metadata: { freeUntil: freeUntil?.toISOString() ?? null },
		})
		return { changed: true }
	})
}

/** The date an admin gave the account, if any: null when it has its own trial or year. */
export async function freeUntilOf(userId: string): Promise<Date | null> {
	const [row] = await db
		.select({ freeUntil: accountBilling.freeUntil })
		.from(accountBilling)
		.where(eq(accountBilling.userId, userId))
	return row?.freeUntil ?? null
}
