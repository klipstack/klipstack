/** The reader's type settings, kept on the device. Pure: storage is in `reader-files.ts`. */
export const TEXT_SIZES = [
	{ id: "small", label: "Small", factor: 0.875 },
	{ id: "default", label: "Default", factor: 1 },
	{ id: "large", label: "Large", factor: 1.15 },
	{ id: "larger", label: "Larger", factor: 1.3 },
	{ id: "largest", label: "Largest", factor: 1.5 },
] as const

export type TextSizeId = (typeof TEXT_SIZES)[number]["id"]

export type TypePrefs = { size: TextSizeId; sans: boolean }

export const DEFAULT_TYPE_PREFS: TypePrefs = { size: "default", sans: false }

/** Stored JSON to settings; anything unknown falls back to the default. */
export function parseTypePrefs(raw: string | null | undefined): TypePrefs {
	try {
		const value = JSON.parse(raw ?? "") as Partial<TypePrefs> | null
		return {
			size: TEXT_SIZES.some((s) => s.id === value?.size)
				? (value?.size as TextSizeId)
				: DEFAULT_TYPE_PREFS.size,
			sans: value?.sans === true,
		}
	} catch {
		return DEFAULT_TYPE_PREFS
	}
}

/** The page's text scale: the chosen size on top of the system text size (Dynamic Type). */
export function textScale(size: TextSizeId, systemScale = 1): number {
	const factor = TEXT_SIZES.find((s) => s.id === size)?.factor ?? 1
	return factor * (Number.isFinite(systemScale) ? systemScale : 1)
}

/** The size a step smaller (`by` -1) or larger (1), kept within the list; the same at either end. */
export function stepTextSize(size: TextSizeId, by: -1 | 1): TextSizeId {
	const at = TEXT_SIZES.findIndex((s) => s.id === size)
	const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, at + by))
	return TEXT_SIZES[next]!.id
}
