import { sql } from "drizzle-orm"
import { boolean, check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * better-auth core tables (v1.7). Keep in sync with `auth.server.ts` in apps/web.
 * Verify with: pnpm --filter @klipstack/web auth:generate (writes the gitignored auth.generated.ts
 * for diffing; needs the database up, since loading the auth config writes to it). The script pins
 * better-auth's CLI (`auth@x.y.z`): bump it together with better-auth.
 */
export const userRoles = ["user", "admin"] as const
export type UserRole = (typeof userRoles)[number]

export const user = pgTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		// additional fields
		locale: text("locale").notNull().default("en"),
		invitedBy: text("invited_by"),
		prefs: jsonb("prefs").$type<UserPrefs>().notNull().default({}),
		/** Granted and revoked only by the operator CLI (`pnpm --filter @klipstack/web admin`). */
		role: text("role", { enum: userRoles }).notNull().default("user"),
	},
	(t) => [check("user_role_check", sql`${t.role} in ('user', 'admin')`)],
)

/** The account's preferences, mostly the reader's. All optional; UI applies defaults. */
export interface UserPrefs {
	font?: "serif" | "sans" | "dyslexic"
	fontSize?: "sm" | "md" | "lg" | "xl"
	width?: "narrow" | "normal" | "wide"
	theme?: "system" | "light" | "dark"
	/** Single-character shortcuts (s, e, #, j, k, /…). Off for speech input and screen readers. */
	shortcuts?: "on" | "off"
	/**
	 * "Not now" on the nudge for a new edition: no nudge before this time (ISO). Only the server
	 * writes it.
	 */
	editionsNudgeAfter?: string | null
	/**
	 * Opening the review of old saves, or "Not now" on Home's card for it: no card before this time
	 * (ISO). Only the server writes it.
	 */
	reviewSuggestAfter?: string | null
	/**
	 * "Not now" on Home's question about notes on articles finished without one: no question before
	 * this time (ISO). Only the server writes it.
	 */
	noteRemindersAfter?: string | null
	/**
	 * Home's invitation to turn topics on is over: declined, the Topics page opened while topics were
	 * off, or topics turned on (ISO, when). It does not come back. Only the server writes it.
	 */
	topicsInvitationEndedAt?: string | null
	/**
	 * Public editions link to the author's previous and next ones. Off by default: each edition was
	 * published as unlisted on its own.
	 */
	linkEditions?: "on" | "off"
	/** The article's contents docked left of the text when the window has room for them. */
	outline?: "on" | "off"
}

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(t) => [index("session_user_id_idx").on(t.userId)],
)

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("account_user_id_idx").on(t.userId)],
)

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
)

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
