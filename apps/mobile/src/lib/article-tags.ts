import { cleanTagName } from "@klipstack/api-contract/names"

/** What the tag sheet needs of an article: an article of a list, or the reader's. */
export type Tagged = { id: string; tags: string[] }

/** Whether all the articles have a tag, some of them, or none. Names match whatever their case. */
export function tagState(articles: Tagged[], name: string): "all" | "some" | "none" {
	const having = articles.filter((a) => hasTag(a, name)).length
	return having === 0 ? "none" : having === articles.length ? "all" : "some"
}

/**
 * What a tap on a tag does, as multi-select's toggles decide it: it adds the tag when any article
 * lacks it, and takes it away when all have it.
 */
export function tagChange(
	articles: Tagged[],
	name: string,
): { addTags: [string] } | { removeTags: [string] } {
	return tagState(articles, name) === "all" ? { removeTags: [name] } : { addTags: [name] }
}

/** The articles' tags once the change is made, for showing it before the server answers. */
export function withChange(
	articles: Tagged[],
	change: { addTags: [string] } | { removeTags: [string] },
): Map<string, string[]> {
	return new Map(
		articles.map((a) => {
			if ("removeTags" in change) {
				const name = change.removeTags[0].toLowerCase()
				return [a.id, a.tags.filter((t) => t.toLowerCase() !== name)]
			}
			const name = change.addTags[0]
			return [a.id, hasTag(a, name) ? a.tags : [...a.tags, name]]
		}),
	)
}

/**
 * The tags to list for what is typed: all of them, or those whose name has the text in it. A name
 * no tag has yet, cleaned as the server cleans it, is offered to create (`create`); null when a
 * tag has it already, whatever its case, or it can't be a tag's name.
 */
export function tagChoices(
	names: string[],
	typed: string,
): { names: string[]; create: string | null } {
	const text = typed.trim().toLowerCase()
	if (!text) return { names, create: null }
	const clean = cleanTagName(typed)
	return {
		names: names.filter((n) => n.toLowerCase().includes(text)),
		create: clean && !names.some((n) => n.toLowerCase() === clean.toLowerCase()) ? clean : null,
	}
}

/** The article with the tags the sheet reports for it, or as it was. */
export function retagged<T extends Tagged>(article: T, tags: Map<string, string[]>): T {
	const now = tags.get(article.id)
	return now ? { ...article, tags: now } : article
}

function hasTag(article: Tagged, name: string): boolean {
	const wanted = name.toLowerCase()
	return article.tags.some((t) => t.toLowerCase() === wanted)
}
