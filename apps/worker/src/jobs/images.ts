import { canonicalText } from "@klipstack/anchor"
import { db, documents, documentVersions, eq, notifyDocumentEvent, type Tx } from "@klipstack/db"
import { loggedHost } from "@klipstack/log"
import type { JobPayloads } from "@klipstack/queue"
import { JSDOM } from "jsdom"
import type { JobWithMetadata } from "pg-boss"
import { ingestImage as ingestImageFromNetwork } from "../images"
import { log } from "../log"

const MAX_IMAGES_PER_ARTICLE = 60
const ARTICLE_MAX_WIDTH = 1600
const LEAD_MAX_WIDTH = 640
const CONCURRENCY = 4

/** Why a job left the article alone. Safe to show: no content, URL or error text. */
export type ImagesSkipReason = "missing" | "trashed" | "superseded" | "already_done"
export type ImagesOutcome =
	| { outcome: "completed" }
	| { outcome: "skipped"; reason: ImagesSkipReason }

/** Replaceable in tests: a delayed download, without loosening the real fetch's SSRF guards. */
export interface ImagesDeps {
	ingestImage: typeof ingestImageFromNetwork
}

/**
 * May this version's images be worked on or published? Only while its document is live, it is
 * still the current version, and its images are not done. `lock` takes the document row, which
 * extraction (a new current version), trashing and deletion all have to take as well.
 */
async function eligibility(
	tx: Tx | typeof db,
	versionId: string,
	lock: boolean,
): Promise<
	| { ok: false; reason: ImagesSkipReason }
	| {
			ok: true
			doc: typeof documents.$inferSelect
			version: typeof documentVersions.$inferSelect
	  }
> {
	const [ref] = await tx
		.select({ documentId: documentVersions.documentId })
		.from(documentVersions)
		.where(eq(documentVersions.id, versionId))
	if (!ref) return { ok: false, reason: "missing" }
	const query = tx.select().from(documents).where(eq(documents.id, ref.documentId))
	const [doc] = lock ? await query.for("update") : await query
	if (!doc) return { ok: false, reason: "missing" }
	if (doc.deletedAt) return { ok: false, reason: "trashed" }
	if (doc.currentVersionId !== versionId) return { ok: false, reason: "superseded" }
	// After the lock: another publication of this version has committed by now.
	const [version] = await tx
		.select()
		.from(documentVersions)
		.where(eq(documentVersions.id, versionId))
	if (!version) return { ok: false, reason: "missing" }
	if (version.imagesDone) return { ok: false, reason: "already_done" }
	return { ok: true, doc, version }
}

function skipped(versionId: string, reason: ImagesSkipReason, stage: string): ImagesOutcome {
	log.info("images: skipped", { versionId, reason, stage })
	return { outcome: "skipped", reason }
}

/**
 * Rehost every image in a version's HTML plus the document's lead image. Rewrites `src` to
 * `/assets/:id`, keeps the original in `data-original-src`, and refuses to write if the rewrite
 * would change the canonical text (highlight offsets depend on it).
 *
 * The version is checked when the job starts and again, under the document's row lock, when it
 * publishes: a job whose article was re-extracted, trashed or deleted meanwhile publishes nothing.
 * Its uploads are left to the daily orphan purge, which keeps any file another article uses.
 */
export async function handleImages(
	job: Pick<JobWithMetadata<JobPayloads["images"]>, "data">,
	{ ingestImage }: ImagesDeps = { ingestImage: ingestImageFromNetwork },
): Promise<ImagesOutcome> {
	const { versionId } = job.data
	const start = await eligibility(db, versionId, false)
	if (!start.ok) return skipped(versionId, start.reason, "start")
	const { doc, version } = start

	const dom = new JSDOM(`<!doctype html><body>${version.html}</body>`)
	const body = dom.window.document.body
	const imgs = Array.from(body.querySelectorAll("img")).filter((img) =>
		/^https?:\/\//i.test(img.getAttribute("src") ?? ""),
	)
	const unique = Array.from(new Set(imgs.map((img) => img.getAttribute("src") as string))).slice(
		0,
		MAX_IMAGES_PER_ARTICLE,
	)

	const resolved = new Map<string, string | null>()
	let cursor = 0
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
			while (cursor < unique.length) {
				const url = unique[cursor++] as string
				try {
					const asset = await ingestImage({ userId: doc.userId, url, maxWidth: ARTICLE_MAX_WIDTH })
					resolved.set(url, asset ? `/assets/${asset.id}` : null)
				} catch (error) {
					resolved.set(url, null)
					log.warn("images: skip", { host: loggedHost(url), error })
				}
			}
		}),
	)

	let rewritten = 0
	for (const img of imgs) {
		const src = img.getAttribute("src") as string
		const local = resolved.get(src)
		if (!local) continue
		img.setAttribute("data-original-src", src)
		img.setAttribute("src", local)
		img.removeAttribute("srcset")
		img.removeAttribute("sizes")
		img.removeAttribute("referrerpolicy")
		rewritten++
	}
	for (const source of Array.from(body.querySelectorAll("picture > source"))) source.remove()

	let html: string | null = null
	if (rewritten > 0) {
		const candidate = body.innerHTML
		const check = new JSDOM(`<!doctype html><body>${candidate}</body>`).window.document.body
		if (canonicalText(check) !== version.text) {
			log.error("images: rewrite would change canonical text; leaving html untouched", {
				versionId,
			})
		} else {
			html = candidate
		}
	}

	// Lead image (card thumbnail).
	let leadAssetId: string | null = doc.leadImageAssetId
	if (!leadAssetId && doc.leadImageUrl) {
		try {
			const asset = await ingestImage({
				userId: doc.userId,
				url: doc.leadImageUrl,
				maxWidth: LEAD_MAX_WIDTH,
			})
			leadAssetId = asset?.id ?? null
		} catch (error) {
			log.warn("images: lead image skipped", { host: loggedHost(doc.leadImageUrl), error })
		}
	}
	if (!leadAssetId && doc.leadImageUrl == null) {
		// Fall back to the first rehosted article image as the card thumbnail.
		const first = imgs
			.find((img) => img.getAttribute("src")?.startsWith("/assets/"))
			?.getAttribute("src")
		if (first) leadAssetId = first.slice("/assets/".length)
	}

	// Publication. The downloads above ran without any lock; this short transaction takes the
	// document row and checks again, so the HTML, the flag and the thumbnail go out together or
	// not at all.
	const published = await db.transaction(async (tx) => {
		const now = await eligibility(tx, versionId, true)
		if (!now.ok) return now
		await tx
			.update(documentVersions)
			.set({ ...(html === null ? {} : { html }), imagesDone: true })
			.where(eq(documentVersions.id, versionId))
		if (leadAssetId && leadAssetId !== now.doc.leadImageAssetId) {
			await tx
				.update(documents)
				.set({ leadImageAssetId: leadAssetId })
				.where(eq(documents.id, doc.id))
		}
		return now
	})
	if (!published.ok) return skipped(versionId, published.reason, "publish")

	await notifyDocumentEvent({ userId: doc.userId, documentId: doc.id, kind: "images" })
	log.info("images: done", {
		versionId,
		total: unique.length,
		rewritten,
		lead: Boolean(leadAssetId),
	})
	return { outcome: "completed" }
}
