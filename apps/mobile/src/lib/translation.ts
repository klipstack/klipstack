import type { ArticleTranslation } from "@klipstack/sdk"
import type { TranslationAction } from "@/page/messages"
import { dateLocale, t } from "./i18n"

/** The account's languages never translated, and always (`GET /translation/languages`). */
export type TranslationLanguages = { never: readonly string[]; always: readonly string[] }

/**
 * The bar above the article, as the web reader's: the offer to translate it, the translation on
 * its way or failed, or, on a translation, where it came from and the switch to the original text.
 */
export type TranslationBar = {
	text: string
	/** Quieter words after it: the cost, or how long it takes. */
	note: string | null
	/** On its way: a spinner, and no buttons. */
	pending: boolean
	actions: ReadonlyArray<{
		action: TranslationAction
		label: string
		primary: boolean
		disabled: boolean
	}>
}

/**
 * A language's name in the app's language, as a sentence says it ("French", "francés"). The code
 * when the phone doesn't know it.
 */
export function languageName(code: string): string {
	try {
		return new Intl.DisplayNames([dateLocale], { type: "language" }).of(code) ?? code
	} catch {
		return code
	}
}

/** Whether the reader offers to translate the article: in another language, not one they read. */
export function offersTranslation(
	translation: ArticleTranslation,
	never: readonly string[],
): boolean {
	const { language, target } = translation
	return (
		translation.available &&
		!translation.translated &&
		!translation.status &&
		language !== null &&
		language !== target &&
		!never.includes(language)
	)
}

/**
 * The bar for the article's translation, or null for none. `original`: the original text is on
 * screen ("Show original text"); `dismissed`: "Not now" on this article; `busy`: a translation is
 * being asked for.
 */
export function translationBar(
	translation: ArticleTranslation,
	{
		languages,
		dismissed = false,
		original = false,
		busy = false,
	}: {
		languages: TranslationLanguages
		dismissed?: boolean
		original?: boolean
		busy?: boolean
	},
): TranslationBar | null {
	const from = translation.from ? languageName(translation.from) : null
	const button = (action: TranslationAction, label: string, primary = false, disabled = false) => ({
		action,
		label,
		primary,
		disabled,
	})

	if (original)
		return {
			text: [
				from
					? t("reader.translation.viewingOriginal", { language: from })
					: t("reader.translation.viewingOriginalUnknown"),
				t("reader.translation.readOnly"),
				translation.elsewhere > 0
					? t("reader.translation.onTranslation", { count: translation.elsewhere })
					: null,
			]
				.filter(Boolean)
				.join(" "),
			note: null,
			pending: false,
			actions: [button("translation", t("reader.translation.showTranslation"))],
		}

	if (translation.translated)
		return {
			text: [
				from
					? t("reader.translation.translated", { language: from })
					: t("reader.translation.translatedUnknown"),
				translation.elsewhere > 0
					? t("reader.translation.onOriginal", { count: translation.elsewhere })
					: null,
				translation.stale ? t("reader.translation.stale") : null,
			]
				.filter(Boolean)
				.join(" "),
			note: null,
			pending: false,
			actions: [
				button("original", t("reader.translation.showOriginal")),
				...(from && translation.available && !languages.always.includes(translation.from!)
					? [button("always", t("reader.translation.always", { language: from }))]
					: []),
				...(translation.stale && translation.available && translation.status !== "pending"
					? [button("translate", t("reader.translation.translateAgain"), true, busy)]
					: []),
			],
		}

	const target = languageName(translation.target)
	if (translation.status === "pending")
		return {
			text: t("reader.translation.pending", { language: target }),
			note: t("reader.translation.pendingHint"),
			pending: true,
			actions: [],
		}

	if (translation.status === "failed" && translation.available)
		return {
			text: t("reader.translation.failed"),
			note: null,
			pending: false,
			actions: [button("translate", t("reader.translation.retry"), true, busy)],
		}

	if (dismissed || !offersTranslation(translation, languages.never)) return null
	const language = languageName(translation.language!)
	const enough = translation.credits <= translation.left
	return {
		text: t("reader.translation.offer", { language }),
		note: translation.tooLong
			? t("reader.translation.tooLong")
			: translation.credits === 0
				? t("reader.translation.free")
				: `${t(enough ? "reader.translation.cost" : "reader.translation.short", { count: translation.credits })} ${t("reader.translation.creditsLeft", { count: translation.left })}`,
		pending: false,
		actions: [
			...(translation.tooLong
				? []
				: [
						button(
							"translate",
							t("reader.translation.translate", { language: target }),
							true,
							!enough || busy,
						),
					]),
			button("not-now", t("reader.translation.notNow")),
			button("never", t("reader.translation.never", { language })),
		],
	}
}

/**
 * The reader's menu item for the article's translation, as the web's top bar has it: translate
 * it, or put its original language back. None while one is on its way, or with nothing to offer.
 */
export function translationMenu(
	translation: ArticleTranslation | null,
): { action: "translate" | "use-original"; label: string } | null {
	if (!translation || translation.status === "pending") return null
	if (translation.translated) return { action: "use-original", label: t("reader.menu.useOriginal") }
	if (
		translation.available &&
		translation.language &&
		translation.language !== translation.target &&
		!translation.tooLong
	)
		return {
			action: "translate",
			label: t("reader.menu.translate", { language: languageName(translation.target) }),
		}
	return null
}
