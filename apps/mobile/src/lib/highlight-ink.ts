/**
 * The marker stroke under a highlight's text, one per line: the web's (apps/web/app/lib/
 * highlight-ink.ts), which the reader page draws (`src/page/ink.ts`) and `MarkerText` draws under a
 * quote in the app's lists.
 * Like `.marker` in app.css, a stroke is 80% as tall as the line's text (about 70% of the line
 * height at the reader's spacing) and sits low in it, so the
 * tops of tall letters stand above it. Each one varies a little, as a hand-drawn stroke does: its
 * ends, a hint of slant. The variation comes from a seed, so a stroke keeps its shape when the text
 * reflows or the page renders again.
 */

/** Of the text's height, as `.marker`'s background size and position. */
export const INK_HEIGHT = 0.8
export const INK_DROP = 0.9

export interface Rect {
	left: number
	top: number
	right: number
	bottom: number
}

export interface Stroke {
	/** Which line of the highlight, from 0. */
	line: number
	left: number
	top: number
	width: number
	height: number
	/** Degrees. */
	tilt: number
	/** A CSS `border-radius`: the ends, rounder or squarer, never quite the same. */
	radius: string
	/**
	 * The corners' radii along the line, as in `radius` (top left, top right, bottom right, bottom
	 * left): React Native's corners are round, not elliptical.
	 */
	corners: [number, number, number, number]
}

/**
 * Joins a range's rectangles into lines, in reading order. A line split by links, emphasis or code
 * has several; they make one. Empty rectangles (line ends, collapsed whitespace) are skipped.
 */
export function inkLines(rects: Iterable<Rect>): Rect[] {
	const lines: Rect[] = []
	for (const r of rects) {
		if (r.right - r.left < 1 || r.bottom - r.top < 1) continue
		const mid = (r.top + r.bottom) / 2
		const line = lines.find((l) => mid > l.top && mid < l.bottom)
		if (line) {
			line.left = Math.min(line.left, r.left)
			line.right = Math.max(line.right, r.right)
			line.top = Math.min(line.top, r.top)
			line.bottom = Math.max(line.bottom, r.bottom)
		} else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
	}
	return lines
}

/** A stroke over one line of text, relative to `origin`. `seed` and `line` choose its quirks. */
export function inkStroke(
	line: Rect,
	origin: { left: number; top: number },
	seed: string,
	index: number,
): Stroke {
	const random = randomFrom(`${seed}:${index}`)
	const text = line.bottom - line.top
	const height = text * INK_HEIGHT
	// The pen lands a little before the first letter and lifts a little after the last.
	const before = height * (0.08 + random() * 0.1)
	const after = height * (0.1 + random() * 0.14)
	const end = () => Number((height * (0.25 + random() * 0.3)).toFixed(1))
	const across = () => `${(height * (0.35 + random() * 0.25)).toFixed(1)}px`
	// In the web's order, so a highlight's strokes have the same shapes there and here.
	const top = line.top - origin.top + (text - height) * INK_DROP + height * (random() - 0.5) * 0.06
	const tilt = Number(((random() - 0.5) * 0.7).toFixed(2))
	const corners: Stroke["corners"] = [end(), end(), end(), end()]
	const radius = `${corners.map((c) => `${c}px`).join(" ")} / ${across()} ${across()} ${across()} ${across()}`
	return {
		line: index,
		left: line.left - origin.left - before,
		top,
		width: line.right - line.left + before + after,
		height,
		tilt,
		radius,
		corners,
	}
}

/** A repeatable sequence of numbers in [0, 1) for a string (FNV-1a, then mulberry32). */
export function randomFrom(seed: string): () => number {
	let state = 0x811c9dc5
	for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193)
	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export interface Crossing {
	left: number
	top: number
	width: number
	height: number
	/** The two inks, by color name. */
	colors: [string, string]
	/** The two highlights (their seeds). */
	keys: [string, string]
}

/**
 * Where strokes of two highlights lie on each other, on the same line: there the ink is darker, as
 * a marker's over another's. Drawn as a piece of its own, not with a blend mode, which composites
 * slowly in WebKit over a long article.
 */
export function inkCrossings(
	painted: Array<{ key: string; color: string; strokes: Stroke[] }>,
): Crossing[] {
	const all = painted
		.flatMap((p) => p.strokes.map((s) => ({ ...s, key: p.key, color: p.color })))
		.sort((a, b) => a.top - b.top)
	const out: Crossing[] = []
	for (let i = 0; i < all.length; i++) {
		const a = all[i]!
		for (let j = i + 1; j < all.length; j++) {
			const b = all[j]!
			if (b.top >= a.top + a.height / 2) break
			if (a.key === b.key) continue
			const left = Math.max(a.left, b.left)
			const right = Math.min(a.left + a.width, b.left + b.width)
			if (right - left < 1) continue
			const top = Math.max(a.top, b.top)
			const bottom = Math.min(a.top + a.height, b.top + b.height)
			out.push({
				left,
				top,
				width: right - left,
				height: bottom - top,
				colors: [a.color, b.color],
				keys: [a.key, b.key],
			})
		}
	}
	return out
}
