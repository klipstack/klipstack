import {
	TRANSLATION_WORDS_MAX,
	type TranslationLanguage,
	translationCredits,
	translationWords,
} from "@klipstack/api-contract"
import { and, db, type Document, documentVersions, eq, monthOf, usageCounts } from "@klipstack/db"
import { limitsFor } from "~/lib/limits.server"
import { highlightsElsewhere } from "./highlights.server"

/** The original a translated article came from: what "Show original text" shows. */
export async function originalVersion(documentId: string, versionId: string) {
	return db.query.documentVersions.findFirst({
		where: and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)),
		columns: { id: true, version: true, html: true, imagesDone: true, title: true, language: true },
	})
}

export interface ReaderTranslation {
	/** The account's language, which articles are translated into. */
	target: TranslationLanguage
	/** The language of the text shown, when known. */
	language: string | null
	/** Shown in a translation (or its original, while "Show original text" is on). */
	translated: boolean
	/** The original's language, when translated and known. */
	from: string | null
	/** The original changed after the translation was made (extracted again). */
	stale: boolean
	/** A translation on its way, or one that failed. */
	status: "pending" | "failed" | null
	/** What translating the newest original costs, and the credits left this month. */
	credits: number
	left: number
	/** Over the word cap: the reader says so instead of offering it. */
	tooLong: boolean
	/** Highlights on the version not shown (the original, or the translation). */
	elsewhere: number
}

/**
 * What the reader needs to offer, show and switch translations. `shown` is the version on
 * screen: the current one, or the original while "Show original text" is on.
 */
export async function readerTranslation(
	userId: string,
	locale: string,
	doc: Pick<
		Document,
		"id" | "language" | "currentVersionId" | "originalVersionId" | "translationStatus"
	>,
	shown: string,
): Promise<ReaderTranslation> {
	const sourceId = doc.originalVersionId ?? doc.currentVersionId!
	const [source, current, limits, used, elsewhere] = await Promise.all([
		db.query.documentVersions.findFirst({
			where: eq(documentVersions.id, sourceId),
			columns: { text: true, language: true },
		}),
		doc.originalVersionId
			? db.query.documentVersions.findFirst({
					where: eq(documentVersions.id, doc.currentVersionId!),
					columns: { translatedFromId: true },
				})
			: null,
		limitsFor(userId),
		db
			.select({ count: usageCounts.count })
			.from(usageCounts)
			.where(
				and(
					eq(usageCounts.userId, userId),
					eq(usageCounts.metric, "translations"),
					eq(usageCounts.month, monthOf().month),
				),
			),
		highlightsElsewhere(userId, doc.id, shown),
	])
	const words = translationWords(source?.text ?? "")
	return {
		target: locale === "es" ? "es" : "en",
		language: doc.language,
		translated: Boolean(doc.originalVersionId),
		from: doc.originalVersionId ? (source?.language ?? null) : null,
		stale: Boolean(current && current.translatedFromId !== doc.originalVersionId),
		status: doc.translationStatus,
		credits: translationCredits(words),
		left: Math.max(0, limits.translations - (used[0]?.count ?? 0)),
		tooLong: words > TRANSLATION_WORDS_MAX,
		elsewhere,
	}
}
