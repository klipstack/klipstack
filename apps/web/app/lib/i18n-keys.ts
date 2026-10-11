import type { Resources } from "@klipstack/i18n"
import { fallbackLanguage, namespaces } from "@klipstack/i18n/languages"
import type { i18n as I18n, TOptions } from "i18next"
import { useTranslation } from "react-i18next"

type Leaves<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`
}[keyof T & string]

/** A translation key with its namespace (`"auth:login.invalid"`), checked against the English strings. */
export type NsKey = {
	[N in keyof Resources & string]: `${N}:${Leaves<Resources[N]>}`
}[keyof Resources & string]

/**
 * Whether `value` is a key of the English strings: a server message may be a key or plain text.
 * Reads them from `i18n`, which has them loaded on the server and in the browser alike: the client
 * bundle does not carry the strings.
 */
export function isNsKey(
	i18n: Pick<I18n, "getResource" | "language">,
	value: string,
): value is NsKey {
	const [ns, path] = value.split(":")
	if (!ns || !path || !(namespaces as readonly string[]).includes(ns)) return false
	// English has every key; the reader's own strings stand in if English failed to load.
	return [fallbackLanguage, i18n.language].some(
		(lng) => typeof i18n.getResource(lng, ns, path) === "string",
	)
}

/** `isNsKey` with the page's strings. */
export function useIsNsKey() {
	const { i18n } = useTranslation()
	return (value: string): value is NsKey => isNsKey(i18n, value)
}

/**
 * Translates keys of any namespace. The one place `t` takes a wide key: callers pass an `NsKey`,
 * so a misspelled key still fails to compile.
 */
export function useKeyTranslation() {
	const { t } = useTranslation(namespaces)
	return (key: NsKey, options?: TOptions): string => t(key, options) as string
}
