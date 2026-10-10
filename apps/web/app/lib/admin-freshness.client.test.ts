import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureAdminSafeWorker, purgeAdminCaches } from "./admin-freshness.client"

const BASE = "http://localhost:5180"

function fakeCaches(entries: Record<string, string[]>) {
	const stores = new Map(
		Object.entries(entries).map(([name, paths]) => [name, new Set(paths.map((p) => BASE + p))]),
	)
	vi.stubGlobal("caches", {
		keys: async () => [...stores.keys()],
		open: async (name: string) => ({
			keys: async () => [...(stores.get(name) ?? [])].map((url) => ({ url })),
			delete: async (request: { url: string }) => stores.get(name)?.delete(request.url),
		}),
	})
	return () =>
		[...stores.values()].flatMap((urls) => [...urls].map((url) => url.slice(BASE.length)))
}

/** A controlling worker: `answers` is what it posts back to the capabilities ping, if anything. */
function fakeWorker(answers: unknown, { update }: { update?: () => Promise<void> } = {}) {
	const listeners = new Map<string, () => void>()
	const controller = {
		postMessage: (_: unknown, [port]: MessagePort[]) => {
			if (answers !== undefined) port?.postMessage(answers)
		},
	}
	vi.stubGlobal("window", { setTimeout, clearTimeout })
	vi.stubGlobal("navigator", {
		serviceWorker: {
			controller,
			addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
			getRegistration: async () => ({ update: update ?? (async () => {}) }),
		},
	})
	return { controller, fire: (name: string) => listeners.get(name)?.() }
}

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe("the admin service-worker gate", () => {
	it("passes a worker that says it excludes admin, and touches no cache", async () => {
		const left = fakeCaches({ "private-v6-a-data": ["/admin/users.data"] })
		fakeWorker({ adminExcluded: true })
		expect(await ensureAdminSafeWorker()).toBe("ok")
		expect(left()).toEqual(["/admin/users.data"])
	})

	it("fails closed on a silent older worker that cannot be replaced, and deletes what it stored", async () => {
		vi.useFakeTimers()
		const left = fakeCaches({
			"private-v5-a-pages": ["/admin", "/admin/users?q=a", "/library"],
			"private-v5-a-data": ["/admin.data", "/admin/jobs.data", "/administer.data"],
		})
		fakeWorker(undefined)
		const gate = ensureAdminSafeWorker()
		await vi.advanceTimersByTimeAsync(20_000)
		expect(await gate).toBe("failed")
		expect(left().sort()).toEqual(["/administer.data", "/library"])
	})

	it("fails closed, and still purges, when the update itself throws", async () => {
		vi.useFakeTimers()
		const left = fakeCaches({ "private-v5-a-data": ["/admin.data"] })
		fakeWorker(undefined, { update: () => Promise.reject(new Error("offline")) })
		const gate = ensureAdminSafeWorker()
		await vi.advanceTimersByTimeAsync(20_000)
		expect(await gate).toBe("failed")
		expect(left()).toEqual([])
	})

	it("reports an update once the new worker controls the page and answers", async () => {
		vi.useFakeTimers()
		fakeCaches({})
		const worker = fakeWorker(undefined)
		const gate = ensureAdminSafeWorker()
		await vi.advanceTimersByTimeAsync(2_000)
		// The new worker took over: it answers the ping the old one ignored.
		worker.controller.postMessage = (_: unknown, [port]: MessagePort[]) =>
			port?.postMessage({ adminExcluded: true })
		worker.fire("controllerchange")
		await vi.advanceTimersByTimeAsync(2_000)
		expect(await gate).toBe("updated")
	})

	it("survives unavailable cache storage", async () => {
		vi.stubGlobal("caches", { keys: () => Promise.reject(new Error("denied")) })
		await expect(purgeAdminCaches()).resolves.toBeUndefined()
	})
})
