import type { HighlightColor } from "@klipstack/api-contract/enums"
import { Appearance, useColorScheme } from "react-native"
import type { ColorSchemePref } from "./color-scheme"

// The web app's tokens (apps/web/app/app.css), converted from oklch to hex.
const light = {
	bg: "#fbfaf7",
	fg: "#1a1d23",
	muted: "#f2f0ec",
	mutedFg: "#5f646b",
	border: "#e0ded8",
	// Between the rows of a list: stronger than a border, so each row reads as its own.
	divider: "#d3d0c8",
	accent: "#243f6c",
	accentFg: "#fcfcfc",
	danger: "#c92324",
	// A starred article's star: the web's favorite color.
	favorite: "#a17003",
	// A checked article while selecting: the web's selected color, at its 60%.
	selected: "#b8cce699",
	// Bars that float over the page (the player, the finish bar) stand apart from it: dark in light
	// mode, as the web's selection bar and toasts are, with its inverse link color as the accent.
	floating: {
		bg: "#1a1d23",
		fg: "#fbfaf7",
		mutedFg: "#a6abb2",
		border: "#1a1d23",
		track: "#3a3f47",
		accent: "#7faee9",
		accentFg: "#0d141f",
	},
	// The reader page's highlight colors (reader-html.ts), without their transparency.
	highlight: {
		yellow: "#ffe658",
		green: "#a1f7a3",
		blue: "#a0e7ff",
		pink: "#ffbde9",
		orange: "#ffc480",
	} satisfies Record<HighlightColor, string>,
	// The colors at full strength (the web's --hl-N-solid), the same in dark mode: the marker tips,
	// the line around the highlight in focus, the rule beside its note.
	nib: {
		yellow: "#ffdc3a",
		green: "#85e98a",
		blue: "#80d8ff",
		pink: "#ffa6db",
		orange: "#ffaf5e",
	} satisfies Record<HighlightColor, string>,
}

const dark: typeof light = {
	bg: "#111419",
	fg: "#e9e8e3",
	muted: "#21252d",
	mutedFg: "#999fa8",
	border: "#31363d",
	divider: "#3d434c",
	accent: "#7faee9",
	accentFg: "#0d141f",
	danger: "#fa695e",
	favorite: "#e0ae57",
	selected: "#233f6399",
	// In dark mode, a raised gray rather than an inverted, near-white bar: the player stays on screen
	// for as long as it reads, often in the dark.
	floating: {
		bg: "#2b3038",
		fg: "#e9e8e3",
		mutedFg: "#a6acb5",
		border: "#3a4049",
		track: "#444a54",
		accent: "#7faee9",
		accentFg: "#0d141f",
	},
	highlight: {
		yellow: "#ba9c13",
		green: "#57a45b",
		blue: "#5197c6",
		pink: "#c56f99",
		orange: "#cf752d",
	},
	nib: light.nib,
}

export type Colors = typeof light

export function useColors(): Colors {
	return useColorScheme() === "dark" ? dark : light
}

/** Sets light or dark mode for every screen, native bars and the reader's page included. */
export function applyColorScheme(scheme: ColorSchemePref): void {
	Appearance.setColorScheme(scheme === "system" ? "unspecified" : scheme)
}
