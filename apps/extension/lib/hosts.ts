/** Servers the extension may always reach: klipstack.com, and one on this computer. */
export const APP_HOSTS = ["https://klipstack.com/*", "http://localhost/*", "http://127.0.0.1/*"]

/** Any other server, reached only once the user allows it from the options page. */
export const OTHER_HOSTS = ["https://*/*", "http://*/*"]

/** The match pattern that gives access to a Klipstack server's address. Without its port: Firefox
 * refuses patterns with one, and one without covers every port. */
export function originPattern(appUrl: string): string {
	const { protocol, hostname } = new URL(appUrl)
	return `${protocol}//${hostname}/*`
}
