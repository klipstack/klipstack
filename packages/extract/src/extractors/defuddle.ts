import { Defuddle } from "defuddle/node"
import { packageVersion } from "./package-version"
import type { Extractor, ExtractorResult } from "./types"

const version = packageVersion("defuddle/node", "defuddle")

export const defuddleExtractor: Extractor = {
	name: "defuddle",
	version,
	async extract(doc, url): Promise<ExtractorResult | null> {
		const clone = doc.cloneNode(true) as Document
		const result = await Defuddle(clone, url, {
			url,
			useAsync: false,
			removeImages: false,
			markdown: false,
		})
		if (!result?.content || result.wordCount < 20) return null
		return {
			contentHtml: result.content,
			title: result.title,
			author: result.author,
			excerpt: result.description,
			siteName: result.site,
			language: result.language,
			publishedAt: result.published,
			leadImageUrl: result.image,
			wordCount: result.wordCount,
		}
	},
}
