/**
 * The links in what a reader typed or pasted into the Save link field: one per line, or several on
 * a line separated by spaces when each is a link (a link has no spaces). Anything else on a line is
 * one entry, saved or refused on its own (`saveLinks`).
 */
export function splitLinks(text: string): string[] {
	return text.split(/\r?\n/).flatMap((line) => {
		const words = line.trim().split(/\s+/).filter(Boolean)
		if (words.length > 1 && words.every((word) => /^https?:\/\/\S+$/i.test(word))) return words
		return words.length ? [words.join(" ")] : []
	})
}
