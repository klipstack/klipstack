import { gunzipSync, gzipSync } from "node:zlib"
import { and, db, desc, documentRaw, documents, eq, notifyDocumentEvent, sql } from "@klipstack/db"
import {
	ExtractError,
	type ExtractErrorCode,
	extractCapture,
	extractXPost,
	fetchPage,
	fetchXPost,
	parseXStatusUrl,
	X_RAW_CONTENT_TYPE,
} from "@klipstack/extract"
import { admitImages, type JobPayloads } from "@klipstack/queue"
import type { JobWithMetadata } from "pg-boss"
import { log } from "../log"
import { publishExtraction } from "../publish"
import { absorbSharedPosts, notifyJoined, saveSharedArticle } from "../shared-via"
import { queueTopicsAfterSave } from "./topics"

/** Errors that will not get better by retrying. */
const PERMANENT: ReadonlySet<ExtractErrorCode> = new Set([
	"invalid_url",
	"blocked_host",
	"not_html",
	"no_content",
	// The wall stays up for the server's address; the owner's Retry asks again.
	"bot_check",
	"too_large",
	"too_many_redirects",
])

export function failureReasonFor(error: unknown): string {
	if (error instanceof ExtractError) {
		if (error.code === "http_error" && error.status) return `http_error:${error.status}`
		return error.code
	}
	return "unknown"
}

export function isPermanentFailure(error: unknown): boolean {
	if (!(error instanceof ExtractError)) return false
	if (PERMANENT.has(error.code)) return true
	if (
		error.code === "http_error" &&
		error.status &&
		error.status < 500 &&
		error.status !== 429 &&
		error.status !== 408
	)
		return true
	return false
}

export async function handleExtract(job: JobWithMetadata<JobPayloads["extract"]>) {
	const { documentId } = job.data
	const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) })
	if (!doc || doc.deletedAt) {
		log.warn("extract: document missing or deleted", { documentId })
		return
	}
	await db
		.update(documents)
		.set({ status: "processing", failureReason: null })
		.where(eq(documents.id, documentId))

	try {
		let raw = await db.query.documentRaw.findFirst({
			where: eq(documentRaw.documentId, documentId),
			orderBy: desc(documentRaw.fetchedAt),
		})
		if (!raw && parseXStatusUrl(doc.sourceUrl)) {
			const post = await fetchXPost(doc.sourceUrl)
			if (!post.threadComplete)
				log.warn("extract: X thread lookup kept failing, saving the first post only", {
					documentId,
				})
			const [inserted] = await db
				.insert(documentRaw)
				.values({
					documentId,
					rawHtml: gzipSync(Buffer.from(post.json, "utf8")),
					finalUrl: doc.sourceUrl,
					httpStatus: post.status,
					contentType: X_RAW_CONTENT_TYPE,
					source: "fetch",
				})
				.returning()
			raw = inserted
		}
		if (!raw) {
			const page = await fetchPage(doc.fetchUrl ?? doc.sourceUrl)
			const [inserted] = await db
				.insert(documentRaw)
				.values({
					documentId,
					rawHtml: gzipSync(Buffer.from(page.html, "utf8")),
					finalUrl: page.finalUrl,
					httpStatus: page.status,
					contentType: page.contentType,
					source: "fetch",
				})
				.returning()
			raw = inserted
		}
		if (!raw) throw new Error("raw capture missing after insert")

		// `rawHtml` holds the API JSON for posts on X.
		const body = gunzipSync(raw.rawHtml).toString("utf8")
		const url = raw.finalUrl ?? doc.sourceUrl
		const servedHtml = raw.servedHtml ? gunzipSync(raw.servedHtml).toString("utf8") : null
		const { article, used } =
			raw.contentType === X_RAW_CONTENT_TYPE
				? { article: extractXPost(body, url), used: "rendered" as const }
				: await extractCapture({ html: body, servedHtml, url })
		// A post that only passes a link along: the linked article is saved in its place.
		if (await saveSharedArticle(doc, raw, article, url)) return

		const published = await db.transaction(async (tx) => {
			const versionId = await publishExtraction(tx, doc, raw.id, article, url)
			if (!versionId) return null
			// The capture keeps the page the version came from, and not the other one.
			if (raw.servedHtml)
				await tx
					.update(documentRaw)
					.set({ servedHtml: null, ...(used === "served" ? { rawHtml: raw.servedHtml } : {}) })
					.where(eq(documentRaw.id, raw.id))
			// The image job exists only if this version does: same transaction, shared admission.
			await admitImages(tx, versionId)
			// Posts kept because this article couldn't be opened from them join it now.
			return { absorbed: await absorbSharedPosts(tx, doc) }
		})
		if (!published) {
			log.info("extract: skipped, a newer capture or a deletion came first", { documentId })
			return
		}

		await notifyDocumentEvent({ userId: doc.userId, documentId, kind: "ready" })
		await notifyJoined(doc.userId, published.absorbed, documentId)
		await queueTopicsAfterSave(doc.userId)
		log.info("extract: ready", {
			documentId,
			extractor: article.extractor.name,
			words: article.wordCount,
			...(raw.servedHtml ? { used } : {}),
		})
	} catch (error) {
		const reason = failureReasonFor(error)
		const exhausted = job.retryCount >= job.retryLimit
		const final = isPermanentFailure(error) || exhausted
		// Only while the status is still the one this job set: a capture saved meanwhile was admitted
		// its own job, which owns the status now (and may have published already). An article with a
		// readable version stays readable; the failed attempt is only noted.
		const [after] = await db
			.update(documents)
			.set({
				status: sql`case when ${documents.currentVersionId} is null then ${final ? "failed" : "queued"} else 'ready' end`,
				failureReason: reason,
			})
			.where(and(eq(documents.id, documentId), eq(documents.status, "processing")))
			.returning({ status: documents.status })
		if (final) {
			log.warn("extract: failed", {
				documentId,
				reason,
				exhausted,
				kept: after?.status === "ready",
				error,
			})
			if (after)
				await notifyDocumentEvent({
					userId: doc.userId,
					documentId,
					kind: after.status === "failed" ? "failed" : "ready",
				})
			return
		}
		log.warn("extract: transient failure, will retry", {
			documentId,
			reason,
			attempt: job.retryCount + 1,
			error,
		})
		throw error
	}
}
