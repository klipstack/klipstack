import { readFileSync } from "node:fs"
import vm from "node:vm"
import { describe, expect, it } from "vitest"

function worker() {
	const base = "http://localhost:5180"
	const handlers = new Map<string, (event: Record<string, unknown>) => void>()
	const stores = new Map<string, Map<string, Response>>()
	const key = (r: Request | string) => new URL(typeof r === "string" ? r : r.url, base).href
	const caches = {
		keys: async () => [...stores.keys()],
		delete: async (name: string) => stores.delete(name),
		open: async (name: string) => {
			if (!stores.has(name)) stores.set(name, new Map())
			const map = stores.get(name)!
			return {
				match: async (r: Request | string) => map.get(key(r))?.clone(),
				put: async (r: Request | string, response: Response) => {
					map.set(key(r), response.clone())
				},
				keys: async () => [...map.keys()].map((url) => new Request(url)),
				delete: async (r: Request | string) => map.delete(key(r)),
			}
		},
	}
	const state = {
		online: true,
		owner: "a".repeat(64),
		hold: null as null | ((response: Response) => Promise<Response>),
		body: null as null | string,
		/** The server's clock for the `Date` header; `null` sends none. */
		now: Date.now() as number | null,
		fetched: [] as string[],
	}
	const sandbox = vm.createContext({
		URL,
		Request,
		Response,
		caches,
		setTimeout,
		self: {
			location: { origin: base },
			navigator: { onLine: true },
			clients: { matchAll: async () => [], claim: async () => {} },
			addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) =>
				handlers.set(name, fn),
		},
		fetch: async (request: Request) => {
			if (!state.online) throw new TypeError("Offline")
			state.fetched.push(new URL(request.url).pathname + new URL(request.url).search)
			const headers: Record<string, string> = { "X-Klipstack-Session": state.owner }
			if (state.now !== null) headers.Date = new Date(state.now).toUTCString()
			const response = new Response(state.body ?? `private:${state.owner}`, { headers })
			return state.hold && request.url.includes("delayed") ? state.hold(response) : response
		},
	})
	vm.runInContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), sandbox)
	const dispatch = async (name: string, event: Record<string, unknown>) => {
		let promise: Promise<unknown> | undefined
		handlers.get(name)!({
			...event,
			respondWith: (p: Promise<Response>) => {
				promise = p
			},
			waitUntil: (p: Promise<void>) => {
				promise = p
			},
		})
		return promise
	}
	return {
		state,
		stores,
		caches,
		dispatch,
		read: (path: string, method = "GET") =>
			dispatch("fetch", {
				request: new Request(new URL(path, base), { method }),
				clientId: "test",
			}) as Promise<Response>,
	}
}

describe("private offline partitions", () => {
	it("preserves authenticated offline reads, then removes them on logout and account change", async () => {
		const w = worker()
		await w.read("/library.data")
		w.state.online = false
		expect(await (await w.read("/library.data")).text()).toContain("private:aaaa")
		w.state.online = true
		w.state.owner = "none"
		await w.read("/logout.data", "POST")
		w.state.online = false
		expect((await w.read("/library.data")).status).toBe(503)
		w.state.online = true
		w.state.owner = "b".repeat(64)
		await w.read("/library.data")
		w.state.online = false
		expect(await (await w.read("/library.data")).text()).toContain("private:bbbb")
		expect([...w.stores.keys()].some((n) => n.includes("a".repeat(64)))).toBe(false)
	})
	it("does not let an in-flight warm response restore a signed-out partition", async () => {
		const w = worker()
		await w.read("/library.data")
		let release!: (response: Response) => void
		let response!: Response
		let began!: () => void
		const started = new Promise<void>((resolve) => {
			began = resolve
		})
		w.state.hold = (r) => {
			response = r
			began()
			return new Promise((resolve) => {
				release = resolve
			})
		}
		const warming = w.dispatch("message", {
			data: { type: "warm", identity: w.state.owner, lists: ["/library?delayed=1"] },
			source: { id: "test" },
		})
		await started
		w.state.owner = "none"
		await w.read("/api/auth/sign-out", "POST")
		release(response)
		await warming
		expect([...w.stores.keys()].some((n) => n.startsWith("private-"))).toBe(false)
	})
	it("answers offline with a list's latest full data, not an older prefetched part of it", async () => {
		const w = worker()
		const prefetch = "/library.data?_routes=routes%2Flibrary"
		// Home prefetches the library's link while the library is still empty.
		w.state.body = "empty library"
		await w.read(prefetch)
		// Later the library warms its own data, with the new article.
		w.state.body = "library with the article"
		await w.read("/library.data")
		w.state.online = false
		expect(await (await w.read(prefetch)).text()).toBe("library with the article")
		// A partial copy newer than the full one still answers its own request.
		w.state.online = true
		w.state.body = "newer part"
		await w.read(prefetch)
		w.state.online = false
		expect(await (await w.read(prefetch)).text()).toBe("newer part")
		expect(await (await w.read("/library.data")).text()).toBe("library with the article")
	})
	describe("warming", () => {
		const article = "/read/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
		const image = "/assets/0190a1b2-c3d4-7e5f-8a9b-000000000001"
		const warm = (w: ReturnType<typeof worker>, data: Record<string, string[]>) =>
			w.dispatch("message", {
				data: { type: "warm", identity: w.state.owner, ...data },
				source: { id: "test" },
			})

		it("fetches an article and its images once while its copy is fresh", async () => {
			const w = worker()
			await w.read("/library.data")
			w.state.body = `<img src="${image}"><img src="${image}">`
			await warm(w, { pages: ["/library"], articles: [article] })
			expect(w.state.fetched.filter((url) => url.startsWith("/read/"))).toEqual([
				article,
				`${article}.data`,
			])
			expect(w.state.fetched.filter((url) => url === image)).toHaveLength(1)

			w.state.fetched = []
			await warm(w, { pages: ["/library"], articles: [article] })
			expect(w.state.fetched).toEqual(["/library", "/library.data"])
		})

		it("asks for an article again once its copy is an hour old", async () => {
			const w = worker()
			await w.read("/library.data")
			w.state.now = Date.now() - 61 * 60 * 1000
			await warm(w, { articles: [article] })
			w.state.now = Date.now()
			w.state.fetched = []
			await warm(w, { articles: [article] })
			expect(w.state.fetched).toEqual([article, `${article}.data`])
		})

		it("always asks for lists again: what they show may have changed", async () => {
			const w = worker()
			await w.read("/library.data")
			await warm(w, { pages: ["/library"], lists: ["/library?show=new"] })
			w.state.fetched = []
			await warm(w, { pages: ["/library"], lists: ["/library?show=new"] })
			expect(w.state.fetched).toEqual(["/library", "/library.data", "/library.data?show=new"])
		})

		it("treats a copy without a date as stale", async () => {
			const w = worker()
			await w.read("/library.data")
			w.state.now = null
			await warm(w, { articles: [article] })
			w.state.fetched = []
			await warm(w, { articles: [article] })
			expect(w.state.fetched).toEqual([article, `${article}.data`])
		})

		it("merges the requests that arrive during a pass into one more pass", async () => {
			const w = worker()
			await w.read("/library.data")
			const other = "/read/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"
			const first = warm(w, { articles: [article] })
			const second = warm(w, { articles: [article] })
			const third = warm(w, { articles: [other] })
			await Promise.all([first, second, third])
			expect(w.state.fetched.filter((url) => url.startsWith("/read/"))).toEqual([
				article,
				`${article}.data`,
				other,
				`${other}.data`,
			])
		})
	})

	it("deletes legacy shared caches when activating", async () => {
		const w = worker()
		await (await w.caches.open("pages-v4")).put("/library", new Response("private"))
		await (await w.caches.open("images-v4")).put("/assets/image", new Response("private"))
		await w.dispatch("activate", {})
		expect(await w.caches.keys()).not.toContain("pages-v4")
		expect(await w.caches.keys()).not.toContain("images-v4")
	})

	it("serves the dev server's modules from the network first, and from the cache only offline", async () => {
		const w = worker()
		const script = (path: string) =>
			w.dispatch("fetch", {
				request: { url: `http://localhost:5180${path}`, method: "GET", destination: "script" },
				clientId: "test",
			}) as Promise<Response>
		const dep = "/node_modules/.vite/deps/react.js?v=11111111"
		expect(await (await script(dep)).text()).toBe(`private:${w.state.owner}`)
		// The server now answers differently (Vite re-optimized): the cached copy must not win.
		w.state.owner = "b".repeat(64)
		expect(await (await script(dep)).text()).toBe(`private:${w.state.owner}`)
		w.state.online = false
		expect(await (await script(dep)).text()).toBe(`private:${w.state.owner}`)
		expect((await script("/app/routes/never-seen.tsx")).status).toBe(503)
	})

	describe("admin pages", () => {
		const adminPaths = [
			"/admin",
			"/admin.data",
			"/admin/users",
			"/admin/users.data?q=a",
			"/admin/users/abc.data",
			"/admin/jobs.data?_routes=routes%2Fadmin.jobs",
		]
		const cached = (w: ReturnType<typeof worker>) =>
			[...w.stores.values()].flatMap((store) => [...store.keys()])

		it("never stores or answers admin requests, online or offline", async () => {
			const w = worker()
			await w.read("/library.data")
			for (const path of adminPaths) expect(await w.read(path)).toBeUndefined()
			expect(cached(w).filter((url) => url.includes("/admin"))).toEqual([])
			w.state.online = false
			for (const path of adminPaths) expect(await w.read(path)).toBeUndefined()
		})
		it("passes admin navigations to the network and shows a plain notice offline", async () => {
			const w = worker()
			const navigate = () =>
				w.dispatch("fetch", {
					request: { url: "http://localhost:5180/admin/users", method: "GET", mode: "navigate" },
					clientId: "test",
				}) as Promise<Response>
			expect(await (await navigate()).text()).toContain("private:aaaa")
			expect(cached(w).filter((url) => url.includes("/admin"))).toEqual([])
			w.state.online = false
			const offline = await navigate()
			expect(offline.status).toBe(503)
			expect(await offline.text()).toContain("unavailable offline")
		})
		it("does not treat lookalike paths as admin", async () => {
			const w = worker()
			await w.read("/administer.data")
			expect(cached(w).some((url) => url.endsWith("/administer.data"))).toBe(true)
		})
		it("ignores admin paths in warm messages", async () => {
			const w = worker()
			await w.read("/library.data")
			await w.dispatch("message", {
				data: {
					type: "warm",
					identity: w.state.owner,
					pages: ["/admin", "/admin/users"],
					lists: ["/admin/jobs"],
				},
				source: { id: "test" },
			})
			expect(cached(w).filter((url) => url.includes("/admin"))).toEqual([])
		})
		it("drops every cache an older worker made when it activates, admin entries included", async () => {
			const w = worker()
			await w.read("/library.data")
			// What a v5 worker, which did not know about admin, would have left behind.
			const old = await w.caches.open(`private-v5-${w.state.owner}-data`)
			await old.put("/admin/users.data", new Response("old admin data"))
			await old.put("/library.data", new Response("old library data"))
			await (await w.caches.open("offline-session-v5")).put("/session", new Response("x"))
			await w.dispatch("activate", {})
			expect([...w.stores.keys()].filter((name) => name.includes("-v5"))).toEqual([])
			expect(cached(w).filter((url) => url.includes("/admin"))).toEqual([])
			// This version's own caches stay.
			expect(cached(w).some((url) => url.endsWith("/library.data"))).toBe(true)
		})
		it("keeps private caches through a password confirmation, until its new session answers", async () => {
			const w = worker()
			await w.read("/library.data")
			// A wrong password changes no one: the same session answers.
			await w.read("/admin/reauthenticate.data", "POST")
			await w.read("/settings/confirm-password.data", "POST")
			const stores = () => [...w.stores.keys()].filter((n) => n.startsWith("private-"))
			expect(stores().some((n) => n.includes("a".repeat(64)))).toBe(true)
			// A right one makes a new session, and its first answer replaces the caches.
			w.state.owner = "b".repeat(64)
			await w.read("/library.data")
			expect(stores().some((n) => n.includes("a".repeat(64)))).toBe(false)
			expect(stores().some((n) => n.includes("b".repeat(64)))).toBe(true)
		})
		it("answers the capabilities ping that tells it from an older worker", async () => {
			const w = worker()
			let answer: unknown
			await w.dispatch("message", {
				data: { type: "capabilities" },
				ports: [{ postMessage: (message: unknown) => (answer = message) }],
			})
			expect(answer).toEqual({ adminExcluded: true })
		})
	})

	describe("public editions and shared highlights", () => {
		const paths = [
			"/e/Abc123def456",
			"/e/Abc123def456/week-38-2026",
			"/e/Abc123def456/week-38-2026.data",
			"/h/Abc123def456",
			"/h/Abc123def456.data",
		]
		const isPublic = (url: string) => url.includes("/e/") || url.includes("/h/")
		const cached = (w: ReturnType<typeof worker>) =>
			[...w.stores.values()].flatMap((store) => [...store.keys()])

		it("leaves them to the network, online or offline, and keeps no copy", async () => {
			const w = worker()
			await w.read("/library.data")
			for (const path of paths) expect(await w.read(path)).toBeUndefined()
			const navigation = await w.dispatch("fetch", {
				request: {
					url: "http://localhost:5180/e/Abc123def456/week",
					method: "GET",
					mode: "navigate",
				},
				clientId: "test",
			})
			expect(navigation).toBeUndefined()
			w.state.online = false
			for (const path of paths) expect(await w.read(path)).toBeUndefined()
			expect(cached(w).filter(isPublic)).toEqual([])
		})

		it("leaves the extension's sign-in callback to the network right after a consent", async () => {
			// Read as a private page, its answer looked like a new sign-in after the consent post,
			// and the worker told every tab to reload: Safari cancelled the way to the callback.
			const w = worker()
			await w.read("/library.data")
			await w.read("/oauth/consent.data", "POST")
			const navigate = (path: string) =>
				w.dispatch("fetch", {
					request: { url: `http://localhost:5180${path}`, method: "GET", mode: "navigate" },
					clientId: "",
				})
			expect(await navigate("/extension/connected?code=c&state=s")).toBeUndefined()
			expect(await navigate("/extension")).toBeUndefined()
			// Only those two: the app's own pages still go through the worker.
			expect(await navigate("/extensions")).toBeInstanceOf(Response)
		})

		it("does not warm them, and keeps the app's own editions pages private", async () => {
			const w = worker()
			await w.read("/editions.data")
			expect(cached(w).some((url) => url.endsWith("/editions.data"))).toBe(true)
			await w.dispatch("message", {
				data: { type: "warm", identity: w.state.owner, pages: paths, lists: paths },
				source: { id: "test" },
			})
			expect(cached(w).filter(isPublic)).toEqual([])
		})
	})
})
