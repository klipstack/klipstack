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
	// A card on the page (the Notebook's): the web's card color.
	card: "#ffffff",
	border: "#e0ded8",
	// Between the rows of a list: stronger than a border, so each row reads as its own.
	divider: "#d3d0c8",
	accent: "#243f6c",
	accentFg: "#fcfcfc",
	danger: "#c92324",
	// A starred article's star: the web's favorite color.
	favorite: "#a17003",
	// A library's date-stamp ink, on what the reader finished (the web's --k-stamp).
	stamp: "#6a499b",
	// A sheet of plain paper in the drawings, whiter than the page (the web's --k-paper).
	paper: "#fefdfb",
	// A checked article while selecting: washed in the highlighter's yellow (the web's --hl at 45%
	// over the page), not a blue tint. Opaque: the row's own grain is the only grain under it.
	selected: "#fdf1af",
	// Progress through an article: the highlighter's yellow warmed toward orange, so a thin line
	// still shows on the page (the web's ink-line).
	inkLine: "#ffc337",
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
	// The same paper under a reading lamp: warm greys rather than blue ones (the web's dark).
	bg: "#1a1511",
	fg: "#e9e4da",
	muted: "#29231e",
	mutedFg: "#aba398",
	card: "#231e19",
	border: "#3b342d",
	divider: "#463e37",
	accent: "#7faee9",
	accentFg: "#1c140c",
	danger: "#fa695e",
	favorite: "#e0ae57",
	stamp: "#b49ce1",
	paper: "#c8c4bc",
	selected: "#43380d",
	inkLine: "#ffc744",
	// In dark mode, a raised gray rather than an inverted, near-white bar: the player stays on screen
	// for as long as it reads, often in the dark.
	floating: {
		bg: "#332c27",
		fg: "#e9e4da",
		mutedFg: "#aba398",
		border: "#433c35",
		track: "#4e463f",
		accent: "#7faee9",
		accentFg: "#1c140c",
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

/**
 * The app's typefaces. Newsreader is the logo's serif (bundled: assets/fonts, by the expo-font
 * plugin in app.json), as the web's `font-display`: page titles, Home's sections and lead story,
 * covers. Iowan Old Style is the web's `font-serif`: articles' titles in lists, quotes, notes.
 * Newsreader's faces are named by their PostScript names: give them no `fontWeight` or
 * `fontStyle`, or iOS looks for a face that isn't there.
 */
export const fonts = {
	display: "Newsreader-Medium",
	displayText: "Newsreader-Regular",
	displayItalic: "Newsreader-Italic",
	serif: "Iowan Old Style",
} as const

/** Native headers' titles, large and small, in the logo's serif, as the web's page titles. */
export const headerType = {
	headerTitleStyle: { fontFamily: fonts.display },
	headerLargeTitleStyle: { fontFamily: fonts.display },
} as const

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
