/**
 * The languages and namespaces, without their strings: what the browser needs to set up i18next.
 * It loads the strings from `/api/locales`, so client code imports from here, not from the
 * package's root, which would put every string of every language in its bundle.
 */
export const supportedLanguages = ["en", "es"] as const
export const fallbackLanguage = "en" as const
export const defaultNamespace = "common" as const
export const namespaces = [
	"common",
	"auth",
	"settings",
	"library",
	"reader",
	"feed",
	"admin",
	"editions",
] as const

export type Locale = (typeof supportedLanguages)[number]

export function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && (supportedLanguages as readonly string[]).includes(value)
}
