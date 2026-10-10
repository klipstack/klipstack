import type { Resource } from "i18next"
import en from "./locales/en"
import es from "./locales/es"

export const resources = { en, es } satisfies Resource
export const supportedLanguages = ["en", "es"] as const
export const fallbackLanguage = "en" as const
export const defaultNamespace = "common" as const
export const namespaces = Object.keys(en) as Array<keyof typeof en>

export type Locale = (typeof supportedLanguages)[number]
export type Resources = typeof en

export function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && (supportedLanguages as readonly string[]).includes(value)
}
