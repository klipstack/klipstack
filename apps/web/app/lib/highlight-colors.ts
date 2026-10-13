import { HIGHLIGHT_COLORS, type HighlightColor } from "@klipstack/api-contract/enums"

/** The stored colors' names, by index: the API, MCP and the mobile app name them so. */
export const HIGHLIGHT_COLOR_NAMES = HIGHLIGHT_COLORS

/** A new highlight's color: yellow. */
export const DEFAULT_HIGHLIGHT_COLOR = 0

/** The name of a stored color; yellow for one that is missing or out of range. */
export function highlightColorName(color: number | null | undefined): HighlightColor {
	return HIGHLIGHT_COLOR_NAMES[color ?? DEFAULT_HIGHLIGHT_COLOR] ?? "yellow"
}

/**
 * Puts a highlight's color in hand for an element and what is inside it: `--hl` (its wash) and
 * `--hl-solid` (its line), set by `[data-hl]` in app.css.
 */
export const highlightColor = (color: number | null | undefined) => ({
	"data-hl": highlightColorName(color),
})

/** A strip or dot in the color in hand (`highlightColor`). */
export const HIGHLIGHT_SWATCH = "bg-(--hl-solid)"
