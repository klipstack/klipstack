/** Light or dark mode for the whole app: the system's, or one chosen in the reader's Appearance. */
import { t } from "./i18n"

export type ColorSchemePref = "system" | "light" | "dark"

export const COLOR_SCHEMES = [
	{ id: "system", label: t("reader.colorSchemes.system") },
	{ id: "light", label: t("reader.colorSchemes.light") },
	{ id: "dark", label: t("reader.colorSchemes.dark") },
] as const satisfies ReadonlyArray<{ id: ColorSchemePref; label: string }>

/** Stored JSON to a choice; anything unknown follows the system. */
export function parseColorScheme(raw: string | null | undefined): ColorSchemePref {
	try {
		const value: unknown = JSON.parse(raw ?? "")
		return COLOR_SCHEMES.some((s) => s.id === value) ? (value as ColorSchemePref) : "system"
	} catch {
		return "system"
	}
}
