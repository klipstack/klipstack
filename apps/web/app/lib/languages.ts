/**
 * A language's name in the app's language, as the reader writes it in a sentence ("This article
 * is in Chinese", "Este artículo está en chino"). The code when the browser doesn't know it.
 */
export function languageName(code: string, locale: string): string {
	try {
		return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
	} catch {
		return code
	}
}
