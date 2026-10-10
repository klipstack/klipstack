/**
 * A quote without the Markdown that get_article adds: assistants tend to copy it along. Links and
 * images keep their text; emphasis, code, heading, list and quote markers and backslash escapes go.
 */
export function plainQuote(quote: string): string {
	return quote
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(^|[^\w*\\])\*([^*\n]+)\*(?![\w*])/g, "$1$2")
		.replace(/(^|[^\w_\\])_([^_\n]+)_(?![\w_])/g, "$1$2")
		.replace(/`([^`\n]*)`/g, "$1")
		.replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, "")
		.replace(/\\([\\`*_{}[\]()#+\-.!<>&|~])/g, "$1")
		.trim()
}
