import { and, db, documents, eq, inArray, isNull } from "@klipstack/db"
import { type StarterText, starterUrlHash } from "~/lib/starter-texts.server"

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
