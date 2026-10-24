/** The extension in the Chrome Web Store, which installs in Chromium browsers on a computer. */
export const CHROME_STORE =
	"https://chromewebstore.google.com/detail/jpaablflkefkjccjgmaibjljcikbemoa"

/**
 * The extension in the Mac App Store, for Safari: `null` until Apple publishes it. Until then,
 * `/extension` says it is coming and Safari is not offered the extension anywhere else.
 */
export const SAFARI_STORE: string | null = null

/** The extension's source, for another server's readers to build it for theirs. */
export const EXTENSION_SOURCE = "https://github.com/klipstack/klipstack/tree/main/apps/extension"

/**
 * Whether the extensions in the stores save to this server: their server is fixed when they are
 * built (`apps/extension/lib/app-url.ts`), and the stores' save to klipstack.com only.
 */
export function extensionInStore(appUrl: string): boolean {
	return new URL(appUrl).origin === "https://klipstack.com"
}

/**
 * Where "Get the extension" leads: this server's `/extension`, which offers each browser its store
 * (or, on another server, the source).
 */
export function extensionUrl(appUrl: string): string {
	return `${appUrl.replace(/\/+$/, "")}/extension`
}
