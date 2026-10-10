import { Readability } from "@mozilla/readability"
import { packageVersion } from "./package-version"
import type { Extractor, ExtractorResult } from "./types"

const version = packageVersion("@mozilla/readability", "@mozilla/readability")

export const readabilityExtractor: Extractor = {
	name: "readability",
	version,
	async extract(doc, _url): Promise<ExtractorResult | null> {
		const clone = doc.cloneNode(true) as Document
		const article = new Readability(clone, { charThreshold: 250, keepClasses: true }).parse()
		if (!article?.content) return null
		return {
			contentHtml: article.content,
			title: article.title,
			author: article.byline,
			excerpt: article.excerpt,
			siteName: article.siteName,
			language: article.lang,
			publishedAt: article.publishedTime,
			wordCount: article.length ? Math.round(article.length / 6) : null,
		}
	},
}
