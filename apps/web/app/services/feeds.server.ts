import {
	and,
	db,
	eq,
	feedItemDismissals,
	feedItems,
	feeds,
	inArray,
	initialSince,
	sql,
	storeFeedEntries,
	subscriptions,
} from "@klipstack/db"
import {
	buildOpml,
	ExtractError,
	type FeedLink,
	isHttpUrl,
	normalizeUrl,
	parseOpml,
	resolveFeed,
	urlHash,
} from "@klipstack/extract"
import { enqueue, QUEUES } from "@klipstack/queue"
import { AppError } from "~/lib/app-error"
import { checkFeeds, countRefusal, feedsLeft } from "~/lib/limits.server"

/** Consecutive failed fetches after which a feed shows as not updating (about half a day). */
export const FEED_TROUBLE_AFTER = 3
/** Items loaded per feed; the page shows the first few and expands to the rest. */
const ITEMS_PER_FEED = 50
/** Until the first scheduled fetch after subscribing. */
const FIRST_REFRESH_MS = 60 * 60_000
/** Feeds one OPML import takes; the rest of the file is skipped. */
export const OPML_IMPORT_MAX = 500
/** How long an imported feed waits for the fetch queued with it before the tick queues another. */
const IMPORT_CLAIM_MS = 15 * 60_000

const FEED_REFUSALS = {
	invalid_url: "That is not a valid http(s) URL.",
	not_feed: "No feed found at that address.",
	fetch_failed: "The address could not be fetched. Try again later.",
} as const

const refuse = (code: keyof typeof FEED_REFUSALS) => new AppError(code, FEED_REFUSALS[code])

export type SubscribeResult =
	| { kind: "subscribed"; subscriptionId: string; title: string; existing: boolean }
	| { kind: "choices"; links: FeedLink[] }

/**
 * Follow the feed behind what the user pasted (a feed, or a site that links one). A feed another
 * user already follows is reused without fetching. The subscription starts with the feed's latest
 * few items; a site with several feeds returns them to choose from. A new follow needs room under
 * the feed cap (`limit_reached`).
 */
export async function subscribe(userId: string, input: string): Promise<SubscribeResult> {
	if (!isHttpUrl(input)) throw refuse("invalid_url")
	let normalized: string
	try {
		normalized = normalizeUrl(input)
	} catch {
		throw refuse("invalid_url")
	}

	let feed = await db.query.feeds.findFirst({ where: eq(feeds.urlHash, urlHash(normalized)) })
	if (!feed) {
		let resolution: Awaited<ReturnType<typeof resolveFeed>>
		try {
			resolution = await resolveFeed(normalized)
		} catch (error) {
			if (error instanceof ExtractError && error.code === "invalid_url") throw refuse("invalid_url")
			if (error instanceof ExtractError && error.code === "not_feed") throw refuse("not_feed")
			if (error instanceof ExtractError) throw refuse("fetch_failed")
			throw error
		}
		if (resolution.kind === "choices") return resolution
		const url = normalizeUrl(resolution.url)
		const hash = urlHash(url)
		const now = new Date()
		await db
			.insert(feeds)
			.values({
				url,
				urlHash: hash,
				title: resolution.feed.title,
				siteUrl: resolution.feed.siteUrl,
				etag: resolution.page.etag,
				lastModified: resolution.page.lastModified,
				lastFetchedAt: now,
				lastSuccessAt: now,
				nextFetchAt: new Date(now.getTime() + FIRST_REFRESH_MS),
			})
			.onConflictDoNothing()
		feed = await db.query.feeds.findFirst({ where: eq(feeds.urlHash, hash) })
		if (!feed) throw new Error("feed insert returned nothing")
		await storeFeedEntries(
			feed.id,
			resolution.feed.entries.map((e) => ({ ...e, urlHash: urlHash(e.url) })),
			now,
		)
	}

	const existing = await db.query.subscriptions.findFirst({
		where: and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feed.id)),
	})
	if (existing)
		return {
			kind: "subscribed",
			subscriptionId: existing.id,
			title: existing.title ?? feedTitle(feed),
			existing: true,
		}
	await checkFeeds(userId)
	const [created] = await db
		.insert(subscriptions)
		.values({ userId, feedId: feed.id, since: await initialSince(feed.id) })
		.onConflictDoNothing()
		.returning({ id: subscriptions.id })
	const subscriptionId =
		created?.id ??
		(
			await db.query.subscriptions.findFirst({
				where: and(eq(subscriptions.userId, userId), eq(subscriptions.feedId, feed.id)),
			})
		)?.id
	if (!subscriptionId) throw new Error("subscription insert returned nothing")
	return { kind: "subscribed", subscriptionId, title: feedTitle(feed), existing: !created }
}

export interface OpmlImportResult {
	/** Feeds the user follows now and did not before. */
	added: number
	/** Feeds of the file the user followed already. */
	existing: number
	/** Entries left out: not a web address, or past `OPML_IMPORT_MAX`. */
	skipped: number
	/** New feeds of the file left out: the account follows as many as it may. */
	overLimit: number
}

/**
 * Follow every feed of an OPML file. Nothing is fetched here: a feed nobody followed yet is
 * stored by its address alone and its first fetch is queued, so its title, site and posts arrive
 * a moment later (and an address that is no feed shows as not updating). Folders are dropped. The
 * file's name for a feed is kept as the user's own until that first fetch shows it is the feed's.
 * New feeds past the feed cap are left out, in the file's order.
 */
export async function importOpml(userId: string, text: string): Promise<OpmlImportResult> {
	let outlines: ReturnType<typeof parseOpml>
	try {
		outlines = parseOpml(text)
	} catch (error) {
		if (error instanceof ExtractError)
			throw new AppError("not_opml", "That file is not an OPML list of feeds.")
		throw error
	}
	if (outlines.length === 0) throw new AppError("no_feeds", "That OPML file lists no feeds.")

	const wanted = new Map<string, { url: string; title: string | null }>()
	let skipped = 0
	for (const outline of outlines) {
		let url: string | null = null
		if (isHttpUrl(outline.xmlUrl)) {
			try {
				url = normalizeUrl(outline.xmlUrl)
			} catch {
				url = null
			}
		}
		if (!url) skipped++
		else if (wanted.has(urlHash(url))) continue
		else if (wanted.size >= OPML_IMPORT_MAX) skipped++
		else wanted.set(urlHash(url), { url, title: outline.title?.slice(0, 200) ?? null })
	}
	if (wanted.size === 0) return { added: 0, existing: 0, skipped, overLimit: 0 }

	// What the user follows already takes no room; the new ones get what the cap leaves.
	const followed = await db
		.select({ urlHash: feeds.urlHash })
		.from(subscriptions)
		.innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
		.where(and(eq(subscriptions.userId, userId), inArray(feeds.urlHash, [...wanted.keys()])))
	for (const row of followed) wanted.delete(row.urlHash)
	const left = await feedsLeft(userId)
	const overLimit = Math.max(0, wanted.size - left)
	for (const hash of [...wanted.keys()].slice(left)) wanted.delete(hash)
	if (overLimit > 0) await countRefusal(userId)
	if (wanted.size === 0) return { added: 0, existing: followed.length, skipped, overLimit }

	// The shared row takes only the address: a title or site from one user's file would show to
	// everyone else who follows the feed.
	const now = new Date()
	const created = await db
		.insert(feeds)
		.values(
			[...wanted].map(([hash, { url }]) => ({
				url,
				urlHash: hash,
				nextFetchAt: new Date(now.getTime() + IMPORT_CLAIM_MS),
			})),
		)
		.onConflictDoNothing()
		.returning({ id: feeds.id })
	const fresh = new Set(created.map((feed) => feed.id))

	const rows = await db
		.select({ id: feeds.id, urlHash: feeds.urlHash, title: feeds.title })
		.from(feeds)
		.where(inArray(feeds.urlHash, [...wanted.keys()]))
	// One feed at a time: up to 500 at once would take every connection in the pool.
	const values = []
	for (const feed of rows) {
		const title = wanted.get(feed.urlHash)?.title ?? null
		values.push({
			userId,
			feedId: feed.id,
			title: title === feed.title ? null : title,
			since: fresh.has(feed.id) ? null : await initialSince(feed.id),
		})
	}
	const subscribed = await db
		.insert(subscriptions)
		.values(values)
		.onConflictDoNothing()
		.returning({ id: subscriptions.id })

	for (const feedId of fresh) await enqueue(QUEUES.feedFetch, { feedId })
	return {
		added: subscribed.length,
		existing: followed.length + rows.length - subscribed.length,
		skipped,
		overLimit,
	}
}

/** The user's feeds as an OPML file, by title, under the names the user gave them. */
export async function exportOpml(userId: string): Promise<string> {
	const rows = await db
		.select({
			title: subscriptions.title,
			feedTitle: feeds.title,
			url: feeds.url,
			siteUrl: feeds.siteUrl,
		})
		.from(subscriptions)
		.innerJoin(feeds, eq(feeds.id, subscriptions.feedId))
		.where(eq(subscriptions.userId, userId))
	const outlines = rows
		.map((row) => ({
			xmlUrl: row.url,
			title: row.title ?? feedTitle({ title: row.feedTitle, siteUrl: row.siteUrl, url: row.url }),
			htmlUrl: row.siteUrl,
		}))
		.sort((a, b) => a.title.localeCompare(b.title))
	return buildOpml("Klipstack feeds", outlines)
}

export interface FeedListItem {
	id: string
	url: string
	title: string | null
	author: string | null
	excerpt: string | null
	sortAt: Date
	/** When the feed dated it (never later than first seen); null for feeds without dates. */
	publishedAt: Date | null
	isNew: boolean
	/** The user's document for this link, when they saved it (from the feed or any other way). */
	documentId: string | null
	/** `sortAt` to the microsecond, for a cursor. */
	sortKey: string
}

type FeedItemRow = {
	id: string
	subscription_id: string
	url: string
	title: string | null
	author: string | null
	excerpt: string | null
	sort_at: string
	sort_key: string
	dated: boolean
	is_new: boolean
	document_id: string | null
}

function feedListItem(row: FeedItemRow): FeedListItem {
	return {
		id: row.id,
		url: row.url,
		title: row.title,
		author: row.author,
		excerpt: row.excerpt,
		sortAt: new Date(row.sort_at),
		// sort_at is the publish date, clamped to when first seen.
		publishedAt: row.dated ? new Date(row.sort_at) : null,
		isNew: row.is_new,
		documentId: row.document_id,
		sortKey: row.sort_key,
	}
}

/** Home's small discovery selection: new posts, distinct URLs, with different sources first. */
export async function homeFeedItems(userId: string) {
	const result = await db.execute<
		FeedItemRow & {
			source_title: string | null
			feed_title: string | null
			feed_url: string
			site_url: string | null
		}
	>(sql`
		with unique_posts as (
			select distinct on (fi.url_hash) ${visibleItemColumns}, ${sortKeySql} as sort_key
			${visibleItemsFrom(userId)} and ${isNewSql}
			order by fi.url_hash, fi.sort_at desc, fi.id desc
		), ranked as (
			select *, row_number() over (
				partition by subscription_id order by sort_at desc, id desc
			) as source_rank from unique_posts
		)
		select ranked.*, s.title as source_title, f.title as feed_title, f.url as feed_url, f.site_url
		from ranked
		join subscriptions s on s.id = ranked.subscription_id
		join feeds f on f.id = s.feed_id
		order by source_rank, sort_at desc, ranked.id desc
		limit 3
	`)
	return result.rows.map((row) => ({
		item: feedListItem(row),
		source:
			row.source_title ??
			feedTitle({ title: row.feed_title, siteUrl: row.site_url, url: row.feed_url }),
	}))
}

export interface FeedSubscription {
	id: string
	title: string
	siteUrl: string
	trouble: boolean
	lastError: string | null
	lastSuccessAt: Date | null
	/** Publish date of the feed's latest dated item, visible or not. */
	lastPostAt: Date | null
	/** Whether the feed has any items (a quiet feed may just have hidden or undated ones). */
	hasItems: boolean
}

export interface FeedSection extends FeedSubscription {
	items: FeedListItem[]
	/** New items not saved yet. */
	newCount: number
	/** Items after these that match the same filters. */
	moreItems: number
}

/** Where a feed's items continue: after this item, in the page's order. */
export interface FeedItemCursor {
	sortKey: string
	id: string
}

export interface FeedPageOptions {
	/** Only this subscription. */
	subscriptionId?: string
	/** Only new items that are not saved yet. */
	newOnly?: boolean
	/** Items per feed (50 by default). */
	perFeed?: number
	/** Only items after this one (use with `subscriptionId`). */
	after?: FeedItemCursor | null
}

/**
 * The user's feed page: one section per subscription with items to show (newest activity first),
 * and the quiet subscriptions with nothing to show at all. The filters apply before the limit, so
 * `moreItems` counts what is left of them.
 */
export async function listFeedPage(
	userId: string,
	{ subscriptionId, newOnly = false, perFeed = ITEMS_PER_FEED, after = null }: FeedPageOptions = {},
): Promise<{ sections: FeedSection[]; quiet: FeedSubscription[] }> {
	const [subs, counts] = await Promise.all([
		listSubscriptions(userId, subscriptionId),
		countVisibleItems(userId, subscriptionId),
	])
	const items = await db.execute<FeedItemRow & { matching: string }>(sql`
		select * from (
			select ${visibleItemColumns}, ${sortKeySql} as sort_key,
				row_number() over (partition by s.id order by fi.sort_at desc, fi.id desc) as rn,
				count(*) over (partition by s.id) as matching
			${visibleItemsFrom(userId)}
			${subscriptionId ? sql`and s.id = ${subscriptionId}` : sql``}
			${newOnly ? sql`and ${isNewSql} and d.id is null` : sql``}
			${after ? sql`and (fi.sort_at, fi.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)` : sql``}
		) ranked
		where rn <= ${perFeed}
		order by sort_at desc, id desc
	`)

	const bySubscription = new Map<string, FeedListItem[]>()
	const matching = new Map<string, number>()
	for (const row of items.rows) {
		const list = bySubscription.get(row.subscription_id) ?? []
		list.push(feedListItem(row))
		bySubscription.set(row.subscription_id, list)
		matching.set(row.subscription_id, Number(row.matching))
	}

	const sections: FeedSection[] = []
	const quiet: FeedSubscription[] = []
	for (const sub of subs) {
		const list = bySubscription.get(sub.id)
		const count = counts.get(sub.id)
		if (list?.length)
			sections.push({
				...sub,
				items: list,
				newCount: count?.newCount ?? 0,
				moreItems: (matching.get(sub.id) ?? 0) - list.length,
			})
		else if (!count?.visible) quiet.push(sub)
	}
	// Items come newest first, so a section's first item is its latest activity.
	sections.sort((a, b) => (b.items[0]?.sortAt.getTime() ?? 0) - (a.items[0]?.sortAt.getTime() ?? 0))
	quiet.sort((a, b) => a.title.localeCompare(b.title))
	return { sections, quiet }
}

async function listSubscriptions(
	userId: string,
	subscriptionId?: string,
): Promise<FeedSubscription[]> {
	const subs = await db.execute<{
		id: string
		title: string | null
		feed_title: string | null
		site_url: string | null
		url: string
		error_count: number
		last_error: string | null
		last_success_at: string | null
		last_post_at: string | null
		has_items: boolean
	}>(sql`
		select s.id, s.title, f.title as feed_title, f.site_url, f.url, f.error_count, f.last_error,
			f.last_success_at,
			(select max(fi.sort_at) from feed_items fi
				where fi.feed_id = f.id and fi.published_at is not null) as last_post_at,
			exists (select 1 from feed_items fi where fi.feed_id = f.id) as has_items
		from subscriptions s
		join feeds f on f.id = s.feed_id
		where s.user_id = ${userId}
			${subscriptionId ? sql`and s.id = ${subscriptionId}` : sql``}
	`)
	return subs.rows.map((row) => ({
		id: row.id,
		title: row.title ?? feedTitle({ title: row.feed_title, siteUrl: row.site_url, url: row.url }),
		siteUrl: row.site_url ?? row.url,
		trouble: row.error_count >= FEED_TROUBLE_AFTER,
		lastError: row.last_error,
		lastSuccessAt: toDate(row.last_success_at),
		lastPostAt: toDate(row.last_post_at),
		hasItems: row.has_items,
	}))
}

/** Per subscription: the items the user sees, and the new ones not saved yet. */
async function countVisibleItems(userId: string, subscriptionId?: string) {
	const result = await db.execute<{
		subscription_id: string
		visible: string
		new_count: string
	}>(sql`
		select s.id as subscription_id, count(*) as visible,
			count(*) filter (where ${isNewSql} and d.id is null) as new_count
		${visibleItemsFrom(userId)}
		${subscriptionId ? sql`and s.id = ${subscriptionId}` : sql``}
		group by s.id
	`)
	return new Map(
		result.rows.map((row) => [
			row.subscription_id,
			{ visible: Number(row.visible), newCount: Number(row.new_count) },
		]),
	)
}

/** Every followed feed, quiet ones included, by title, with how many new posts it has. */
export async function listFollowedFeeds(
	userId: string,
): Promise<Array<FeedSubscription & { newCount: number }>> {
	const [subs, counts] = await Promise.all([listSubscriptions(userId), countVisibleItems(userId)])
	return subs
		.map((sub) => ({ ...sub, newCount: counts.get(sub.id)?.newCount ?? 0 }))
		.sort((a, b) => a.title.localeCompare(b.title))
}

/** New, unsaved items across the user's feeds (the nav badge). */
export async function countNewFeedItems(userId: string): Promise<number> {
	const result = await db.execute<{ n: string }>(sql`
		select count(*) as n ${visibleItemsFrom(userId)}
		and ${isNewSql} and d.id is null
	`)
	return Number(result.rows[0]?.n ?? 0)
}

/** Explicit bulk acknowledgement for API/MCP clients. Never called just for viewing a page. */
export async function markFeedViewed(userId: string, at: Date): Promise<void> {
	await db.execute(sql`
		insert into feed_item_views (user_id, item_id)
		select s.user_id, fi.id ${visibleItemsFrom(userId)}
		and ${isNewSql} and greatest(fi.first_seen_at, s.created_at) <= ${at}
		on conflict do nothing
	`)
}

/** Record an explicit opening. Only a visible post from the user's subscriptions is eligible. */
export async function markFeedItemViewed(userId: string, itemId: string): Promise<boolean> {
	const result = await db.execute(sql`
		insert into feed_item_views (user_id, item_id)
		select s.user_id, fi.id ${visibleItemsFrom(userId)}
		and fi.id = ${itemId}::uuid
		on conflict (user_id, item_id) do update set viewed_at = feed_item_views.viewed_at
		returning item_id
	`)
	return result.rows.length > 0
}

/** The link of a post in the user's feed; null when the post is not in it. */
export async function feedItemUrl(userId: string, itemId: string): Promise<string | null> {
	const [item] = await db
		.select({ url: feedItems.url })
		.from(feedItems)
		.innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
		.where(and(eq(feedItems.id, itemId), eq(subscriptions.userId, userId)))
		.limit(1)
	return item?.url ?? null
}

/** False when the item is not the user's. */
export async function dismissFeedItem(userId: string, itemId: string): Promise<boolean> {
	const [item] = await db
		.select({ id: feedItems.id })
		.from(feedItems)
		.innerJoin(subscriptions, eq(subscriptions.feedId, feedItems.feedId))
		.where(and(eq(feedItems.id, itemId), eq(subscriptions.userId, userId)))
		.limit(1)
	if (!item) return false
	await db.insert(feedItemDismissals).values({ userId, itemId }).onConflictDoNothing()
	return true
}

/** Undo of a dismissal. False when the post was not dismissed. */
export async function restoreFeedItem(userId: string, itemId: string): Promise<boolean> {
	const rows = await db
		.delete(feedItemDismissals)
		.where(and(eq(feedItemDismissals.userId, userId), eq(feedItemDismissals.itemId, itemId)))
		.returning({ itemId: feedItemDismissals.itemId })
	return rows.length > 0
}

/** An empty title goes back to the feed's own. False when the subscription is not the user's. */
export async function renameSubscription(
	userId: string,
	subscriptionId: string,
	title: string,
): Promise<boolean> {
	const rows = await db
		.update(subscriptions)
		.set({ title: title.trim() || null })
		.where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
		.returning({ id: subscriptions.id })
	return rows.length > 0
}

/**
 * Stops following a feed and forgets its views and dismissals. Saved documents stay. False when
 * the subscription is not the user's.
 */
export async function unsubscribe(userId: string, subscriptionId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [removed] = await tx
			.delete(subscriptions)
			.where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)))
			.returning({ feedId: subscriptions.feedId })
		if (!removed) return false
		await tx.execute(sql`
			delete from feed_item_dismissals x
			using feed_items fi
			where x.item_id = fi.id and x.user_id = ${userId} and fi.feed_id = ${removed.feedId}
		`)
		await tx.execute(sql`
			delete from feed_item_views x
			using feed_items fi
			where x.item_id = fi.id and x.user_id = ${userId} and fi.feed_id = ${removed.feedId}
		`)
		return true
	})
}

/** Raw queries return timestamps as text. */
function toDate(value: string | null): Date | null {
	return value ? new Date(value) : null
}

function feedTitle(feed: { title: string | null; siteUrl: string | null; url: string }): string {
	if (feed.title) return feed.title
	try {
		return new URL(feed.siteUrl ?? feed.url).hostname.replace(/^www\./, "")
	} catch {
		return feed.url
	}
}

// A shared feed can predate this subscription: its initial posts get a full discovery window.
// Expiry only removes the marker; it never hides the post or changes Library reading progress.
const isNewSql = sql`(d.id is null
	and greatest(fi.first_seen_at, s.created_at) > now() - interval '14 days'
	and not exists (
		select 1 from feed_item_views v where v.user_id = s.user_id and v.item_id = fi.id
	))`

const sortKeySql = sql`to_char(fi.sort_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const visibleItemColumns = sql`fi.id, s.id as subscription_id, fi.url, fi.title, fi.author,
	fi.excerpt, fi.sort_at, fi.published_at is not null as dated, ${isNewSql} as is_new, d.id as document_id`

/**
 * Items a user sees: from feeds they follow, sorted from the subscription's start on, not
 * dismissed. Joins the matching saved document. (A post backdated before the start stays hidden.)
 */
function visibleItemsFrom(userId: string) {
	return sql`
		from subscriptions s
		join feed_items fi on fi.feed_id = s.feed_id
		left join lateral (
			select id from documents
			where user_id = s.user_id and url_hash = fi.url_hash and deleted_at is null
			limit 1
		) d on true
		where s.user_id = ${userId}
			and (s.since is null or fi.sort_at >= s.since)
			and not exists (
				select 1 from feed_item_dismissals x where x.user_id = s.user_id and x.item_id = fi.id
			)
	`
}
