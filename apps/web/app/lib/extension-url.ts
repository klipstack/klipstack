export { extensionInStore, extensionUrl } from "@klipstack/email/extension-url"

/**
 * Whether the request comes from a desktop browser the Chrome Web Store's extension installs in:
 * Chromium-based ones (Chrome, Edge, Brave, Opera) name Chromium in `Sec-CH-UA`, which Firefox and
 * Safari do not send, and say `?0` in `Sec-CH-UA-Mobile` on a computer.
 */
export function chromiumDesktop(headers: Headers): boolean {
	return (
		/"Chromium"/.test(headers.get("sec-ch-ua") ?? "") && headers.get("sec-ch-ua-mobile") === "?0"
	)
}
