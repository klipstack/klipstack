export interface ExtractorResult {
	contentHtml: string
	title?: string | null
	author?: string | null
	excerpt?: string | null
	siteName?: string | null
	language?: string | null
	publishedAt?: string | null
	leadImageUrl?: string | null
	/** Extractor's own word count, if it computes one. */
	wordCount?: number | null
}

export interface Extractor {
	readonly name: string
	readonly version: string
	/** Must not mutate `doc`; clone if needed. Returns null when no article was found. */
	extract(doc: Document, url: string): Promise<ExtractorResult | null>
}
