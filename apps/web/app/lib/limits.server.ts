import { estimateCostUsd, type TokenCounts } from "@klipstack/ai"
import {
	and,
	db,
	eq,
	type SQL,
	sql,
	subscriptions,
	type Tx,
	type UsageMetric,
	type UserRole,
	usageCounts,
	user,
} from "@klipstack/db"
import { logError } from "@klipstack/log"
import type { AiAllowance } from "./ai-threads"
import { AppError } from "./app-error"
import { env } from "./env.server"

/**
 * Per-account caps. Unlike the rate limits, they are counted in the database, so they hold across
 * deploys and machines. Every account has the same numbers, except admins' AI cap; a plan, or an
 * exception for an import, is `limitsFor` answering other ones.
 */
export interface Limits {
	/** New articles a calendar month (UTC), however they were saved. */
	saves: number
	/** Captured pages, extracted versions and rehosted images, in bytes. */
	storage: number
	/** Feeds followed at once. */
	feeds: number
	/** Editions published for the first time, a calendar month (UTC). */
	editions: number
	/** Questions sent to the AI (answers, follow-ups, retries), a calendar month (UTC). */
	ai: number
}

export type LimitName = keyof Limits

export async function limitsFor(userId: string): Promise<Limits> {
	const [account] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId))
	return limitsForRole(account?.role ?? "user")
}

/** The caps of an account with that role: admins ask the AI more, everything else is the same. */
export function limitsForRole(role: UserRole): Limits {
	const limits = defaultLimits()
	return role === "admin" ? { ...limits, ai: env.LIMIT_AI_PER_MONTH_ADMIN } : limits
}

/** The caps of an account with nothing special about it: the env's numbers. */
export function defaultLimits(): Limits {
	return {
		saves: env.LIMIT_SAVES_PER_MONTH,
		storage: env.LIMIT_STORAGE_MB * 1024 * 1024,
		feeds: env.LIMIT_FEEDS,
		editions: env.LIMIT_EDITIONS_PER_MONTH,
		ai: env.LIMIT_AI_PER_MONTH,
	}
}

/** The month a count goes to (its first day, UTC), and when the next one starts. */
export function monthOf(now = new Date()): { month: string; resetsAt: Date } {
	const year = now.getUTCFullYear()
	const month = now.getUTCMonth()
	return {
		month: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
		resetsAt: new Date(Date.UTC(year, month + 1, 1)),
	}
}

const day = (date: Date) => date.toISOString().slice(0, 10)
const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024))

const MESSAGES: Record<LimitName, (max: number, resetsAt?: Date) => string> = {
	saves: (max, resetsAt) =>
		`This account saved ${max} articles this month, the most it can. Saving works again on ${day(resetsAt!)}.`,
	storage: (max) =>
		`This account stores ${megabytes(max)} MB, the most it can. Delete articles forever from the trash to make room.`,
	feeds: (max) =>
		`This account follows ${max} feeds, the most it can. Unfollow one to follow another.`,
	editions: (max, resetsAt) =>
		`This account published ${max} new editions this month, the most it can. Publishing works again on ${day(resetsAt!)}.`,
	ai: (max, resetsAt) =>
		`This account asked the AI ${max} times this month, the most it can. Asking works again on ${day(resetsAt!)}.`,
}

/** The refusal at a cap. The monthly ones say when the count starts over. */
export function limitReached(limit: LimitName, max: number, resetsAt?: Date): AppError {
	return new AppError("limit_reached", MESSAGES[limit](max, resetsAt), {
		details: { limit, max, ...(resetsAt ? { resetsAt: resetsAt.toISOString() } : {}) },
	})
}

async function bump(
	runner: Pick<Tx, "insert">,
	userId: string,
	metric: UsageMetric,
	month = monthOf().month,
	by = 1,
) {
	const [row] = await runner
		.insert(usageCounts)
		.values({ userId, metric, month, count: by })
		.onConflictDoUpdate({
			target: [usageCounts.userId, usageCounts.metric, usageCounts.month],
			set: { count: sql`${usageCounts.count} + ${by}` },
		})
		.returning({ count: usageCounts.count })
	return row!.count
}

/**
 * One more refusal by a cap this month, for admins (`/admin/usage`). Outside the refused work's
 * transaction, which rolls back: the refusal itself stays counted.
 */
export async function countRefusal(userId: string) {
	await bump(db, userId, "refused")
}

/**
 * What an AI answer or brief cost, estimated from its tokens, added to the account's month for
 * `/admin/usage` when the provider finishes it: a retry or a delete later keeps it. One cut off
 * (the reader left, the provider failed) comes with no token counts, and is not priced.
 */
export async function recordAiSpend(userId: string, model: string, tokens: TokenCounts) {
	const micros = Math.round(estimateCostUsd(model, tokens) * 1_000_000)
	if (micros <= 0) return
	try {
		await bump(db, userId, "ai_spend", monthOf().month, micros)
	} catch (error) {
		// The answer is worth more than its estimate: it is saved all the same.
		logError("[ai] recording what an answer cost failed", error)
	}
}

/** Refuses at a cap, and counts the refusal. */
async function refuse(userId: string, limit: LimitName, max: number, resetsAt?: Date) {
	await countRefusal(userId)
	return limitReached(limit, max, resetsAt)
}

/**
 * Counts one more `metric` this month in the caller's transaction, and refuses past the cap; the
 * refusal rolls the count back with the rest. The row lock makes two at once take turns, so they
 * cannot both take the last one. Answers the count with this one, the cap, and when it starts over.
 */
export async function countMonthly(
	tx: Tx,
	userId: string,
	metric: "saves" | "editions" | "ai",
): Promise<{ used: number; max: number; resetsAt: Date }> {
	const max = (await limitsFor(userId))[metric]
	// One month for the count and the date it starts over, even at midnight on the 1st.
	const { month, resetsAt } = monthOf()
	const used = await bump(tx, userId, metric, month)
	if (used > max) throw await refuse(userId, metric, max, resetsAt)
	return { used, max, resetsAt }
}

/** The account's AI questions this month against its cap, for the reader. */
export async function aiAllowance(userId: string): Promise<AiAllowance> {
	const { month, resetsAt } = monthOf()
	const [limits, [row]] = await Promise.all([
		limitsFor(userId),
		db
			.select({ count: usageCounts.count })
			.from(usageCounts)
			.where(
				and(
					eq(usageCounts.userId, userId),
					eq(usageCounts.metric, "ai"),
					eq(usageCounts.month, month),
				),
			),
	])
	return { used: row?.count ?? 0, max: limits.ai, resetsAt: resetsAt.toISOString() }
}

/**
 * Each stored thing's size, by account: captured pages, extracted versions (the trash's too,
 * until they are deleted forever) and rehosted images. `octet_length` reads the stored size from
 * the value's header, without reading the value. `only` limits it to one account.
 */
export function storedBytes(only?: string): SQL {
	const of = (column: SQL) => (only ? sql`where ${column} = ${only}` : sql``)
	return sql`
		select a.user_id, a.bytes::bigint as bytes from assets a ${of(sql`a.user_id`)}
		union all
		select d.user_id, octet_length(r.raw_html)::bigint from document_raw r
			join documents d on d.id = r.document_id ${of(sql`d.user_id`)}
		union all
		select d.user_id, (octet_length(v.html) + octet_length(v.text))::bigint from document_versions v
			join documents d on d.id = v.document_id ${of(sql`d.user_id`)}
	`
}

/**
 * Bytes the account stores (`storedBytes`). Computed on each call: fine while libraries hold
 * thousands of articles, not millions.
 */
export async function storageUsed(userId: string): Promise<number> {
	const result = await db.execute<{ bytes: string | null }>(
		sql`select coalesce(sum(s.bytes), 0) as bytes from (${storedBytes(userId)}) s`,
	)
	return Number(result.rows[0]?.bytes ?? 0)
}

/** Refuses when the account stores as much as it may. What is being stored now may go past it. */
export async function checkStorage(userId: string) {
	const max = (await limitsFor(userId)).storage
	if ((await storageUsed(userId)) >= max) throw await refuse(userId, "storage", max)
}

async function feedsFollowed(userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
	return row?.n ?? 0
}

/** How many more feeds the account may follow. */
export async function feedsLeft(userId: string): Promise<number> {
	const max = (await limitsFor(userId)).feeds
	return Math.max(0, max - (await feedsFollowed(userId)))
}

/** Refuses a new follow at the cap. */
export async function checkFeeds(userId: string) {
	if ((await feedsLeft(userId)) <= 0)
		throw await refuse(userId, "feeds", (await limitsFor(userId)).feeds)
}

export interface Usage {
	saves: { used: number; max: number }
	storage: { used: number; max: number }
	feeds: { used: number; max: number }
	editions: { used: number; max: number }
	ai: { used: number; max: number }
	/** Refusals by any cap this month: admins see it, the account does not. */
	refused: number
	/** When the monthly counts start over. */
	resetsAt: Date
}

/** Where the account stands against each cap, for Settings. */
export async function usageOf(userId: string): Promise<Usage> {
	const { month, resetsAt } = monthOf()
	const [limits, counts, storage, feeds] = await Promise.all([
		limitsFor(userId),
		db
			.select({ metric: usageCounts.metric, count: usageCounts.count })
			.from(usageCounts)
			.where(and(eq(usageCounts.userId, userId), eq(usageCounts.month, month))),
		storageUsed(userId),
		feedsFollowed(userId),
	])
	const counted = (metric: UsageMetric) => counts.find((c) => c.metric === metric)?.count ?? 0
	return {
		saves: { used: counted("saves"), max: limits.saves },
		storage: { used: storage, max: limits.storage },
		feeds: { used: feeds, max: limits.feeds },
		editions: { used: counted("editions"), max: limits.editions },
		ai: { used: counted("ai"), max: limits.ai },
		refused: counted("refused"),
		resetsAt,
	}
}
