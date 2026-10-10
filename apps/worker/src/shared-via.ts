import { gzipSync } from "node:zlib"
import {
	and,
	db,
	desc,
	type Document,
	type DocumentRaw,
	documentRaw,
	documents,
	documentTags,
	documentVersions,
	documentVia,
	eq,
	highlights,
	isNull,
	ne,
	notExists,
	notifyDocumentEvent,
	sql,
	type Tx,
} from "@klipstack/db"
import {
	type ExtractedArticle,
	extractArticle,
	fetchPage,
	normalizeUrl,
	parseXStatusUrl,
	sharedLink,
	sharedPostHtml,
	unsupportedReason,
	urlHash,
} from "@klipstack/extract"
import { describeError, loggedHost } from "@klipstack/log"
import { admitImages } from "@klipstack/queue"
import { log } from "./log"
import { publishExtraction } from "./publish"

type Via = Omit<typeof documentVia.$inferInsert, "documentId">

/**
 * Saving a short post that only passes a link along saves the linked article instead, and keeps
 * the post with it. Only on a document's first extraction: a document with a readable version stays
 * what it is, which is how "read the post instead" sticks.
 *
 * True when this handled the document: the article was published in its place, it joined the
 * same article saved before, or the document changed meanwhile. False to publish the post as is:
 * it shares nothing, or the linked page can't be read. A link that can't be read is kept on the
 * document, so saving that article later (from the browser) takes the post along.
 */
export async function saveSharedArticle(
	doc: Document,
	postRaw: DocumentRaw,
	post: ExtractedArticle,
	postUrl: string,
): Promise<boolean> {
	if (doc.currentVersionId) return false
	const link = sharedLink(post, postUrl)
	if (!link) return false
	let normalized: string
	try {
		normalized = normalizeUrl(link)
	} catch {
		return false
	}
	// Pages the generic fetch can't read: they'd only fail in the post's place.
	if (unsupportedReason(normalized) || parseXStatusUrl(normalized)) return false

	const hash = urlHash(normalized)
	const via: Via = {
		userId: doc.userId,
		url: doc.sourceUrl,
		urlHash: doc.urlHash,
		author: post.author,
		siteName: post.siteName,
		html: sharedPostHtml(post.html),
		publishedAt: post.publishedAt,
	}

	// Already in the library: the post joins it, and nothing is fetched. Sites that refuse servers
	// (theatlantic.com answers 403) still work when the article came from the browser.
	let fetched: { page: Awaited<ReturnType<typeof fetchPage>>; article: ExtractedArticle } | null =
		null
	if (!(await earlierArticle(db, doc, hash))) {
		try {
			const page = await fetchPage(link)
			fetched = { page, article: await extractArticle({ html: page.html, url: page.finalUrl }) }
		} catch (error) {
			log.info("extract: shared page unreadable, saving the post", {
				documentId: doc.id,
				host: loggedHost(link),
				error: describeError(error),
			})
			await db
				.update(documents)
				.set({ sharedUrl: link, sharedUrlHash: hash })
				.where(eq(documents.id, doc.id))
			return false
		}
	}

	const asSaved = new URL(link)
	asSaved.hash = ""
	const outcome = await db.transaction(async (tx) => {
		const [live] = await tx
			.select({ deletedAt: documents.deletedAt, currentVersionId: documents.currentVersionId })
			.from(documents)
			.where(eq(documents.id, doc.id))
			.for("update")
		if (!live || live.deletedAt) return { kind: "gone" as const }
		// A capture saved meanwhile was admitted its own job, which reads it.
		const [newest] = await tx
			.select({ id: documentRaw.id })
			.from(documentRaw)
			.where(eq(documentRaw.documentId, doc.id))
			.orderBy(desc(documentRaw.fetchedAt))
			.limit(1)
		if (live.currentVersionId || newest?.id !== postRaw.id) return { kind: "gone" as const }

		const earlier = await earlierArticle(tx, doc, hash)
		if (earlier) {
			await joinArticle(tx, doc.id, earlier.id, via)
			return { kind: "joined" as const, documentId: earlier.id }
		}
		// The article saved before went meanwhile, and nothing was fetched: the post stays.
		if (!fetched) return { kind: "kept" as const }

		const { page, article } = fetched
		const [raw] = await tx
			.insert(documentRaw)
			.values({
				documentId: doc.id,
				rawHtml: gzipSync(Buffer.from(page.html, "utf8")),
				finalUrl: page.finalUrl,
				httpStatus: page.status,
				contentType: page.contentType,
				source: "fetch",
			})
			.returning({ id: documentRaw.id })
		if (!raw) throw new Error("raw insert returned nothing")
		await tx
			.update(documents)
			.set({ sourceUrl: normalized, fetchUrl: asSaved.href, urlHash: hash })
			.where(eq(documents.id, doc.id))
		await tx.insert(documentVia).values({ ...via, documentId: doc.id, rawId: postRaw.id })
		const target = { id: doc.id, userId: doc.userId, urlHash: hash }
		const versionId = await publishExtraction(tx, target, raw.id, article, page.finalUrl)
		if (!versionId) throw new Error("shared article was not published")
		await admitImages(tx, versionId)
		const absorbed = await absorbSharedPosts(tx, target)
		return { kind: "published" as const, absorbed, words: article.wordCount }
	})

	if (outcome.kind === "kept") return false
	if (outcome.kind === "gone") {
		log.info("extract: skipped, a newer capture or a deletion came first", { documentId: doc.id })
		return true
	}
	if (outcome.kind === "joined") {
		// The new save is gone: its readers reload and land on the article (`savedAs`).
		await notifyJoined(doc.userId, [doc.id], outcome.documentId)
		log.info("extract: shared post joined an article saved before", {
			documentId: doc.id,
			into: outcome.documentId,
		})
		return true
	}
	await notifyDocumentEvent({ userId: doc.userId, documentId: doc.id, kind: "ready" })
	await notifyJoined(doc.userId, outcome.absorbed, doc.id)
	log.info("extract: ready, the article a post shared", {
		documentId: doc.id,
		words: outcome.words,
	})
	return true
}

/** The user's live article at this address, other than `doc`. */
async function earlierArticle(tx: Tx | typeof db, doc: Document, hash: string) {
	const [row] = await tx
		.select({ id: documents.id })
		.from(documents)
		.where(
			and(
				eq(documents.userId, doc.userId),
				eq(documents.urlHash, hash),
				isNull(documents.deletedAt),
				ne(documents.id, doc.id),
			),
		)
		.limit(1)
	return row ?? null
}

/** The post saved as `postId` joins the article: kept on it, its tags moved, the save removed. */
async function joinArticle(tx: Tx, postId: string, articleId: string, via: Via) {
	await tx
		.insert(documentVia)
		.values({ ...via, documentId: articleId, rawId: null, savedAs: postId })
		.onConflictDoNothing()
	await tx.execute(sql`
		insert into ${documentTags} (document_id, tag_id)
		select ${articleId}, tag_id from ${documentTags} where document_id = ${postId}
		on conflict do nothing`)
	await tx.delete(documents).where(eq(documents.id, postId))
}

/**
 * Posts kept because the link they share couldn't be opened, now that the article is in the
 * library (saved from the browser, say): they join it. Only posts with nothing of the user's on
 * them (no note, no highlights), which removing them would lose. Their ids.
 */
export async function absorbSharedPosts(
	tx: Tx,
	article: { id: string; userId: string; urlHash: string },
): Promise<string[]> {
	const posts = await tx
		.select({
			id: documents.id,
			sourceUrl: documents.sourceUrl,
			urlHash: documents.urlHash,
			author: documents.author,
			siteName: documents.siteName,
			publishedAt: documents.publishedAt,
			html: documentVersions.html,
		})
		.from(documents)
		.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
		.where(
			and(
				eq(documents.userId, article.userId),
				eq(documents.sharedUrlHash, article.urlHash),
				isNull(documents.deletedAt),
				ne(documents.id, article.id),
				isNull(documents.note),
				notExists(
					tx
						.select({ id: highlights.id })
						.from(highlights)
						.where(and(eq(highlights.documentId, documents.id), isNull(highlights.deletedAt))),
				),
			),
		)
		.for("update", { of: documents })
	for (const post of posts)
		await joinArticle(tx, post.id, article.id, {
			userId: article.userId,
			url: post.sourceUrl,
			urlHash: post.urlHash,
			author: post.author,
			siteName: post.siteName,
			html: sharedPostHtml(post.html),
			publishedAt: post.publishedAt,
		})
	return posts.map((post) => post.id)
}

/** Saves that joined an article are gone: their readers reload and land on it (`savedAs`). */
export async function notifyJoined(userId: string, postIds: string[], articleId: string) {
	if (postIds.length === 0) return
	for (const documentId of postIds) await notifyDocumentEvent({ userId, documentId, kind: "ready" })
	await notifyDocumentEvent({ userId, documentId: articleId, kind: "ready" })
}
