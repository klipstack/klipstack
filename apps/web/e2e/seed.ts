import { createHash } from "node:crypto"
import {
	assets,
	db,
	documents,
	documentVersions,
	eq,
	feeds,
	storeFeedEntries,
	subscriptions,
	user,
} from "@klipstack/db"
import { getStorage } from "@klipstack/storage"
import sharp from "sharp"

/** Data the app cannot make in tests (feeds, stored images), written the way the worker would. */

/** Same as @klipstack/extract's (which loads jsdom, too heavy for the test runner). */
export const urlHash = (url: string) => createHash("sha256").update(url).digest("hex")

/**
 * Feeds straight in the database (the app cannot fetch test servers): a followed feed with three
 * posts, a followed quiet feed, and a known feed the user does not follow yet.
 */
export async function seedFeeds(email: string) {
	const row = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (!row) throw new Error("no user")
	const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`
	const url = (name: string) => `https://${name}-${stamp}.example.com/feed`
	const [busy, quiet] = await db
		.insert(feeds)
		.values([
			{ url: url("busy"), urlHash: urlHash(url("busy")), title: "Busy blog" },
			{ url: url("quiet"), urlHash: urlHash(url("quiet")), title: "Quiet blog", errorCount: 5 },
			{ url: url("other"), urlHash: urlHash(url("other")), title: "Other blog" },
		])
		.returning({ id: feeds.id })
	const hour = 3_600_000
	// These follows and arrivals predate the API visit. Explicit past dates avoid a race between
	// PostgreSQL's clock (in Docker) and the app clock when acknowledging the listed posts.
	const arrivedAt = new Date(Date.now() - 60_000)
	const followedAt = new Date(arrivedAt.getTime() - 60_000)
	await storeFeedEntries(
		busy!.id,
		[1, 2, 3].map((i) => {
			const post = `https://example.com/busy-${stamp}/${i}`
			return {
				guid: `${i}`,
				url: post,
				urlHash: urlHash(post),
				title: `Busy post ${i}`,
				author: "Ann",
				excerpt: `What post ${i} is about.`,
				publishedAt: new Date(Date.now() - (4 - i) * hour),
			}
		}),
		arrivedAt,
	)
	await db.insert(subscriptions).values([
		{ userId: row.id, feedId: busy!.id, createdAt: followedAt },
		{ userId: row.id, feedId: quiet!.id, createdAt: followedAt },
	])
	return { otherUrl: url("other") }
}

/** An extracted article straight in the database, with this HTML as its current version. */
export async function insertArticle(
	userId: string,
	title: string,
	html: string,
	imagesDone = true,
) {
	const url = `https://example.com/${title.toLowerCase()}-${Date.now()}${Math.random()}`
	const [doc] = await db
		.insert(documents)
		.values({ userId, sourceUrl: url, urlHash: urlHash(url), title, status: "ready" })
		.returning({ id: documents.id })
	const [version] = await db
		.insert(documentVersions)
		.values({
			documentId: doc!.id,
			version: 1,
			html,
			text: title,
			textHash: urlHash(html),
			extractor: "e2e",
			extractorVersion: "1",
			imagesDone,
		})
		.returning({ id: documentVersions.id })
	await db.update(documents).set({ currentVersionId: version!.id }).where(eq(documents.id, doc!.id))
	return doc!.id
}

/** A stored image of the user's, as the worker leaves it: a WebP in storage plus its asset row. */
export async function storeImage(
	userId: string,
	width: number,
	height: number,
	background: string,
) {
	const data = await sharp({ create: { width, height, channels: 3, background } })
		.webp()
		.toBuffer()
	const sha256 = createHash("sha256").update(data).digest("hex")
	const storageKey = `u/${userId}/${sha256.slice(0, 2)}/${sha256}.webp`
	await getStorage().put(storageKey, data, "image/webp")
	const [asset] = await db
		.insert(assets)
		.values({
			userId,
			sha256,
			storageKey,
			contentType: "image/webp",
			width,
			height,
			bytes: data.length,
		})
		.returning({ id: assets.id })
	return { id: asset!.id, data }
}
