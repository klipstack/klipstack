/** Light or dark mode for the whole app: the system's, or one chosen in the reader's Appearance. */
export type ColorSchemePref = "system" | "light" | "dark"

export const COLOR_SCHEMES = [
	{ id: "system", label: "Auto" },
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
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
