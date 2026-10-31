import { readFileSync } from "node:fs"
import { RouterContextProvider } from "react-router"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "~/lib/env.server"
import { sessionMiddleware } from "~/lib/session.server"
import { adminFixtures } from "~/test/admin-fixtures"
import routes from "../routes"

/**
 * React Router refuses a cross-origin action only for pages (document and single-fetch requests);
 * resource routes never get that check. The session middleware, which every route runs, refuses
 * a write that carries the session cookie from any other origin. These requests go through it with
 * a real session, for every route that has an action, so a new route is covered without a change
 * here.
 */

const fx = adminFixtures("cross-site")
afterAll(fx.cleanup)

const APP_ORIGIN = new URL(env.APP_URL).origin
const EVIL = "https://evil.example"
/** A sibling subdomain: SameSite=Lax lets it send the cookie, so only the Origin tells. */
const SIBLING = "https://other.klipstack.test"

type RouteEntry = { path?: string; file: string; children?: RouteEntry[] }
const modules = import.meta.glob<{ action?: unknown }>([
	"./*.ts",
	"./*.tsx",
	"!./*.test.ts",
	"!./*.test.tsx",
])

/** A URL path for a route pattern: params filled, optional segments kept, splats one segment. */
const concrete = (pattern: string) =>
	`/${pattern}`
		.replace(/\/\*$/, "/x")
		.replace(/:([A-Za-z]+)\??/g, "00000000-0000-4000-8000-000000000000")
		.replace(/\/+/g, "/")

function flatten(entries: RouteEntry[], parent = ""): Array<{ path: string; file: string }> {
	return entries.flatMap((entry) => {
		const path = entry.path ? `${parent}/${entry.path}` : parent
		return [
			{ path: concrete(path || "/"), file: entry.file },
			...flatten(entry.children ?? [], path),
		]
	})
}

/** Every registered route whose module exports an action, by the path that reaches it. */
async function actionRoutes() {
	const found: Array<{ path: string; file: string }> = []
	for (const route of flatten(await (routes as unknown as Promise<RouteEntry[]>))) {
		const load = modules[route.file.replace(/^routes\//, "./")]
		expect(load, `${route.file} is not a route module this test can see`).toBeDefined()
		if ((await load!()).action) found.push(route)
	}
	return found
}

let cookie = ""
let withAction: Array<{ path: string; file: string }> = []
beforeAll(async () => {
	cookie = (await fx.account()).headers().get("cookie")!
	expect(cookie).toMatch(/klip\.session_token=/)
	withAction = await actionRoutes()
}, 60_000)

/** The request through the session middleware: whether the route's action would have run. */
async function send(path: string, headers: Record<string, string>, method = "POST") {
	let reached = false
	const response = (await sessionMiddleware(
		{
			request: new Request(new URL(path, env.APP_URL), {
				method,
				headers,
				...(method === "GET" ? {} : { body: new URLSearchParams({ intent: "delete" }) }),
			}),
			context: new RouterContextProvider(),
			params: {},
		} as never,
		async () => {
			reached = true
			return new Response("reached")
		},
	)) as Response
	return { reached, response }
}

describe("cross-site writes", () => {
	it("finds the resource routes the check exists for", () => {
		const paths = withAction.map((route) => route.path)
		for (const path of ["/documents/bulk", "/settings/delete", "/prefs", "/logout", "/library"])
			expect(paths).toContain(path)
		expect(paths.length).toBeGreaterThan(40)
	})

	it("are refused on every route with an action, before the action runs", async () => {
		for (const { path, file } of withAction) {
			// better-auth checks the origin of its own endpoints (auth.server.ts).
			if (path.startsWith("/api/auth/")) continue
			for (const origin of [EVIL, SIBLING, "null"]) {
				const { reached, response } = await send(path, { cookie, origin })
				expect(reached, `${file} ran for ${origin}`).toBe(false)
				expect(response.status, `${file} from ${origin}`).toBe(403)
				expect(await response.json()).toMatchObject({ error: { code: "forbidden" } })
				expect(response.headers.get("Cache-Control")).toBe("private, no-store")
			}
			// A browser sends Origin with every write; one without it is not from our pages. The
			// extension's save is the exception (below).
			if (path === "/api/documents") continue
			expect((await send(path, { cookie })).reached, `${file} ran without an Origin`).toBe(false)
		}
	})

	it("are refused whatever the method", async () => {
		for (const method of ["PUT", "PATCH", "DELETE"])
			expect((await send("/documents/bulk", { cookie, origin: EVIL }, method)).reached).toBe(false)
	})

	it("from this site's own pages go through", async () => {
		for (const { path } of withAction)
			expect((await send(path, { cookie, origin: APP_ORIGIN })).reached, path).toBe(true)
	})

	it("are judged by APP_URL, not by the address the server was reached at", async () => {
		// Behind a proxy the request's URL can be the server's own address, while the browser's Origin
		// is the public one.
		let reached = false
		const response = (await sessionMiddleware(
			{
				request: new Request("http://internal:3000/prefs", {
					method: "POST",
					headers: { cookie, origin: APP_ORIGIN },
					body: new URLSearchParams({ shortcuts: "off" }),
				}),
				context: new RouterContextProvider(),
				params: {},
			} as never,
			async () => {
				reached = true
				return new Response("reached")
			},
		)) as Response
		expect(response.status).toBe(200)
		expect(reached).toBe(true)
		expect((await send("/prefs", { cookie, origin: "http://internal:3000" })).reached).toBe(false)
	})

	it("are not checked without the session cookie, with a bearer token, or for reads", async () => {
		expect((await send("/documents/bulk", { origin: EVIL })).reached).toBe(true)
		expect((await send("/app/sign-in", {})).reached).toBe(true)
		const bearer = { cookie, origin: EVIL, authorization: "Bearer not-a-token" }
		expect((await send("/documents/bulk", bearer)).reached).toBe(true)
		expect((await send("/library", { cookie, origin: EVIL }, "GET")).reached).toBe(true)
	})

	it("let the browser extension save with the session, and nothing else", async () => {
		const extensions = [
			"chrome-extension://abcdefghijklmnopabcdefghijklmnop",
			"moz-extension://4b0a8a3e-0000-4000-8000-000000000000",
			"safari-web-extension://4B0A8A3E-0000-4000-8000-000000000000",
		]
		for (const origin of extensions) {
			expect((await send("/api/documents", { cookie, origin })).reached, origin).toBe(true)
			expect((await send("/documents/bulk", { cookie, origin })).reached, origin).toBe(false)
		}
		// Firefox may send an extension's request without an Origin.
		expect((await send("/api/documents", { cookie })).reached).toBe(true)
		expect((await send("/api/documents", { cookie, origin: SIBLING })).reached).toBe(false)
	})

	it("run in the root middleware, which every route runs", () => {
		const root = readFileSync(new URL("../root.tsx", import.meta.url), "utf8")
		expect(root).toMatch(/export const middleware[^=]*= \[sessionMiddleware\b/)
	})
})
