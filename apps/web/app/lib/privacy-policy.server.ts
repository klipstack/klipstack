import { fallbackLanguage, isLocale, type Locale } from "@klipstack/i18n"
import en from "./privacy-policy/en"
import es from "./privacy-policy/es"
import type { Policy } from "./privacy-policy/types"

export type { Policy, PolicyBlock } from "./privacy-policy/types"

/** Every language's policy. */
export const policies: Record<Locale, Policy> = { en, es }

export function privacyPolicy(locale: string | undefined): Policy {
	return policies[isLocale(locale) ? locale : fallbackLanguage]
}
