import {
	Id,
	LanguageCode,
	NEVER_TRANSLATE_MAX,
	TRANSLATION_WORDS_MAX,
	type TranslationLanguage,
	translationCredits,
	translationWords,
} from "@klipstack/api-contract"
import {
	and,
	db,
	documents,
	documentVersions,
	eq,
	isNull,
	notifyDocumentEvent,
	showVersion,
	type Tx,
	user as userTable,
} from "@klipstack/db"
import { sendInTransaction } from "@klipstack/queue"
import { z } from "zod"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { countMonthly } from "~/lib/limits.server"
import { mayUseAi } from "./ai.server"
import { NO_ARTICLE } from "./articles.server"

/**
 * Translating articles into the account's language. A translation is a version of the article,
 * made from the original by the AI module (the worker's `translate` job), and the one it shows
 * from then on: its title, language, highlights and search. The original stays, to show again.
 * It costs credits from a monthly allowance by the original's length (`translationCredits`),
 * taken when it is asked for and given back when it fails.
 */

const ArticleInput = z.object({ id: Id })

export type TranslateOutcome =
	/** Shown now: the translation was made before (from the same original), at no cost. */
	| { status: "translated"; credits: 0 }
	/** On its way: the worker translates it, and the reader updates when it is done. */
	| { status: "pending"; credits: number }

/** The language the account reads the app in, which articles are translated into. */
async function languageOf(userId: string): Promise<TranslationLanguage> {
	const [row] = await db
		.select({ locale: userTable.locale })
		.from(userTable)
		.where(eq(userTable.id, userId))
	return row?.locale === "es" ? "es" : "en"
}

/** The article, locked for the change, with what translating it needs to know. */
async function lockArticle(tx: Tx, userId: string, id: string) {
	const [doc] = await tx
		.select({
			id: documents.id,
			status: documents.status,
			language: documents.language,
			currentVersionId: documents.currentVersionId,
			originalVersionId: documents.originalVersionId,
			translationStatus: documents.translationStatus,
		})
		.from(documents)
		.where(and(eq(documents.id, id), eq(documents.userId, userId), isNull(documents.deletedAt)))
		.for("update")
	if (!doc) throw notFound(NO_ARTICLE)
	return doc
}

/**
 * Translates the article into the account's language. An article already shown in a translation
 * of its newest original into that language is left as it is. Refused over
 * `TRANSLATION_WORDS_MAX` words (`invalid_request`), past the month's credits (`limit_reached`),
 * and while a translation is on its way (`already_pending`).
 */
export async function translateArticle(userId: string, input: unknown): Promise<TranslateOutcome> {
	const { id } = parseInput(ArticleInput, input)
	await mayUseAi(userId)
	const language = await languageOf(userId)
	const outcome = await db.transaction(async (tx) => {
		const doc = await lockArticle(tx, userId, id)
		if (doc.status !== "ready" || !doc.currentVersionId)
			throw new AppError("not_ready", "The article text is not available yet. Try again later.")
		if (doc.translationStatus === "pending")
			throw new AppError("already_pending", "The article is being translated.")
		// Not translated: only an article known to be in another language, as the reader offers.
		if (!doc.originalVersionId && doc.language !== null && doc.language === language)
			throw new AppError("invalid_request", `The article is already in ${language}.`)
		if (!doc.originalVersionId && doc.language === null)
			throw new AppError("invalid_request", "The article's language is not known.")
		const sourceId = doc.originalVersionId ?? doc.currentVersionId
		if (doc.originalVersionId && doc.language === language) {
			const [shown] = await tx
				.select({ from: documentVersions.translatedFromId })
				.from(documentVersions)
				.where(eq(documentVersions.id, doc.currentVersionId))
			if (shown?.from === sourceId) return { status: "translated", credits: 0 } as const
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
			return { status: "translated", credits: 0 } as const
		}

		const [source] = await tx
			.select({ text: documentVersions.text })
			.from(documentVersions)
			.where(eq(documentVersions.id, sourceId))
		if (!source)
			throw new AppError("not_ready", "The article text is not available yet. Try again later.")
		const words = translationWords(source.text)
		if (words > TRANSLATION_WORDS_MAX)
			throw new AppError(
				"invalid_request",
				`The article has ${words} words; translations take up to ${TRANSLATION_WORDS_MAX}.`,
				{ details: { words, max: TRANSLATION_WORDS_MAX } },
			)
		const credits = translationCredits(words)
		const { month } = await countMonthly(tx, userId, "translations", credits)
		await tx.update(documents).set({ translationStatus: "pending" }).where(eq(documents.id, doc.id))
		await sendInTransaction(tx, "translate", {
			documentId: doc.id,
			sourceVersionId: sourceId,
			language,
			credits,
			month,
		})
		return { status: "pending", credits } as const
	})
	if (outcome.status === "translated")
		await notifyDocumentEvent({ userId, documentId: id, kind: "ready" })
	return outcome
}

/**
 * Shows the article's original again, with its title and language: "Use original". The
 * translation stays, with its highlights, and translating again shows it at no cost. An article
 * not translated is left as it is.
 */
export async function showOriginal(userId: string, input: unknown): Promise<{ changed: boolean }> {
	const { id } = parseInput(ArticleInput, input)
	const changed = await db.transaction(async (tx) => {
		const doc = await lockArticle(tx, userId, id)
		if (!doc.originalVersionId) return false
		await showVersion(tx, doc.id, doc.originalVersionId, null)
		return true
	})
	if (changed) await notifyDocumentEvent({ userId, documentId: id, kind: "ready" })
	return { changed }
}

const NeverTranslate = z.object({ language: LanguageCode, never: z.boolean() })

/**
 * Adds a language to the ones the account reads ("Never translate Chinese"), or takes it out
 * (Settings → Features). Articles in them are no longer offered a translation; translations
 * already made stay. Answers the list.
 */
export async function setNeverTranslate(
	userId: string,
	input: z.input<typeof NeverTranslate>,
): Promise<string[]> {
	const { language, never } = parseInput(NeverTranslate, input)
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ prefs: userTable.prefs })
			.from(userTable)
			.where(eq(userTable.id, userId))
			.for("update")
		const prefs = row?.prefs ?? {}
		const before = prefs.neverTranslate ?? []
		const after = never
			? [...new Set([...before, language])]
			: before.filter((code) => code !== language)
		if (after.length > NEVER_TRANSLATE_MAX)
			throw new AppError(
				"invalid_request",
				`An account can list up to ${NEVER_TRANSLATE_MAX} languages it reads.`,
			)
		await tx
			.update(userTable)
			.set({ prefs: { ...prefs, neverTranslate: after } })
			.where(eq(userTable.id, userId))
		return after
	})
}
