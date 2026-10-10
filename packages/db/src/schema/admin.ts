import { sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const adminActorKinds = ["user", "operator-cli"] as const
export type AdminActorKind = (typeof adminActorKinds)[number]

/** An allowlist of IDs, safe categories, role changes and the CLI reason. Never codes or emails. */
export type AdminAuditMetadata = Record<string, string | number | boolean | null>

/**
 * Operational history of admin changes (not a tamper-proof log). A row commits with the change it
 * records, or neither does. Deleting a user keeps their events, without the actor.
 */
export const adminAuditEvents = pgTable(
	"admin_audit_events",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		actorKind: text("actor_kind", { enum: adminActorKinds }).notNull(),
		actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
		action: text("action").notNull(),
		targetKind: text("target_kind").notNull(),
		targetId: text("target_id").notNull(),
		correlationId: text("correlation_id").notNull(),
		metadata: jsonb("metadata").$type<AdminAuditMetadata>().notNull().default({}),
	},
	(t) => [
		index("admin_audit_events_created_idx").on(t.createdAt.desc(), t.id.desc()),
		check("admin_audit_events_actor_kind_check", sql`${t.actorKind} in ('user', 'operator-cli')`),
		check("admin_audit_events_metadata_size_check", sql`pg_column_size(${t.metadata}) <= 2048`),
	],
)

/** Process liveness of each worker instance, in database time. Not proof that jobs progress. */
export const workerHeartbeats = pgTable(
	"worker_heartbeats",
	{
		instanceId: uuid("instance_id").primaryKey(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("worker_heartbeats_last_seen_idx").on(t.lastSeenAt.desc())],
)

export type AdminAuditEvent = typeof adminAuditEvents.$inferSelect
