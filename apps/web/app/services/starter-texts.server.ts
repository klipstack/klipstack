import { and, db, documents, eq, inArray, isNull } from "@klipstack/db"
import {
	STARTER_TOPICS,
	type StarterLanguage,
	type StarterText,
	starterGuide,
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

/** How many books an empty page offers; the rest are on `/texts`. */
const OFFERED = 4

/**
 * What a page with nothing to read offers (Home, the empty library), in the reader's language: the
 * guide while they don't have it, and texts they don't have, one from each topic in turn.
 */
export async function offeredStarterTexts(userId: string, language: StarterLanguage) {
	const guide = starterGuide(language)
	const items = await starterItems(userId, [guide, ...starterTextsIn(language)])
	const unread = items.filter((item) => !item.articleId)
	const byTopic = STARTER_TOPICS.map((topic) => unread.filter((item) => item.topic === topic))
	const texts: StarterItem[] = []
	for (let round = 0; texts.length < OFFERED && byTopic.some((list) => list[round]); round++) {
		for (const list of byTopic) if (list[round] && texts.length < OFFERED) texts.push(list[round]!)
	}
	return { guide: unread.find((item) => item.kind === "guide") ?? null, texts }
}
