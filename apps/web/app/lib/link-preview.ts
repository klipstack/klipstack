/** Public page metadata only; opening a preview never creates a saved article. */
export interface LinkPreview {
	title: string | null
	description: string | null
	author: string | null
	siteName: string | null
	imageUrl: string | null
}
