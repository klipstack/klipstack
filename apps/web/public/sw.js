/* Offline reading. Only server-confirmed session partitions hold private responses. */
const VERSION = "v6"
const ASSETS = `assets-${VERSION}`
const META = `offline-session-${VERSION}`
const PRIVATE = `private-${VERSION}-`
const UUID = /^\/assets\/[0-9a-f-]{36}$/i
const SUBRESOURCES = new Set(["script", "style", "font", "worker"])
// Admin pages and their route data (/admin, /admin/*, /admin.data, /admin/*.data) never touch a
// cache: not read, not written, not warmed, no offline copy.
const ADMIN = /^\/admin(?:\/|\.data$|$)/
function isAdmin(url) { return ADMIN.test(new URL(url, self.location.origin).pathname) }
// Public editions (/e/*) and shared highlights (/h/*) are the same for everyone, and change or go
// down when their author or a moderator says so: the network's alone, never cached, warmed or
// served offline, and never kept in a private partition.
const PUBLIC_PAGE = /^\/[eh]\//
function isNetworkOnly(url) {
	const path = new URL(url, self.location.origin).pathname
	return ADMIN.test(path) || PUBLIC_PAGE.test(path)
}
let identity = "none"
let generation = 0
let changing = 0
let serial = Promise.resolve()
function exclusive(fn) {
	const result = serial.then(fn)
	serial = result.catch(() => {})
	return result
}
const ready = (async () => {
	const saved = await (await caches.open(META)).match("/session")
	identity = (await saved?.text()) || "none"
})()

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		await ready
		// Drop every cache of an older version. v5 and earlier cached navigations and route data
		// without telling admin apart: bumping VERSION is what removes anything they stored.
		for (const name of await caches.keys()) {
			if (name !== ASSETS && name !== META && !name.startsWith(PRIVATE)) await caches.delete(name)
		}
		await self.clients.claim()
	})())
})

async function changeIdentity(next, source, force = false, notify = true) {
	if (next === identity && !force) return
	identity = next
	generation++
	for (const name of await caches.keys()) if (name.startsWith(PRIVATE)) await caches.delete(name)
	await (await caches.open(META)).put("/session", new Response(identity))
	if (!notify) return
	for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
		if (client.id !== source) client.postMessage({ type: "session-changed" })
	}
}

function authChange(path, method) {
	if (path.startsWith("/api/auth/") && /\/(?:magic-link\/verify|callback\/|oauth2\/end-session)/.test(path)) return true
	return method !== "GET" && (path.startsWith("/api/auth/") || ["/login", "/signup", "/logout", "/reset-password", "/settings/delete", "/oauth/consent", "/admin/reauthenticate", "/settings/reauthenticate"].includes(path.replace(/\.data$/, "")))
}

self.addEventListener("fetch", (event) => {
	const { request } = event
	const url = new URL(request.url)
	if (url.origin !== self.location.origin) return
	const path = url.pathname
	if (authChange(path, request.method)) {
		event.respondWith((async () => {
			await ready
			await exclusive(async () => { changing++; await changeIdentity("none", event.clientId, true, false) })
			try { return await fetch(request) }
			finally {
				await exclusive(async () => {
					changing--
					// Notify after cookies have changed too; in-flight warm work cannot repopulate.
					await changeIdentity("none", event.clientId, true)
				})
			}
		})())
		return
	}
	if (isAdmin(path)) {
		// Straight to the network. Offline, a navigation gets a plain notice, never old admin data.
		if (request.mode === "navigate") event.respondWith(fetch(request).catch(() => adminOffline()))
		return
	}
	if (PUBLIC_PAGE.test(path)) return
	if (request.method !== "GET") return
	if (path.startsWith("/api/locales/")) return event.respondWith(publicAsset(request, true))
	if (path.startsWith("/api/") || path.startsWith("/oauth/") || path.startsWith("/.well-known/")) return
	if (UUID.test(path)) return event.respondWith(privateResponse(request, "images", event.clientId))
	if (path.startsWith("/assets/") || path.startsWith("/icons/") || path === "/favicon.ico")
		return event.respondWith(publicAsset(request))
	if (path.endsWith(".data")) return event.respondWith(privateResponse(request, "data", event.clientId))
	if (request.mode === "navigate") return event.respondWith(privateResponse(request, "pages", event.clientId))
	// The dev server's modules, kept for offline use in development. Network first: Vite gives its
	// optimized dependencies a new `?v=` hash whenever it re-optimizes, and a module served from an
	// older pass imports another copy of React ("Cannot read properties of null (reading 'useContext')").
	if (SUBRESOURCES.has(request.destination) && /^\/(?:@vite\/|@id\/|@fs\/|node_modules\/|app\/)/.test(path)) event.respondWith(publicAsset(request, false, true))
})

function dataKey(url) {
	const u = new URL(url, self.location.origin)
	u.searchParams.delete("_routes")
	return u.pathname + u.search
}
function dataUrl(url) {
	const u = new URL(url, self.location.origin)
	return `${u.pathname}.data${u.search}`
}
function privateName(kind) { return `${PRIVATE}${identity}-${kind}` }

async function privateResponse(request, kind, source, expected) {
	if (isNetworkOnly(request.url)) return fetch(request)
	await ready
	const started = generation
	try {
		const response = await fetch(request)
		await exclusive(async () => {
			if (changing || started !== generation) return
			const owner = response.headers.get("X-Klipstack-Session")
			if (!owner || !/^(none|[a-f0-9]{64})$/.test(owner)) return
			await changeIdentity(owner, source)
			if (identity === "none" || (expected && expected !== identity) || !response.ok || response.redirected) return
			const name = privateName(kind)
			const cache = await caches.open(name)
			await cache.put(request, response.clone())
			// A page's full data (no `_routes`) is newer than the partial copies a link prefetched
			// earlier: drop those, so offline they fall back to it instead of an older list.
			if (kind === "data" && !new URL(request.url).searchParams.has("_routes")) {
				const key = dataKey(request.url)
				for (const old of await cache.keys()) if (old.url !== request.url && dataKey(old.url) === key) await cache.delete(old)
			}
			await trim(name, kind === "images" ? 1500 : kind === "data" ? 600 : 300)
		})
		// An authorized response already in flight when logout started must not render
		// old private content, even if its tab missed the broadcast while navigating.
		const owner = response.headers.get("X-Klipstack-Session")
		if (owner && owner !== "none" && (changing || owner !== identity)) {
			return request.mode === "navigate" ? Response.redirect(new URL("/login", self.location.origin), 302) : offline()
		}
		if (request.mode === "navigate" && response.redirected) return Response.redirect(response.url, 302)
		return response
	} catch {
		return exclusive(async () => {
			if (changing || identity === "none" || started !== generation || (expected && expected !== identity)) return offline()
			const cache = await caches.open(privateName(kind))
			const exact = await cache.match(request)
			if (exact) return exact
			if (kind === "data") return (await cache.match(dataKey(request.url))) || offline()
			// No loose query matching: query parameters may select different private data.
			return offline()
		})
	}
}
function offline() { return new Response(null, { status: 503, statusText: "Offline" }) }
function adminOffline() {
	const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Admin</title><body style="font-family:system-ui;margin:2rem"><h1>Admin is unavailable offline</h1><p>Nothing from these pages is kept on this device. Connect and reload.</p><p lang="es">La administración no está disponible sin conexión. Conéctate y recarga.</p>'
	return new Response(html, { status: 503, statusText: "Offline", headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })
}

async function publicAsset(request, locale = false, networkFirst = false) {
	const cache = await caches.open(ASSETS)
	const hit = networkFirst ? null : await cache.match(request)
	if (hit) return hit
	try {
		const response = await fetch(request)
		if (response.ok) { await cache.put(request, response.clone()); await trim(ASSETS, 3000) }
		return response
	} catch {
		return (networkFirst && await cache.match(request)) || (locale && await cache.match(request, { ignoreSearch: true })) || offline()
	}
}

// One pass runs at a time; the requests that arrive meanwhile merge into the next one. An article
// stored by a pass in the last hour is not asked for again, and an image never changes under its
// id. Lists always are: a request comes when what they show has changed.
const ARTICLE_FRESH_MS = 60 * 60 * 1000
let warming = null
let pendingWarm = null
self.addEventListener("message", (event) => {
	const msg = event.data
	// Lets an admin page tell this worker from one that predates the admin exclusion (no answer).
	if (msg?.type === "capabilities") return event.ports[0]?.postMessage({ adminExcluded: true })
	if (!msg || msg.type !== "warm" || typeof msg.identity !== "string" || msg.identity === "none") return
	pendingWarm = mergeWarm(pendingWarm, { msg, source: event.source?.id })
	warming ??= drainWarm()
	event.waitUntil(warming)
})

function mergeWarm(queued, next) {
	if (!queued || queued.msg.identity !== next.msg.identity) return next
	const join = (key) => [...new Set([...(queued.msg[key] || []), ...(next.msg[key] || [])])]
	return { msg: { ...next.msg, pages: join("pages"), articles: join("articles"), lists: join("lists") }, source: next.source }
}

async function drainWarm() {
	try {
		while (pendingWarm) {
			const { msg, source } = pendingWarm
			pendingWarm = null
			await warm(msg, source).catch(() => {})
		}
	} finally {
		warming = null
	}
}

async function storedWithin(kind, url, ms) {
	if (identity === "none") return false
	const hit = await (await caches.open(privateName(kind))).match(new URL(url, self.location.origin).href)
	const at = Date.parse(hit?.headers.get("Date") ?? "")
	return Number.isFinite(at) && Date.now() - at < ms
}

async function warm(msg, source) {
	await ready
	if (changing || (identity !== "none" && identity !== msg.identity)) return
	const started = generation
	const urls = [...(msg.pages || []), ...(msg.articles || [])].slice(0, 300)
	const lists = (msg.lists || []).slice(0, 50)
	for (const path of [...urls, ...lists]) {
		if (changing || generation !== started || self.navigator?.onLine === false) return
		if (typeof path !== "string" || isNetworkOnly(path) || !/^\/(?:library|starred|read\/[0-9a-f-]+)(?:\?|$)/i.test(path)) continue
		if (path.startsWith("/read/") && await storedWithin("pages", path, ARTICLE_FRESH_MS) && await storedWithin("data", dataUrl(path), ARTICLE_FRESH_MS)) continue
		if (!lists.includes(path)) {
			const page = await privateResponse(new Request(new URL(path, self.location.origin), { headers: { "x-klipstack-warm": "1" } }), "pages", source, msg.identity)
			if (page.ok) {
				const html = await page.text()
				for (const m of html.matchAll(/(?:href|src)="(\/assets\/[^"?]+\.(?:js|css))"/g)) await publicAsset(new Request(new URL(m[1], self.location.origin)))
			}
		}
		if (changing || identity !== msg.identity) return
		const response = await privateResponse(new Request(new URL(dataUrl(path), self.location.origin), { headers: { "x-klipstack-warm": "1" } }), "data", source, msg.identity)
		if (!response.ok) continue
		const text = await response.text()
		for (const m of new Set(text.match(/\/assets\/[0-9a-f-]{36}/gi))) {
			if (changing || identity !== msg.identity) return
			if (await (await caches.open(privateName("images"))).match(new URL(m, self.location.origin).href)) continue
			await privateResponse(new Request(new URL(m, self.location.origin)), "images", source, msg.identity)
		}
	}
}

async function trim(name, limit) {
	const cache = await caches.open(name)
	const keys = await cache.keys()
	for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key)
}
