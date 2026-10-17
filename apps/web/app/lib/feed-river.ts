import { type DateGroup, dateGroup } from "./date-groups"

/**
 * The feed page as one river of posts by date, rather than a box per site: every followed site's
 * posts together, newest first, each dated in the reader's day. Safe to import from client code.
 */

export interface RiverSource {
	id: string
	title: string
	siteUrl: string
}

export interface RiverPost<I> {
	item: I
	source: RiverSource
	/** Its day, in the reader's time zone (`dateGroup`). */
	group: DateGroup
}

interface RiverItem {
	id: string
	url: string
	sortAt: Date
}

/**
 * Every site's posts in one list, newest first. A post two feeds carry (a site's feed and its
 * category's) shows once, the first time it comes.
 */
export function riverPosts<I extends RiverItem>(
	sections: Array<RiverSource & { items: I[] }>,
	now: Date,
	timeZone: string,
): Array<RiverPost<I>> {
	const posts = sections
		.flatMap(({ items, id, title, siteUrl }) =>
			items.map((item) => ({ item, source: { id, title, siteUrl } })),
		)
		.sort(
			(a, b) =>
				+new Date(b.item.sortAt) - +new Date(a.item.sortAt) || a.item.id.localeCompare(b.item.id),
		)
	const urls = new Set<string>()
	return posts.flatMap((post) => {
		if (urls.has(post.item.url)) return []
		urls.add(post.item.url)
		return [{ ...post, group: dateGroup(new Date(post.item.sortAt), now, timeZone) }]
	})
}

/** The posts `keep` chooses, in runs of the same day, for a heading over each. */
export function groupRiver<P extends { group: DateGroup }>(
	posts: P[],
	keep: (post: P) => boolean,
): Array<{ group: DateGroup; posts: P[] }> {
	const groups: Array<{ group: DateGroup; posts: P[] }> = []
	for (const post of posts) {
		if (!keep(post)) continue
		const last = groups.at(-1)
		if (last?.group === post.group) last.posts.push(post)
		else groups.push({ group: post.group, posts: [post] })
	}
	return groups
}
