import {
	Id,
	LanguageCode,
	TRANSLATION_CHOICES,
	TRANSLATION_LANGUAGES_MAX,
	TRANSLATION_WORDS_MAX,
	type TranslationLanguage,
} from "@klipstack/api-contract"
import {
	and,
	db,
	documents,
	eq,
	isNull,
	notifyDocumentEvent,
	showVersion,
	type Tx,
	user as userTable,
} from "@klipstack/db"
import { admitTranslation } from "@klipstack/queue"
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
		const admitted = await admitTranslation(tx, doc, language, async (credits) => {
			const { month } = await countMonthly(tx, userId, "translations", credits)
			return month
		})
		switch (admitted.status) {
			case "translated":
				return { status: "translated", credits: 0 } as const
			case "pending":
				return admitted
			case "not_ready":
				throw new AppError("not_ready", "The article text is not available yet. Try again later.")
			case "already_pending":
				throw new AppError("already_pending", "The article is being translated.")
			case "same_language":
				throw new AppError("invalid_request", `The article is already in ${language}.`)
			case "unknown_language":
				throw new AppError("invalid_request", "The article's language is not known.")
			case "too_long":
				throw new AppError(
					"invalid_request",
					`The article has ${admitted.words} words; translations take up to ${TRANSLATION_WORDS_MAX}.`,
					{ details: { words: admitted.words, max: TRANSLATION_WORDS_MAX } },
				)
			case "no_credits":
				// `countMonthly` refuses past the cap itself; this one never answers null.
				throw new Error("no credits without a refusal")
		}
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
		if (doc.translationStatus === "pending")
			throw new AppError("already_pending", "The article is being translated.")
		if (!doc.originalVersionId) return false
		await showVersion(tx, doc.id, doc.originalVersionId, null)
		return true
	})
	if (changed) await notifyDocumentEvent({ userId, documentId: id, kind: "ready" })
	return { changed }
}

const Choice = z.object({ language: LanguageCode, choice: z.enum(TRANSLATION_CHOICES) })

/** The account's languages by what it does with them: never translated, and always. */
export interface TranslationLanguages {
	never: string[]
	always: string[]
}

/**
 * What the account does with articles in a language: never offered a translation ("Never
 * translate Chinese", for a language it reads), always translated as they are saved, credits
 * allowing ("Always translate Chinese"), or offered one (`ask`, the default). A language is in
 * one list at most. Translations already made stay. Answers both lists.
 */
export async function setTranslationChoice(
	userId: string,
	input: z.input<typeof Choice>,
): Promise<TranslationLanguages> {
	const { language, choice } = parseInput(Choice, input)
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({ prefs: userTable.prefs })
			.from(userTable)
			.where(eq(userTable.id, userId))
			.for("update")
		const prefs = row?.prefs ?? {}
		const without = (list: string[] | undefined) => (list ?? []).filter((c) => c !== language)
		const keep = (list: string[] | undefined, on: boolean) =>
			on && list?.includes(language) ? list : [...without(list), ...(on ? [language] : [])]
		const after = {
			never: keep(prefs.neverTranslate, choice === "never"),
			always: keep(prefs.alwaysTranslate, choice === "always"),
		}
		if (
			after.never.length > TRANSLATION_LANGUAGES_MAX ||
			after.always.length > TRANSLATION_LANGUAGES_MAX
		)
			throw new AppError(
				"invalid_request",
				`An account can list up to ${TRANSLATION_LANGUAGES_MAX} languages for each choice.`,
			)
		await tx
			.update(userTable)
			.set({ prefs: { ...prefs, neverTranslate: after.never, alwaysTranslate: after.always } })
			.where(eq(userTable.id, userId))
		return after
	})
}
