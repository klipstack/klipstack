import { randomUUID } from "node:crypto"
import { type AdminAuditMetadata, adminAuditEvents, type Tx } from "@klipstack/db"

/** Who made a change. The CLI cannot prove who ran it: its reason is context, not identity. */
export type AuditActor = { kind: "user"; userId: string } | { kind: "operator-cli" }

export type AuditAction =
	| "account.delete"
	| "edition.remove"
	| "edition.restore"
	| "edition_reports.dismiss"
	| "feature.enable"
	| "feature.disable"
	| "invite.create"
	| "invite.revoke"
	| "invite_request.approve"
	| "invite_request.dismiss"
	| "job.retry.extract"
	| "job.retry.images"
	| "role.grant"
	| "role.revoke"

export type AuditTargetKind = "invite" | "invite_request" | "document" | "edition" | "job" | "user"

/**
 * The only metadata an event may carry: internal IDs, safe categories, role changes, feature flag
 * names, the CLI reason, and a removal's ground and report count (never a report's text or
 * address, nor the admin's note to the owner). Invite codes, emails, notes, content and error text have no key here, so they cannot be
 * stored by accident.
 */
const METADATA_KEYS = new Set([
	"inviteId",
	"documentId",
	"versionId",
	"jobId",
	"sourceJobId",
	"ownerId",
	"expiry",
	"fromRole",
	"toRole",
	"sessionsRevoked",
	"reason",
	"feature",
	"ground",
	"reports",
])
export const AUDIT_REASON_MAX = 200

export const newCorrelationId = () => randomUUID()

/**
 * Writes the event in the caller's transaction, after the change it records. A failure here throws,
 * and the transaction (the change included) rolls back: no admin change commits without its event.
 */
export async function recordAudit(
	tx: Tx,
	event: {
		actor: AuditActor
		action: AuditAction
		targetKind: AuditTargetKind
		targetId: string
		correlationId: string
		metadata?: AdminAuditMetadata
	},
): Promise<void> {
	const metadata: AdminAuditMetadata = {}
	for (const [key, value] of Object.entries(event.metadata ?? {})) {
		if (!METADATA_KEYS.has(key)) throw new Error(`audit metadata key not allowed: ${key}`)
		metadata[key] = typeof value === "string" ? value.slice(0, AUDIT_REASON_MAX) : value
	}
	await tx.insert(adminAuditEvents).values({
		actorKind: event.actor.kind,
		actorUserId: event.actor.kind === "user" ? event.actor.userId : null,
		action: event.action,
		targetKind: event.targetKind,
		targetId: event.targetId,
		correlationId: event.correlationId,
		metadata,
	})
}
