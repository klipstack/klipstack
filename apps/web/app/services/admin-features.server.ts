import { and, eq, type FeatureFlag, user, userFeatures } from "@klipstack/db"
import { type AdminContext, adminMutation, auditActor } from "~/lib/admin.server"
import { notFound } from "~/lib/app-error"
import { recordAudit } from "./admin-audit.server"

/**
 * Turns a feature in testing on or off for an account, with its audit event, in one transaction.
 * Setting what is already set changes nothing and records nothing.
 */
export async function setFeature(
	ctx: AdminContext,
	userId: string,
	feature: FeatureFlag,
	enabled: boolean,
): Promise<{ changed: boolean }> {
	return adminMutation(ctx, async (tx) => {
		const [account] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId))
		if (!account) throw notFound("No such account.")
		const changed = enabled
			? await tx
					.insert(userFeatures)
					.values({ userId, feature })
					.onConflictDoNothing()
					.returning({ userId: userFeatures.userId })
			: await tx
					.delete(userFeatures)
					.where(and(eq(userFeatures.userId, userId), eq(userFeatures.feature, feature)))
					.returning({ userId: userFeatures.userId })
		if (changed.length === 0) return { changed: false }
		await recordAudit(tx, {
			actor: auditActor(ctx),
			action: enabled ? "feature.enable" : "feature.disable",
			targetKind: "user",
			targetId: userId,
			correlationId: ctx.correlationId,
			metadata: { feature },
		})
		return { changed: true }
	})
}
