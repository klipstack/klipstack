import {
	and,
	db,
	eq,
	exists,
	feedSubscribers,
	feeds,
	initialSince,
	isNull,
	lte,
	notifyDocumentEvent,
	type StorableFeedEntry,
	sql,
	storeFeedEntries,
	subscriptions,
	user,
} from "@klipstack/db"
import { ExtractError, fetchFeed, parseFeedDocument, urlHash } from "@klipstack/extract"
import { enqueue, type JobPayloads, QUEUES } from "@klipstack/queue"
import type { JobWithMetadata } from "pg-boss"
import { log } from "../log"

const MINUTE = 60_000
/** How often a healthy feed is fetched. */
export const FETCH_INTERVAL_MS = 60 * MINUTE
/** The longest a failing feed waits between attempts. */
export const MAX_BACKOFF_MS = 24 * 60 * MINUTE
/** How long a feed stays claimed by a queued fetch before the tick may queue it again. */
const CLAIM_MS = 15 * MINUTE

/**
 * Milliseconds until the next fetch: the interval after a success, doubling per consecutive
 * failure up to a day, never sooner than the server's `Retry-After`. ±10% jitter spreads feeds out.
 */
export function nextFetchDelay(
	errorCount: number,
	retryAfterSeconds: number | null = null,
	random = Math.random(),
): number {
	const base =
		errorCount === 0
			? FETCH_INTERVAL_MS
			: Math.min(FETCH_INTERVAL_MS * 2 ** errorCount, MAX_BACKOFF_MS)
	const jittered = Math.round(base * (0.9 + random * 0.2))
	const asked = retryAfterSeconds ? Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS) : 0
	return Math.max(jittered, asked)
}

/**
 * Queues a fetch for every due feed followed by an account with feeds turned on (Settings →
 * Features), claiming each so the next tick skips it.
 */
export async function handleFeedsTick() {
	const due = await db
		.update(feeds)
		.set({ nextFetchAt: new Date(Date.now() + CLAIM_MS) })
		.where(
			and(
				lte(feeds.nextFetchAt, new Date()),
				exists(
					db
						.select({ one: sql`1` })
						.from(subscriptions)
						.innerJoin(user, eq(user.id, subscriptions.userId))
						.where(and(eq(subscriptions.feedId, feeds.id), sql`${user.prefs}->>'feeds' = 'on'`)),
				),
			),
		)
		.returning({ id: feeds.id })
	for (const { id } of due) await enqueue(QUEUES.feedFetch, { feedId: id })
	if (due.length) log.info("feeds: queued", { feeds: due.length })
}

/** Fetches one feed (conditionally), stores new entries, tells subscribers, and reschedules it. */
export async function handleFeedFetch(job: JobWithMetadata<JobPayloads["feed-fetch"]>) {
	const { feedId } = job.data
	const feed = await db.query.feeds.findFirst({ where: eq(feeds.id, feedId) })
	if (!feed) return
	const now = new Date()
	// Already fetched and rescheduled by another job for it (a tick queued it again while a backlog
	// held the first past its claim): nothing to do until then.
	if (feed.nextFetchAt.getTime() > now.getTime() + CLAIM_MS) return
	try {
		const conditional: Record<string, string> = {}
		if (feed.etag) conditional["if-none-match"] = feed.etag
		if (feed.lastModified) conditional["if-modified-since"] = feed.lastModified
		const res = await fetchFeed(feed.url, { headers: conditional })
		let added = 0
		if (res.status === 304) {
			await db.update(feeds).set(success(now)).where(eq(feeds.id, feedId))
		} else {
			const parsed = parseFeedDocument(res.html, res.finalUrl)
			added = await storeFeedEntries(feedId, parsed.entries.map(storable), now)
			await db
				.update(feeds)
				.set({
					...success(now),
					title: parsed.title ?? feed.title,
					siteUrl: parsed.siteUrl ?? feed.siteUrl,
					etag: res.etag,
					lastModified: res.lastModified,
				})
				.where(eq(feeds.id, feedId))
			// An imported feed is followed before its first fetch: name it by the feed from now on,
			// unless the import's name differs.
			if (!feed.lastSuccessAt && parsed.title)
				await db
					.update(subscriptions)
					.set({ title: null })
					.where(and(eq(subscriptions.feedId, feedId), eq(subscriptions.title, parsed.title)))
		}
		if (added > 0) {
			// Whoever followed the feed while it had no items starts at its latest few, like any
			// new subscriber, not at everything this fetch brought.
			await db
				.update(subscriptions)
				.set({ since: await initialSince(feedId) })
				.where(and(eq(subscriptions.feedId, feedId), isNull(subscriptions.since)))
			for (const userId of await feedSubscribers(feedId))
				await notifyDocumentEvent({ userId, kind: "feed" })
		}
		log.info("feeds: fetched", { feedId, status: res.status, added })
	} catch (error) {
		const errorCount = feed.errorCount + 1
		const retryAfter = error instanceof ExtractError ? (error.retryAfter ?? null) : null
		await db
			.update(feeds)
			.set({
				lastFetchedAt: now,
				errorCount,
				lastError: feedErrorFor(error),
				nextFetchAt: new Date(now.getTime() + nextFetchDelay(errorCount, retryAfter)),
			})
			.where(eq(feeds.id, feedId))
		log.warn("feeds: fetch failed", { feedId, errorCount, error: feedErrorFor(error) })
	}
}

function success(now: Date) {
	return {
		lastFetchedAt: now,
		lastSuccessAt: now,
		errorCount: 0,
		lastError: null,
		nextFetchAt: new Date(now.getTime() + nextFetchDelay(0)),
	}
}

export function storable(entry: Omit<StorableFeedEntry, "urlHash">): StorableFeedEntry {
	return { ...entry, urlHash: urlHash(entry.url) }
}

/** A short code for the last error, like documents' failure reasons. */
export function feedErrorFor(error: unknown): string {
	if (error instanceof ExtractError) {
		if (error.code === "http_error" && error.status) return `http_error:${error.status}`
		return error.code
	}
	return "unknown"
}
