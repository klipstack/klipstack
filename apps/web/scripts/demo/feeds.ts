import {
	db,
	eq,
	feeds,
	feedItems,
	feedItemDismissals,
	feedItemViews,
	subscriptions,
	sortDate,
} from "@klipstack/db"
import { urlHash } from "@klipstack/extract"
import { hash } from "./cache"
import { demoEntries, type PreparedFeed } from "./feed-cache"
import type { State } from "./local"

const DAY = 86_400_000
export const snapshotUrl = (state: State, url: string) =>
	`https://feeds.demo.klipstack.test/${state.userId}/${hash(url)}`

/** These IDs belong to the fixture, never to the shared rows used by real subscriptions. */
export async function assertFeedOwnership(state: State) {
	for (const [url, entry] of Object.entries(state.feeds)) {
		const feed = await db.query.feeds.findFirst({ where: eq(feeds.id, entry.id) })
		if (!feed) continue
		if (feed.url !== snapshotUrl(state, url) || feed.urlHash !== urlHash(feed.url))
			throw new Error("Demo feed ownership mismatch")
		const subs = await db.select().from(subscriptions).where(eq(subscriptions.feedId, entry.id))
		if (subs.some((sub) => sub.userId !== state.userId))
			throw new Error("Another account follows a demo snapshot; refusing to change it")
	}
}

export async function removeDemoFeeds(state: State) {
	await assertFeedOwnership(state)
	for (const entry of Object.values(state.feeds))
		await db.delete(feeds).where(eq(feeds.id, entry.id))
}

export function feedPlan(state: State, item: PreparedFeed) {
	const capturedAt = new Date(item.capture.capturedAt)
	const base = Date.parse(state.date) + (+capturedAt % DAY)
	const quiet = new URL(item.capture.url).hostname === "apiad.substack.com"
	return {
		createdAt: new Date(base - 4 * 3_600_000),
		entries: demoEntries(item.feed).map((entry, i, entries) => ({
			...entry,
			urlHash: urlHash(entry.url),
			sortAt: sortDate(entry.publishedAt, capturedAt, i),
			firstSeenAt: new Date(base - (i < 2 ? 1 : 3) * 3_600_000),
			lastSeenAt: capturedAt,
			dismissed: quiet || (entries.length > 3 && i === entries.length - 1),
			viewed: i >= 2,
		})),
	}
}

/** One transaction per snapshot makes interrupted seeding safe to resume. */
export async function seedFeed(state: State, item: PreparedFeed) {
	const record = state.feeds[item.capture.url]!
	const plan = feedPlan(state, item)
	const url = snapshotUrl(state, item.capture.url)
	await db.transaction(async (tx) => {
		const existing = await tx.query.feeds.findFirst({ where: eq(feeds.id, record.id) })
		if (existing) {
			if (existing.url !== url) throw new Error("Demo feed ownership mismatch")
			return
		}
		await tx.insert(feeds).values({
			id: record.id,
			url,
			urlHash: urlHash(url),
			title: item.feed.title,
			siteUrl: item.feed.siteUrl ?? new URL(item.capture.page.finalUrl).origin,
			lastFetchedAt: new Date(item.capture.capturedAt),
			lastSuccessAt: new Date(item.capture.capturedAt),
			// A snapshot is deliberately outside the worker's polling schedule.
			nextFetchAt: new Date("9999-01-01T00:00:00Z"),
			createdAt: plan.createdAt,
		})
		await tx.insert(subscriptions).values({
			userId: state.userId,
			feedId: record.id,
			since: plan.entries.at(-1)?.sortAt ?? null,
			createdAt: plan.createdAt,
		})
		for (const { dismissed, viewed, ...entry } of plan.entries) {
			const [inserted] = await tx
				.insert(feedItems)
				.values({ ...entry, feedId: record.id })
				.returning({ id: feedItems.id })
			if (dismissed)
				await tx
					.insert(feedItemDismissals)
					.values({ userId: state.userId, itemId: inserted!.id, dismissedAt: plan.createdAt })
			if (viewed)
				await tx.insert(feedItemViews).values({
					userId: state.userId,
					itemId: inserted!.id,
					viewedAt: new Date(+entry.firstSeenAt + 3_600_000),
				})
		}
	})
}

/** Fingerprint the actual stored snapshot and per-user state, independently of generated IDs. */
export async function verifyFeeds(state: State) {
	await assertFeedOwnership(state)
	const semantic = []
	let items = 0,
		dismissed = 0
	for (const [url, record] of Object.entries(state.feeds).sort(([a], [b]) => a.localeCompare(b))) {
		const feed = await db.query.feeds.findFirst({ where: eq(feeds.id, record.id) })
		if (!record.complete || !feed || feed.nextFetchAt.getUTCFullYear() !== 9999)
			throw new Error(`Demo feed missing, incomplete, or polling enabled: ${url}`)
		const subs = await db.select().from(subscriptions).where(eq(subscriptions.feedId, record.id))
		if (subs.length !== 1 || subs[0]!.userId !== state.userId)
			throw new Error(`Demo subscription missing: ${url}`)
		const rows = await db.select().from(feedItems).where(eq(feedItems.feedId, record.id))
		const dismissals = await db
			.select()
			.from(feedItemDismissals)
			.where(eq(feedItemDismissals.userId, state.userId))
		const hidden = new Set(dismissals.map((row) => row.itemId))
		const views = await db
			.select()
			.from(feedItemViews)
			.where(eq(feedItemViews.userId, state.userId))
		const seen = new Map(views.map((row) => [row.itemId, row.viewedAt]))
		items += rows.length
		dismissed += rows.filter((row) => hidden.has(row.id)).length
		semantic.push({
			url,
			title: feed.title,
			since: subs[0]!.since,
			createdAt: subs[0]!.createdAt,
			entries: rows
				.sort((a, b) => a.guid.localeCompare(b.guid))
				.map(({ id, feedId: _feedId, ...entry }) => ({
					...entry,
					dismissed: hidden.has(id),
					viewedAt: seen.get(id) ?? null,
				})),
		})
	}
	return { subscriptions: semantic.length, items, dismissed, semantic }
}
