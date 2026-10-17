import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import {
	aiThreads,
	and,
	assets,
	db,
	documents,
	eq,
	highlights,
	INITIAL_ITEMS,
	inArray,
	lt,
	or,
	sql,
} from "@klipstack/db"
import { FAILED_RETENTION_DAYS } from "@klipstack/queue"
import { getStorage } from "@klipstack/storage"
import { log } from "../log"

/** Days a feed item stays (by its date) before the purge removes it. */
const FEED_ITEM_RETENTION_DAYS = 60
/** Days a feed with no subscribers is kept, in case someone follows it again. */
const UNFOLLOWED_FEED_DAYS = 7

/**
 * Daily: hard-delete documents, highlights and AI threads trashed longer than the retention period
 * (cascades take versions, raw captures, tags), then remove image files nothing references.
 * Assets are deduplicated per user, so a file goes only when no remaining article uses it.
 */
export async function handlePurge() {
	const trash = await purgeTrash()
	const orphans = await purgeOrphanAssets()
	const feedStats = await purgeFeeds()
	const adminStats = await purgeAdminRecords()
	const signIns = await purgeExpiredSignIns()
	log.info("purge: done", { ...trash, assets: orphans, ...feedStats, ...adminStats, ...signIns })
}

/**
 * Only these users' rows, when given. The daily job passes none; tests pass their own users, so a
 * test run never purges anyone else's data in a shared database.
 */
type Owners = string[] | undefined

/** Documents, highlights and AI threads past their time in the trash. */
export async function purgeTrash(
	owners?: Owners,
): Promise<{ documents: number; highlights: number; aiThreads: number }> {
	const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000)
	// A failed capture has no content to lose, only its URL: it goes sooner.
	const failedCutoff = new Date(Date.now() - FAILED_RETENTION_DAYS * 86_400_000)
	const docs = await db
		.delete(documents)
		.where(
			and(
				owners ? inArray(documents.userId, owners) : undefined,
				or(
					lt(documents.deletedAt, cutoff),
					and(eq(documents.status, "failed"), lt(documents.deletedAt, failedCutoff)),
				),
			),
		)
		.returning({ id: documents.id })
	const hls = await db
		.delete(highlights)
		.where(
			and(
				owners ? inArray(highlights.userId, owners) : undefined,
				lt(highlights.deletedAt, cutoff),
			),
		)
		.returning({ id: highlights.id })
	const threads = await db
		.delete(aiThreads)
		.where(
			and(owners ? inArray(aiThreads.userId, owners) : undefined, lt(aiThreads.deletedAt, cutoff)),
		)
		.returning({ id: aiThreads.id })
	return { documents: docs.length, highlights: hls.length, aiThreads: threads.length }
}

/** Days an admin audit event is kept. */
export const AUDIT_RETENTION_DAYS = 90
/** Days a worker's last heartbeat row is kept after the process has gone. */
export const HEARTBEAT_RETENTION_DAYS = 7

/** Old audit events and the heartbeat rows of workers long gone, by the database's clock. */
export async function purgeAdminRecords(): Promise<{ auditEvents: number; heartbeats: number }> {
	const events = await db.execute(sql`
		delete from admin_audit_events
		where created_at < now() - ${AUDIT_RETENTION_DAYS} * interval '1 day'
	`)
	const beats = await db.execute(sql`
		delete from worker_heartbeats
		where last_seen_at < now() - ${HEARTBEAT_RETENTION_DAYS} * interval '1 day'
	`)
	return { auditEvents: events.rowCount ?? 0, heartbeats: beats.rowCount ?? 0 }
}

/**
 * Sign-ins past their expiry, with the IP address and browser they keep, and expired one-time
 * tokens (sign-in links, email checks, OAuth state), by the database's clock. Better Auth already
 * refuses both; the app answers a missing link as it answers an expired one.
 */
export async function purgeExpiredSignIns(): Promise<{ sessions: number; verifications: number }> {
	const sessions = await db.execute(sql`delete from session where expires_at < now()`)
	const verifications = await db.execute(sql`delete from verification where expires_at < now()`)
	return { sessions: sessions.rowCount ?? 0, verifications: verifications.rowCount ?? 0 }
}

/**
 * Feed items older than the retention period go once the feed stops listing them (else the next
 * fetch would bring them back as new), except each feed's latest few (what a new subscriber sees).
 * Feeds nobody has followed for a week go with their items.
 */
export async function purgeFeeds(
	/** Only these feeds, when given: as `Owners`, for tests. */
	only?: string[],
): Promise<{ feedItems: number; feeds: number }> {
	if (only?.length === 0) return { feedItems: 0, feeds: 0 }
	const itemCutoff = new Date(Date.now() - FEED_ITEM_RETENTION_DAYS * 86_400_000)
	const items = await db.execute(sql`
		delete from feed_items fi
		where fi.sort_at < ${itemCutoff} ${only ? sql`and fi.feed_id in ${only}` : sql``}
			and fi.last_seen_at < (select max(last_seen_at) from feed_items latest where latest.feed_id = fi.feed_id)
			and fi.id not in (
				select id from (
					select id, row_number() over (partition by feed_id order by sort_at desc) as rn
					from feed_items
				) ranked
				where rn <= ${INITIAL_ITEMS}
			)
	`)
	const feedCutoff = new Date(Date.now() - UNFOLLOWED_FEED_DAYS * 86_400_000)
	const gone = await db.execute(sql`
		delete from feeds f
		where coalesce(f.last_fetched_at, f.created_at) < ${feedCutoff} ${only ? sql`and f.id in ${only}` : sql``}
			and not exists (select 1 from subscriptions s where s.feed_id = f.id)
	`)
	return { feedItems: items.rowCount ?? 0, feeds: gone.rowCount ?? 0 }
}

/** How article HTML points at a stored image: `/assets/<id>`. */
const ASSET_IN_HTML = "/assets/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"

/**
 * Image rows/files no document of their owner references any more (lead image or article HTML,
 * any version, trashed articles included). The HTML is read once per run for the ids it names; a
 * `like` per image would read all of its owner's HTML again for every image they have.
 */
export async function purgeOrphanAssets(owners?: Owners): Promise<number> {
	const storage = getStorage()
	const stale = new Date(Date.now() - 86_400_000) // leave in-flight image jobs alone
	const scope = owners ? sql`and a.user_id in ${owners}` : sql``
	if (owners?.length === 0) return 0
	const { rows: orphaned } = await db.execute<{ id: string; storageKey: string }>(sql`
		with candidates as (
			select a.id, a.user_id, a.storage_key
			from ${assets} a
			where a.created_at < ${stale} ${scope}
				and not exists (
					select 1 from ${documents} d where d.user_id = a.user_id and d.lead_image_asset_id = a.id
				)
		),
		referenced as (
			select distinct d.user_id, m[1]::uuid as id
			from document_versions v
			join ${documents} d on d.id = v.document_id
			cross join lateral regexp_matches(v.html, ${ASSET_IN_HTML}, 'g') m
			where d.user_id in (select user_id from candidates)
		)
		select c.id, c.storage_key as "storageKey"
		from candidates c
		where not exists (select 1 from referenced r where r.user_id = c.user_id and r.id = c.id)
	`)
	let removed = 0
	for (const asset of orphaned) {
		// Used again since it was listed (an image job found the same picture): it stays.
		const [still] = await db
			.select({ id: assets.id })
			.from(assets)
			.where(and(eq(assets.id, asset.id), lt(assets.createdAt, stale)))
		if (!still) continue
		try {
			await storage.delete(asset.storageKey)
		} catch (error) {
			// The row stays, so tomorrow's purge tries again: without it nothing would find the file.
			log.warn("purge: could not delete file", { key: asset.storageKey, error })
			continue
		}
		await db.delete(assets).where(eq(assets.id, asset.id))
		removed++
	}
	return removed
}
