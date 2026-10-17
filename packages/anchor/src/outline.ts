/** A heading of the article's own structure, for its contents. */
export interface OutlineEntry {
	/** Its text, numbered when an earlier heading has the same: unique within the outline. */
	key: string
	el: HTMLElement
	text: string
	/** 0 for the article's highest heading level, 1 for every lower one. */
	depth: 0 | 1
}

/** Headings inside these are part of a list, a quote or a card, not the article's structure. */
const NESTED = "li,td,th,blockquote,aside,figure,details"

/** Fewer headings than this make no outline. */
export const OUTLINE_MIN_ENTRIES = 3

/**
 * The article's own headings (h2–h6, none inside a list, a quote, a table, a figure, an aside or
 * details), in two levels: its highest heading level, and every lower one under it. The web
 * reader's Contents and the iPhone reader's both show these, and nothing when there are fewer than
 * `OUTLINE_MIN_ENTRIES`.
 */
export function outlineOf(root: Element): OutlineEntry[] {
	const found = Array.from(root.querySelectorAll<HTMLElement>("h2,h3,h4,h5,h6"))
		.filter((h) => !h.closest(NESTED))
		.map((el) => ({
			el,
			level: Number(el.tagName[1]),
			text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
		}))
		.filter((h) => h.text)
	const top = Math.min(...found.map((h) => h.level))
	const seen = new Map<string, number>()
	return found.map((h) => {
		const n = seen.get(h.text) ?? 0
		seen.set(h.text, n + 1)
		return { key: `${h.text}#${n}`, el: h.el, text: h.text, depth: h.level === top ? 0 : 1 }
	})
}

/**
 * The section being read: the last of the entries' headings at or above `line` (points from the
 * top of the screen), -1 before the first.
 */
export function currentSection(entries: ReadonlyArray<{ el: HTMLElement }>, line: number): number {
	let current = -1
	for (const [i, entry] of entries.entries()) {
		if (entry.el.getBoundingClientRect().top <= line) current = i
		else break
	}
	return current
}
