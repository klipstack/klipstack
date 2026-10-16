import { and, db, documents, eq, inArray, isNull, notInArray } from "@klipstack/db"
import {
	STARTER_TOPICS,
	type StarterLanguage,
	type StarterText,
	starterGuide,
	starterTexts,
	starterTextsIn,
	starterUrlHash,
} from "~/lib/starter-texts.server"

/** Which of `texts` the reader has in their library (not in the trash): slug to article id. */
export async function savedStarterTexts(
	userId: string,
	texts: StarterText[],
): Promise<Map<string, string>> {
	const byHash = new Map(texts.map((text) => [starterUrlHash(text), text.slug]))
	if (!byHash.size) return new Map()
	const rows = await db
		.select({ id: documents.id, urlHash: documents.urlHash })
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				inArray(documents.urlHash, [...byHash.keys()]),
				isNull(documents.deletedAt),
			),
		)
	return new Map(rows.map((row) => [byHash.get(row.urlHash)!, row.id]))
}

/** What a page shows of a starter text: no page, and the reader's copy when they have one. */
export type StarterItem = Omit<StarterText, "html" | "article" | "url"> & {
	articleId: string | null
}

/** `texts`, as the reader's lists show them. */
export async function starterItems(userId: string, texts: StarterText[]): Promise<StarterItem[]> {
	const saved = await savedStarterTexts(userId, texts)
	return texts.map(({ html: _html, article: _article, url: _url, ...text }) => ({
		...text,
		articleId: saved.get(text.slug) ?? null,
	}))
}

/**
 * How many saved articles, the trash and the starter texts aside, make a reader no longer new to
 * Klipstack: ten books added from these shelves are still a first visit.
 */
const EXPERIENCED = 10

/** Whether the reader has saved enough to know their way around: the guide is not for them first. */
export async function experiencedReader(userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: documents.id })
		.from(documents)
		.where(
			and(
				eq(documents.userId, userId),
				isNull(documents.deletedAt),
				notInArray(documents.urlHash, starterTexts().map(starterUrlHash)),
			),
		)
		.limit(EXPERIENCED)
	return rows.length >= EXPERIENCED
}

/** How many books an empty page offers; the rest are on `/texts`. */
const OFFERED = 4

/**
 * What a page with nothing to read offers (Home, the empty library), in the reader's language: the
 * guide while they don't have it and are new, and texts that ship with the app they don't have, one
 * from each topic in turn.
 */
export async function offeredStarterTexts(userId: string, language: StarterLanguage) {
	const guide = starterGuide(language)
	const [items, experienced] = await Promise.all([
		starterItems(userId, [guide, ...starterTextsIn(language)]),
		experiencedReader(userId),
	])
	const unread = items.filter((item) => !item.articleId)
	// The ones that ship with the app: they open at once, and on any server.
	const bundled = unread.filter((item) => item.kind === "text")
	const byTopic = STARTER_TOPICS.map((topic) => bundled.filter((item) => item.topic === topic))
	const texts: StarterItem[] = []
	for (let round = 0; texts.length < OFFERED && byTopic.some((list) => list[round]); round++) {
		for (const list of byTopic) if (list[round] && texts.length < OFFERED) texts.push(list[round]!)
	}
	const offered = experienced ? null : unread.find((item) => item.kind === "guide")
	return { guide: offered ?? null, texts }
}
