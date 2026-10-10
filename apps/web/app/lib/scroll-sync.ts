/**
 * Two views of the same list, side by side, kept at the same place: the editor and its preview.
 * Each side is cut into the same parts (the top, then each item), given as the part's starts and
 * the end of the last. A point in one side is a part and how far through it; the other side goes
 * to the same part, as far through. Framework-free.
 */

/**
 * Where `line` in `from` falls in `to`. Both are ascending boundaries: `[start, item 1, …, end]`.
 * A line before the first or past the last boundary stays at that end. When the sides do not
 * have the same parts (a preview not yet updated), the last part of the shorter one takes the
 * rest.
 */
export function mapLine(from: readonly number[], line: number, to: readonly number[]): number {
	if (from.length < 2 || to.length < 2) return to[0] ?? 0
	if (line <= from[0]!) return to[0]!
	if (line >= from.at(-1)!) return to.at(-1)!
	let part = 0
	while (part < from.length - 2 && line >= from[part + 1]!) part++
	const through = (line - from[part]!) / Math.max(1, from[part + 1]! - from[part]!)
	const at = Math.min(part, to.length - 2)
	return to[at]! + through * (to[at + 1]! - to[at]!)
}

/** The reading line, a third of the way down each side: what the eye is on. */
export const LINE = 1 / 3

/**
 * Where the reading line is in a view of height `height`, as a fraction of it. A third of the way
 * down, but near the start it rises to the top edge, and near the end it sinks to the bottom one:
 * a side at its start or end takes the other to its start or end, however long each is.
 */
export function lineAt(scrolled: number, height: number, max: number): number {
	const left = max - scrolled
	if (left < (1 - LINE) * height) return 1 - Math.max(0, left) / height
	if (scrolled < LINE * height) return Math.max(0, scrolled) / height
	return LINE
}
