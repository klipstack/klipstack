import { namespaces, type Resources, resources } from "@klipstack/i18n"
import type { TOptions } from "i18next"
import { useTranslation } from "react-i18next"

type Leaves<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`
}[keyof T & string]

/** A translation key with its namespace (`"auth:login.invalid"`), checked against the English strings. */
export type NsKey = {
	[N in keyof Resources & string]: `${N}:${Leaves<Resources[N]>}`
}[keyof Resources & string]

/** Whether `value` is a key of the English strings: a server message may be a key or plain text. */
export function isNsKey(value: string): value is NsKey {
	const [ns, path] = value.split(":")
	if (!ns || !path || !Object.hasOwn(resources.en, ns)) return false
	let node: unknown = resources.en[ns as keyof Resources]
	for (const part of path.split(".")) {
		if (typeof node !== "object" || node === null || !Object.hasOwn(node, part)) return false
		node = (node as Record<string, unknown>)[part]
	}
	return typeof node === "string"
}

/** Whether `key` is one of `map`'s own keys: a code from the server that may have a string. */
export function isKeyOf<T extends object>(map: T, key: string): key is Extract<keyof T, string> {
	return Object.hasOwn(map, key)
}

/**
 * Translates keys of any namespace. The one place `t` takes a wide key: callers pass an `NsKey`,
 * so a misspelled key still fails to compile.
 */
export function useKeyTranslation() {
	const { t } = useTranslation(namespaces)
	return (key: NsKey, options?: TOptions): string => t(key, options) as string
}
