export {
	CHROME_STORE,
	EXTENSION_SOURCE,
	extensionInStore,
	extensionUrl,
	SAFARI_STORE,
} from "@klipstack/email/extension-url"

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

/**
 * Whether the request comes from Safari on a Mac, which the Mac App Store's extension installs in.
 * Safari sends no client hints, so this reads the user agent: a Mac's, with Safari's `Version/`,
 * and none of the other browsers that also say `Safari/` there. An iPad asking for the desktop site
 * says the same, and can't be told apart.
 */
export function safariMac(headers: Headers): boolean {
	const agent = headers.get("user-agent") ?? ""
	return (
		/\(Macintosh;/.test(agent) &&
		/ Version\/[\d.]+.* Safari\//.test(agent) &&
		!/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(agent)
	)
}
