/** How long a page that started loading another ignores the worker's reload: past it, the load stopped. */
const LEAVING_MS = 10_000

/** Registers the service worker (public/sw.js) and feeds it what to keep available offline. */
export function registerServiceWorker() {
	if (!("serviceWorker" in navigator)) return
	// A page that has started loading another discards its rendered data anyway, and its reload
	// would cancel that load (Safari does): leaving a page with a wider policy, a sign-in's redirect.
	let leavingUntil = 0
	window.addEventListener("beforeunload", () => (leavingUntil = Date.now() + LEAVING_MS))
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data?.type !== "session-changed") return
		if (Date.now() < leavingUntil) return
		// Other tabs must discard rendered private data as well as cached responses.
		window.location.reload()
	})
	const version =
		document.querySelector('meta[name="app-version"]')?.getAttribute("content") ?? "dev"
	const register = () => {
		// The version in the URL: a deploy makes the browser see a new worker.
		navigator.serviceWorker.register(`/sw.js?v=${version}`).catch((error) => {
			console.warn("[offline] service worker registration failed", error)
		})
	}
	// The entry module is loaded with a dynamic import, so `load` may already have fired.
	if (document.readyState === "complete") register()
	else window.addEventListener("load", register, { once: true })
}

/** A request the same as the last one, this soon after it, is not sent again. */
const REPEAT_AFTER_MS = 60_000
let lastWarm: { key: string; at: number } | null = null

/**
 * Asks the worker to cache these list pages and articles (URLs) for offline reading. `lists` get
 * their route data only (views reached by client navigation, like the inbox filters). Lists call
 * this on every render, live updates included: a repeat within a minute is dropped, and the worker
 * skips articles it stored recently.
 */
export function warmOffline(pages: string[], articles: string[], lists: string[] = []) {
	if (!("serviceWorker" in navigator)) return
	if (typeof navigator.onLine === "boolean" && !navigator.onLine) return
	const key = JSON.stringify([pages, articles, lists])
	if (lastWarm?.key === key && Date.now() - lastWarm.at < REPEAT_AFTER_MS) return
	lastWarm = { key, at: Date.now() }
	navigator.serviceWorker.ready
		.then((registration) =>
			registration.active?.postMessage({
				type: "warm",
				pages,
				articles,
				lists,
				identity: document.querySelector('meta[name="cache-identity"]')?.getAttribute("content"),
			}),
		)
		.catch(() => undefined)
}
