/**
 * Where "Get the extension" leads. The store's build saves to klipstack.com only (its server is
 * fixed when it is built, `apps/extension/lib/app-url.ts`), so another server's readers get the
 * source, to build it for theirs.
 */
export function extensionUrl(appUrl: string): string {
	return new URL(appUrl).origin === "https://klipstack.com"
		? "https://chromewebstore.google.com/detail/jpaablflkefkjccjgmaibjljcikbemoa"
		: "https://github.com/klipstack/klipstack/tree/main/apps/extension"
}
