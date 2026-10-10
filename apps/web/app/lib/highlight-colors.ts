import { HIGHLIGHT_COLORS } from "@klipstack/api-contract/enums"

/**
 * The web shows every highlight in one color (`--hl` in app.css). The stored color and its names
 * stay for the API, MCP and the mobile app.
 */
export const HIGHLIGHT_SWATCH = "bg-(--hl)"
export const HIGHLIGHT_COLOR_NAMES = HIGHLIGHT_COLORS
