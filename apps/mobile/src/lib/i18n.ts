import { fallbackLanguage, isLocale, type Locale, mobileResources } from "@klipstack/i18n/mobile"
import { getLocales } from "expo-localization"
import i18next from "i18next"

/**
 * The app speaks the iPhone's language, as iOS apps do: the first of the person's languages
 * (Settings › General › Language & Region, or the app's own Language in Settings › Apps ›
 * Klipstack) that the app knows, else English. iOS restarts the app when either changes, so it is
 * read once, before any screen. The account's language (on the web) is the server's: its emails
 * and the guide.
 */
export const language: Locale =
	getLocales()
		.map((locale) => locale.languageCode)
		.find(isLocale) ?? fallbackLanguage

const i18n = i18next.createInstance()
void i18n.init({
	resources: {
		en: { translation: mobileResources.en },
		es: { translation: mobileResources.es },
	},
	lng: language,
	fallbackLng: fallbackLanguage,
	interpolation: { escapeValue: false },
	initAsync: false,
})

/** A string of the app in its language: `t("common.tabs.home")`. */
export const t = i18n.t.bind(i18n)

/**
 * For dates and numbers (`Intl`, `toLocaleDateString`): the phone's own locale when it is in the
 * app's language ("es-CL"), so the region's formats come along; else the language.
 */
export const dateLocale: string =
	getLocales().find((locale) => locale.languageCode === language)?.languageTag ??
	(language === "en" ? "en-US" : language)

/**
 * What to tell the person about a failure. The server explains in English: in English that is
 * shown as it was; in another language, the failures that need no detail (no connection, signed
 * out, too many requests, the server's own trouble) are said in it, and the rest keep the
 * server's words.
 */
export function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
	if (language === "en") return message
	if (error instanceof TypeError && /network request failed/i.test(message))
		return t("common.errors.offline")
	const code = (error as { code?: unknown } | null)?.code
	switch (code) {
		case "rate_limited":
			return t("common.errors.rateLimited")
		case "unauthorized":
			return t("common.errors.signedOut")
		case "not_found":
			return t("common.errors.notFound")
		case "forbidden":
		case "insufficient_scope":
			return t("common.errors.forbidden")
		case "client_outdated":
			return t("common.errors.outdated")
		case "internal":
		case "unavailable":
		case "request_timeout":
			return t("common.errors.server")
		default:
			return message
	}
}

declare module "i18next" {
	interface CustomTypeOptions {
		resources: { translation: typeof mobileResources.en }
	}
}
