/**
 * Admin pages must never sit in a service-worker cache. The current worker leaves them alone and
 * says so; a worker from before the admin release does not answer, and would cache them.
 */
const PING_MS = 1500
const UPDATE_MS = 10_000

function workerExcludesAdmin(worker: ServiceWorker): Promise<boolean> {
	return new Promise((resolve) => {
		const channel = new MessageChannel()
		const timer = window.setTimeout(() => resolve(false), PING_MS)
		channel.port1.onmessage = (event) => {
			window.clearTimeout(timer)
			resolve(event.data?.adminExcluded === true)
		}
		worker.postMessage({ type: "capabilities" }, [channel.port2])
	})
}

/** The same paths sw.js leaves alone: /admin, /admin/*, /admin.data and nested .data requests. */
const ADMIN_PATH = /^\/admin(?:\/|\.data$|$)/

/**
 * Deletes admin responses from every cache. An older worker has already fetched, and stored, the
 * page that runs this check; when it cannot be replaced, nothing else would remove that copy.
 */
export async function purgeAdminCaches(): Promise<void> {
	if (!("caches" in globalThis)) return
	try {
		for (const name of await caches.keys()) {
			const cache = await caches.open(name)
			for (const request of await cache.keys())
				if (ADMIN_PATH.test(new URL(request.url).pathname)) await cache.delete(request)
		}
	} catch {
		// Storage can be unavailable (private windows): there is nothing stored to remove then.
	}
}

export type WorkerGate = "ok" | "updated" | "failed"

/**
 * "ok": no worker, or one that excludes admin. "updated": an old worker was replaced, and the page
 * should reload (the new worker deleted the old caches when it activated). "failed": still old;
 * the admin responses it stored are deleted from here, and the layout shows no admin data.
 */
export async function ensureAdminSafeWorker(): Promise<WorkerGate> {
	if (!("serviceWorker" in navigator)) return "ok"
	const controller = navigator.serviceWorker.controller
	if (!controller || (await workerExcludesAdmin(controller))) return "ok"
	const changed = new Promise<boolean>((resolve) => {
		const timer = window.setTimeout(() => resolve(false), UPDATE_MS)
		navigator.serviceWorker.addEventListener(
			"controllerchange",
			() => {
				window.clearTimeout(timer)
				resolve(true)
			},
			{ once: true },
		)
	})
	try {
		const registration = await navigator.serviceWorker.getRegistration()
		await registration?.update()
	} catch {
		await purgeAdminCaches()
		return "failed"
	}
	const next = (await changed) ? navigator.serviceWorker.controller : null
	if (next && (await workerExcludesAdmin(next))) return "updated"
	await purgeAdminCaches()
	return "failed"
}
