const STORE = "https://chromewebstore.google.com/detail/jpaablflkefkjccjgmaibjljcikbemoa"
const SOURCE = "https://github.com/klipstack/klipstack/tree/main/apps/extension"

/**
 * Whether the extension in the Chrome Web Store saves to this server: its server is fixed when it
 * is built (`apps/extension/lib/app-url.ts`), and the store's saves to klipstack.com only.
 */
export function extensionInStore(appUrl: string): boolean {
	return new URL(appUrl).origin === "https://klipstack.com"
}

/**
 * Where "Get the extension" leads: the Chrome Web Store, or for another server's readers the
 * source, to build it for theirs. With a second browser's extension, this should become a page of
 * our own that offers each browser its store (an idea: a public `/extension`).
 */
export function extensionUrl(appUrl: string): string {
	return extensionInStore(appUrl) ? STORE : SOURCE
}
