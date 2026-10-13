/**
 * Home's "something different": of the reader's topics with something to read, the one they have
 * read from least lately, one never read from first. Ties go to the topic with more to read, then
 * by name. Nothing with fewer than two topics to choose from: it would be the only one. The web
 * and the mobile app use the same rule, from `GET /topics`' `toRead` and `lastReadAt`.
 */
export function somethingDifferent(
	topics: readonly {
		id: string
		name: string
		toRead: number
		lastReadAt: string | Date | null
	}[],
): string | null {
	const choices = topics.filter((topic) => topic.toRead > 0)
	if (choices.length < 2) return null
	const time = (at: string | Date | null) => (at === null ? 0 : new Date(at).getTime())
	// A copy, sorted: Hermes, in the app, may lack `toSorted`.
	return [...choices].sort(
		(a, b) =>
			time(a.lastReadAt) - time(b.lastReadAt) ||
			b.toRead - a.toRead ||
			a.name.localeCompare(b.name),
	)[0]!.id
}
