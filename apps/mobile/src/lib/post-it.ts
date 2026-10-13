/**
 * The geometry of a post-it, the paper every note is written on: the web's PostIt
 * (apps/web/app/components/post-it.tsx). The app's `PostIt` component and the reader page's
 * post-it at the end of the article (`src/page/takeaway.ts`) both size and tilt their paper here,
 * so the two agree.
 */

export type PostItVariant = "full" | "compact"

/** Each note leans its own way, as paper stuck on by hand does: neighbors lean apart. Degrees. */
export const TILTS = {
	full: [-1.4, 1, -0.6, 1.6],
	/** Barely: dense places are read, line after line. */
	compact: [-0.5, 0.4, -0.25, 0.6],
} as const satisfies Record<PostItVariant, readonly number[]>

/** The lean, in degrees, for a note at `tilt` (its place in a list, or `tiltFor` its id). */
export function tiltDegrees(tilt: number, variant: PostItVariant = "full"): number {
	const tilts = TILTS[variant]
	return tilts[((tilt % tilts.length) + tilts.length) % tilts.length]!
}

/** A lean for the note of this id: the same every time, so a note and its editor agree. */
export function tiltFor(id: string): number {
	let n = 0
	for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0
	return n
}

/** A note's text line, in characters: never a sliver, never wider than reads well. */
const MIN_CH = 14
const MAX_CH = 52

/** The least height, as a part of the width: never a strip. */
export const LEAST_HEIGHT = { full: 0.62, compact: 0.5 } as const satisfies Record<
	PostItVariant,
	number
>

/**
 * How many characters wide the paper's line is for this text, so the paper is about square, a
 * little wider than tall: short notes are small squares, longer ones grow toward a balanced
 * rectangle. A line of c characters at the notes' line height is about 2.75 characters tall, so a
 * text of n characters is square at c = √(2.75 n); √(4 n) leans it landscape. A line break starts a
 * line of its own. A link (`[Title](/read/<id>)`) reads as its title.
 */
export function postItChars(text: string): number {
	const shown = text.trim().replace(/\[([^\]]*)\]\(\/read\/[^)\s]*\)/g, "$1")
	const breaks = shown.split("\n").length - 1
	const length = shown.length + breaks * 24
	return Math.round(Math.min(MAX_CH, Math.max(MIN_CH, Math.sqrt(4 * length))))
}

/**
 * For an editor: the longest of `text` and what it held before (`longest`), so its paper grows as
 * it is written and never shrinks under the caret.
 */
export function growingFit(longest: string, text: string): string {
	return text.length > longest.length ? text : longest
}
