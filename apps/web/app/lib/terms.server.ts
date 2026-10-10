import { fallbackLanguage, isLocale, type Locale } from "@klipstack/i18n"
import type { Policy } from "./privacy-policy/types"
import en from "./terms/en"
import es from "./terms/es"

/** Every language's terms of use. */
export const terms: Record<Locale, Policy> = { en, es }

export function termsOfUse(locale: string | undefined): Policy {
	return terms[isLocale(locale) ? locale : fallbackLanguage]
}
