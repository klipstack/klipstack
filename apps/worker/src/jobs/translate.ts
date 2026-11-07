import { createAi, elementShape, estimateCostUsd } from "@klipstack/ai"
import { translationWords } from "@klipstack/api-contract"
import {
	addUsage,
	and,
	db,
	documents,
	documentVersions,
	eq,
	notifyDocumentEvent,
	showVersion,
	sql,
} from "@klipstack/db"
import { articleBody } from "@klipstack/extract"
import { admitImages, type JobPayloads, QUEUES } from "@klipstack/queue"
import { JSDOM } from "jsdom"
import type { JobWithMetadata } from "pg-boss"
import { log } from "../log"

/** About this many words of the original go in one request: a few minutes of the model at most. */
export const PART_WORDS = 1500

const escapeText = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Containers whose parts are translated one by one when they are too long for one request. */
const OPEN_UP = new Set(["DIV", "SECTION", "ARTICLE", "MAIN"])

/**
 * The elements of an article's HTML as the reader's browser parses it (`elementShape`). The
 * model's quick check reads tags with a pattern; this one is what decides that a translation
 * added or changed no link, image or attribute.
 */
export function parsedShape(html: string): string[] {
	const body = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
	const shape: string[] = []
	for (const element of Array.from(body.querySelectorAll("*"))) {
		const kept = elementShape(
			element.localName,
			Array.from(element.attributes, (a) => [a.name, a.value] as [string, string]),
		)
		if (kept) shape.push(kept)
	}
	return shape
}

/** Whether a translation has the same elements and attributes as what was sent (`parsedShape`). */
export const sameMarkup = (translation: string, sent: string) =>
	JSON.stringify(parsedShape(translation)) === JSON.stringify(parsedShape(sent))

/**
 * The article's HTML in parts of about `PART_WORDS` words, cut between top-level blocks. A
 * container too long for one part is opened up: its blocks become parts of their own (the
 * container itself, which only groups them, is not kept).
 */
export function splitParts(html: string, partWords = PART_WORDS): string[] {
	const body = new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body
	const blocks: { html: string; words: number }[] = []
	const visit = (node: ChildNode) => {
		const words = translationWords(node.textContent ?? "")
		const element = node.nodeType === 1 ? (node as Element) : null
		if (
			element &&
			words > partWords &&
			OPEN_UP.has(element.tagName) &&
			element.childNodes.length > 1
		)
			for (const child of Array.from(element.childNodes)) visit(child)
		else if (element) blocks.push({ html: element.outerHTML, words })
		else if (node.nodeType === 3 && node.textContent?.trim())
			blocks.push({ html: escapeText(node.textContent), words })
	}
	for (const node of Array.from(body.childNodes)) visit(node)
	const parts: string[] = []
	let current = ""
	let count = 0
	for (const block of blocks) {
		if (current && count + block.words > partWords) {
			parts.push(current)
			current = ""
			count = 0
		}
		current += block.html
		count += block.words
	}
	if (current) parts.push(current)
	return parts
}

const ai = () =>
	createAi({
		anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
		fake: process.env.AI_FAKE === "1" || process.env.AI_FAKE === "demo",
	})

/** Gives a translation's credits back, and marks it failed, when nothing else came after it. */
async function fail(job: JobPayloads["translate"], userId: string) {
	await db.transaction(async (tx) => {
		const [doc] = await tx
			.update(documents)
			.set({ translationStatus: "failed" })
			.where(and(eq(documents.id, job.documentId), eq(documents.translationStatus, "pending")))
			.returning({ id: documents.id })
		if (doc) await addUsage(tx, userId, "translations", -job.credits, job.month)
	})
}

/**
 * Translations still pending with no job waiting or running: pg-boss failed the job after a
 * timeout or a crash on its last attempt, so the handler never gave the credits back. They fail
 * now, as the last attempt would have, with the credits of their newest job. The sweep runs it;
 * `owners` limits it to those users' articles (tests).
 */
export async function settleStuckTranslations(owners?: string[]): Promise<string[]> {
	const { rows } = await db.execute<{ id: string; user_id: string; data: unknown }>(sql`
		select d.id, d.user_id, (
			select j.data from pgboss.job j
			where j.name = ${QUEUES.translate} and j.data->>'documentId' = d.id::text
			order by j.created_on desc limit 1
		) as data
		from documents d
		where d.translation_status = 'pending'
			and ${owners ? sql`d.user_id in ${owners}` : sql`true`}
			and not exists (
				select 1 from pgboss.job j
				where j.name = ${QUEUES.translate}
					and j.data->>'documentId' = d.id::text
					and j.state in ('created', 'retry', 'active')
			)`)
	for (const row of rows) {
		const job = row.data as JobPayloads["translate"] | null
		if (job) await fail(job, row.user_id)
		else
			await db
				.update(documents)
				.set({ translationStatus: "failed" })
				.where(and(eq(documents.id, row.id), eq(documents.translationStatus, "pending")))
		await notifyDocumentEvent({ userId: row.user_id, documentId: row.id, kind: "ready" })
	}
	return rows.map((row) => row.id)
}

/**
 * Translates an article's original (`sourceVersionId`) and shows the translation, as long as the
 * article still waits for it and that original is still its newest. The output must keep the
 * article's markup (the AI module checks each part) and be in the language asked for. A failure
 * is retried; the last one gives the credits back and leaves the original shown.
 */
export async function handleTranslate(job: JobWithMetadata<JobPayloads["translate"]>) {
	const { documentId, sourceVersionId, language } = job.data
	const doc = await db.query.documents.findFirst({ where: eq(documents.id, documentId) })
	if (!doc || doc.translationStatus !== "pending") {
		log.info("translate: nothing waits for it", { documentId })
		return
	}
	if (doc.deletedAt) {
		await fail(job.data, doc.userId)
		return
	}
	const source = await db.query.documentVersions.findFirst({
		where: eq(documentVersions.id, sourceVersionId),
	})
	if (!source) {
		await fail(job.data, doc.userId)
		return
	}
	try {
		const parts = splitParts(source.html)
		const translation = await ai().translate({
			parts,
			title: source.title ?? doc.title ?? "",
			description: source.title ? source.description : doc.description,
			from: source.language ?? doc.language,
			to: language,
		})
		const micros = Math.round(estimateCostUsd(translation.model, translation.usage) * 1_000_000)
		if (micros > 0) await addUsage(db, doc.userId, "ai_spend", micros)

		const body = articleBody(translation.parts.join(""))
		// Sanitized, as the parts sent were: the same elements, with the same links and images.
		if (!sameMarkup(body.html, parts.join("")))
			throw new Error("the translation changed the article's markup")
		if (body.detectedLanguage && body.detectedLanguage !== language)
			throw new Error(`the translation came back in ${body.detectedLanguage}`)

		const shown = await db.transaction(async (tx) => {
			const [live] = await tx
				.select({
					translationStatus: documents.translationStatus,
					deletedAt: documents.deletedAt,
					currentVersionId: documents.currentVersionId,
					originalVersionId: documents.originalVersionId,
				})
				.from(documents)
				.where(eq(documents.id, documentId))
				.for("update")
			if (!live || live.translationStatus !== "pending" || live.deletedAt) return null
			// A new capture landed meanwhile: this translates an original that is no longer the newest.
			if ((live.originalVersionId ?? live.currentVersionId) !== sourceVersionId) return null
			const [row] = await tx
				.select({ max: sql<number>`coalesce(max(${documentVersions.version}), 0)` })
				.from(documentVersions)
				.where(eq(documentVersions.documentId, documentId))
			const [version] = await tx
				.insert(documentVersions)
				.values({
					documentId,
					rawId: source.rawId,
					version: Number(row?.max ?? 0) + 1,
					html: body.html,
					text: body.text,
					textHash: body.textHash,
					extractor: "translation",
					extractorVersion: translation.model,
					// The original's images, rehosted or not: rehosted, the translation has them too.
					imagesDone: source.imagesDone,
					translatedFromId: sourceVersionId,
					language,
					title: translation.title,
					description: translation.description,
					wordCount: body.wordCount,
				})
				.returning({ id: documentVersions.id })
			await showVersion(tx, documentId, version!.id, sourceVersionId)
			await tx
				.update(documents)
				.set({ translationStatus: null })
				.where(eq(documents.id, documentId))
			if (!source.imagesDone) await admitImages(tx, version!.id)
			return version!.id
		})
		if (!shown) {
			await fail(job.data, doc.userId)
			log.info("translate: superseded", { documentId })
			return
		}
		await notifyDocumentEvent({ userId: doc.userId, documentId, kind: "ready" })
		log.info("translate: done", { documentId, language, parts: translation.parts.length })
	} catch (error) {
		if (job.retryCount >= job.retryLimit) {
			await fail(job.data, doc.userId)
			await notifyDocumentEvent({ userId: doc.userId, documentId, kind: "ready" })
			log.warn("translate: failed", { documentId, error })
			return
		}
		log.warn("translate: will retry", { documentId, attempt: job.retryCount + 1, error })
		throw error
	}
}
