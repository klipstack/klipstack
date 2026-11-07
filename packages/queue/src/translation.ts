import {
	TRANSLATION_WORDS_MAX,
	type TranslationLanguage,
	translationCredits,
	translationWords,
} from "@klipstack/api-contract"
import { and, documents, documentVersions, eq, showVersion, type Tx } from "@klipstack/db"
import { sendInTransaction } from "./admission"

/** What admission needs to know of the article, read under its row lock by the caller. */
export interface TranslatableArticle {
	id: string
	status: string
	language: string | null
	currentVersionId: string | null
	originalVersionId: string | null
	translationStatus: string | null
}

export type TranslationAdmission =
	/** Shown now: already in a translation of its newest original, or one made before, free. */
	| { status: "translated" }
	/** Queued: the worker translates it. `credits` were taken in the caller's transaction. */
	| { status: "pending"; credits: number }
	/** Refused, nothing taken: the reason, for the caller to say. */
	| { status: "not_ready" }
	| { status: "already_pending" }
	| { status: "same_language" }
	| { status: "unknown_language" }
	| { status: "too_long"; words: number }
	| { status: "no_credits"; credits: number }

/**
 * Admission of a translation: the one place that decides whether an article may be translated into
 * `language`, for the web's command and the worker's "Always translate" alike. Shows a translation
 * made before at no cost; otherwise counts the original's words, asks `take` for the credits (it
 * answers the month they count in, or null when they don't fit), marks the article pending and
 * queues the job, all in the caller's transaction. The caller holds the article's row lock.
 */
export async function admitTranslation(
	tx: Tx,
	doc: TranslatableArticle,
	language: TranslationLanguage,
	take: (credits: number) => Promise<string | null>,
): Promise<TranslationAdmission> {
	if (doc.status !== "ready" || !doc.currentVersionId) return { status: "not_ready" }
	if (doc.translationStatus === "pending") return { status: "already_pending" }
	// Not translated: only an article known to be in another language, as the reader offers.
	if (!doc.originalVersionId && doc.language === null) return { status: "unknown_language" }
	if (!doc.originalVersionId && doc.language === language) return { status: "same_language" }
	const sourceId = doc.originalVersionId ?? doc.currentVersionId
	if (doc.originalVersionId && doc.language === language) {
		const [shown] = await tx
			.select({ from: documentVersions.translatedFromId })
			.from(documentVersions)
			.where(eq(documentVersions.id, doc.currentVersionId))
		if (shown?.from === sourceId) return { status: "translated" }
	}
	// Made before (then the original was put back): shown again for free.
	const [made] = await tx
		.select({ id: documentVersions.id })
		.from(documentVersions)
		.where(
			and(
				eq(documentVersions.documentId, doc.id),
				eq(documentVersions.translatedFromId, sourceId),
				eq(documentVersions.language, language),
			),
		)
		.limit(1)
	if (made) {
		await showVersion(tx, doc.id, made.id, sourceId)
		await tx.update(documents).set({ translationStatus: null }).where(eq(documents.id, doc.id))
		return { status: "translated" }
	}

	const [source] = await tx
		.select({ text: documentVersions.text })
		.from(documentVersions)
		.where(eq(documentVersions.id, sourceId))
	if (!source) return { status: "not_ready" }
	const words = translationWords(source.text)
	if (words > TRANSLATION_WORDS_MAX) return { status: "too_long", words }
	const credits = translationCredits(words)
	const month = await take(credits)
	if (!month) return { status: "no_credits", credits }
	await tx.update(documents).set({ translationStatus: "pending" }).where(eq(documents.id, doc.id))
	await sendInTransaction(tx, "translate", {
		documentId: doc.id,
		sourceVersionId: sourceId,
		language,
		credits,
		month,
	})
	return { status: "pending", credits }
}
