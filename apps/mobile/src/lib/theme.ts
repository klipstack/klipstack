import type { HighlightColor } from "@klipstack/api-contract/enums"
import { Appearance, useColorScheme } from "react-native"
import type { ColorSchemePref } from "./color-scheme"
import { NOTE_PAPER, type NotePaper } from "./post-it"

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
	// The Topics screen's shelves: the board, the titles on the spines, a new book's top (the web's
	// --k-shelf, --k-book-fg and --k-link). The spines' own colors come from `topic-shelves.ts`.
	shelf: { board: "#dccfc0", bookFg: "#212730", recent: "#0f5ab5" },
	// A note's paper, its ink and its tape (the web's --k-note, --k-note-fg, --k-note-tape), unlike
	// the article's own words: the classic paper (`note`), and a highlight's note's paper in its
	// highlight's color (`notes`; `PostIt`'s `color`).
	note: NOTE_PAPER.light.yellow as NotePaper,
	notes: NOTE_PAPER.light as Record<HighlightColor, NotePaper>,
	// The highlights' marker ink (the web's --hl-N, as the reader page's): opaque, under the text.
	highlight: {
		yellow: "#ffe657",
		green: "#9cf2b3",
		blue: "#9edeff",
		pink: "#ffbcd7",
		orange: "#ffc487",
	} satisfies Record<HighlightColor, string>,
	// The colors at full strength (the web's --hl-N-solid): the marker tips, the line around the
	// highlight in focus, a noted highlight's tab.
	nib: {
		yellow: "#ffdc3a",
		green: "#6ed889",
		blue: "#5fb8f2",
		pink: "#f589b6",
		orange: "#ffa14b",
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
	shelf: { board: "#493a2d", bookFg: "#f1eee7", recent: "#83bdf8" },
	note: NOTE_PAPER.dark.yellow,
	notes: NOTE_PAPER.dark,
	// Deep inks under light text, as a highlighter's in the dark.
	highlight: {
		yellow: "#756208",
		green: "#22683b",
		blue: "#185b92",
		pink: "#8c395e",
		orange: "#964d09",
	},
	nib: {
		yellow: "#ffdc3a",
		green: "#75df8f",
		blue: "#69c1fc",
		pink: "#fc96bf",
		orange: "#ffad5f",
	},
}

export type Colors = typeof light

/** Light or dark, as the screens draw it now. */
export function useScheme(): "light" | "dark" {
	return useColorScheme() === "dark" ? "dark" : "light"
}

export function useColors(): Colors {
	return useColorScheme() === "dark" ? dark : light
}

/** Sets light or dark mode for every screen, native bars and the reader's page included. */
export function applyColorScheme(scheme: ColorSchemePref): void {
	Appearance.setColorScheme(scheme === "system" ? "unspecified" : scheme)
}
