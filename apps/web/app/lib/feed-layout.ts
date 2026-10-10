import type { FeedSection } from "~/services/feeds.server"

/** One unsaved post per source, newest first, without repeating a syndicated URL. */
export function latestFeedItems(sections: FeedSection[]) {
	const candidates = sections
		.flatMap((section) => {
			const item = section.items.find((item) => !item.documentId)
			return item ? [{ item, source: section }] : []
		})
		.sort(
			(a, b) =>
				+new Date(b.item.sortAt) - +new Date(a.item.sortAt) || a.item.id.localeCompare(b.item.id),
		)
	const urls = new Set<string>()
	return candidates
		.filter(({ item }) => {
			if (urls.has(item.url)) return false
			urls.add(item.url)
			return true
		})
		.slice(0, 3)
}
