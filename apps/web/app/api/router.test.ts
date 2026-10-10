import { defineEndpoint, empty, json, text } from "@klipstack/api-contract"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { ApiPrincipal } from "./auth.server"
import { checkClientVersion } from "./client-version.server"
import { ApiError } from "./errors.server"
import { reply } from "./handler.server"
import { apiPath, createApiRouter, LARGE_BODY, readJsonBody } from "./router.server"

const endpoints = {
	"things.list": defineEndpoint({
		id: "things.list",
		method: "GET",
		path: "/things",
		scope: "read",
		query: z.object({ limit: z.coerce.number().int().min(1).max(10).default(5) }),
		response: json(z.object({ items: z.array(z.string()), limit: z.number() })),
		errors: [],
	}),
	"things.get": defineEndpoint({
		id: "things.get",
		method: "GET",
		path: "/things/:id",
		scope: "read",
		params: z.object({ id: z.uuid() }),
		response: text("text/markdown; charset=utf-8"),
		errors: ["not_found"],
	}),
	"things.special": defineEndpoint({
		id: "things.special",
		method: "GET",
		path: "/things/special",
		scope: "read",
		response: json(z.object({ special: z.boolean() })),
		errors: [],
	}),
	"things.create": defineEndpoint({
		id: "things.create",
		method: "POST",
		path: "/things",
		scope: "write",
		bodyLimit: 64,
		body: z.object({ name: z.string().min(1) }),
		response: json(z.object({ name: z.string() }), [201, 200]),
		errors: [],
	}),
	"things.delete": defineEndpoint({
		id: "things.delete",
		method: "DELETE",
		path: "/things/:id",
		scope: "write",
		params: z.object({ id: z.uuid() }),
		response: empty(),
		errors: [],
	}),
	"things.upload": defineEndpoint({
		id: "things.upload",
		method: "POST",
		path: "/uploads",
		scope: "write",
		bodyLimit: 2 * 1024 * 1024,
		body: z.object({ data: z.string() }),
		response: json(z.object({ ok: z.boolean() })),
		errors: [],
	}),
	"things.broken": defineEndpoint({
		id: "things.broken",
		method: "GET",
		path: "/broken",
		scope: "none",
		response: json(z.object({ ok: z.literal(true) })),
		errors: [],
	}),
} as const

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
const reader: ApiPrincipal = { userId: "u1", access: "read", via: "oauth", clientId: "app" }
const writer: ApiPrincipal = { userId: "u1", access: "write", via: "api_key", clientId: null }

function router({
	principal = writer,
	limited = false,
	createLimited = false,
	checkResponses = true,
	gate,
}: {
	principal?: ApiPrincipal | null
	limited?: boolean
	createLimited?: boolean
	checkResponses?: boolean
	gate?: Promise<void>
} = {}) {
	const logged: string[] = []
	const r = createApiRouter({
		endpoints,
		handlers: {
			"things.list": async ({ query }) => ({ items: ["a"], limit: query.limit }),
			"things.get": async ({ params }) => {
				if (params.id !== ID) throw ApiError.of("not_found", "No thing with that id.")
				return `# thing ${params.id}`
			},
			"things.special": async () => ({ special: true }),
			"things.create": async ({ body }) =>
				body.name === "again" ? reply(200, { name: body.name }) : reply(201, { name: body.name }),
			"things.delete": async () => undefined,
			"things.upload": async () => {
				await gate
				return { ok: true }
			},
			"things.broken": async () => ({ ok: false }) as never,
		},
		authenticate: async () => {
			if (!principal)
				throw ApiError.of("unauthorized", "No token.", {
					headers: { "WWW-Authenticate": "Bearer" },
				})
			return principal
		},
		checkClient: checkClientVersion,
		rateLimit: () => (limited ? { ok: false, retryAfterSeconds: 7 } : { ok: true }),
		limits: {
			"things.create": () => (createLimited ? { ok: false, retryAfterSeconds: 60 } : { ok: true }),
		},
		largeBodies: { perOwner: 2, total: 3 },
		checkResponses,
		log: (message) => {
			logged.push(message)
		},
	})
	return { ...r, logged }
}

const req = (method: string, path: string, init: RequestInit = {}) =>
	new Request(`http://localhost:5180/api/v1${path}`, { method, ...init })

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	req("POST", path, {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json", ...headers },
	})

describe("apiPath", () => {
	it("strips the prefix and trailing slashes", () => {
		expect(apiPath("/api/v1/things/")).toBe("/things")
		expect(apiPath("/api/v1")).toBe("/")
		expect(apiPath("/api/v2/things")).toBeNull()
		expect(apiPath("/api/v10")).toBeNull()
	})
})

describe("route matching", () => {
	const { match } = router()

	it("matches method and path, and decodes path params", () => {
		expect(match("GET", "/api/v1/things")).toMatchObject({ kind: "route", id: "things.list" })
		expect(match("GET", `/api/v1/things/${ID}`)).toMatchObject({
			kind: "route",
			id: "things.get",
			params: { id: ID },
		})
		expect(match("GET", "/api/v1/things/a%20b")).toMatchObject({ params: { id: "a b" } })
	})

	it("prefers a literal segment over a parameter, whatever the method", () => {
		expect(match("GET", "/api/v1/things/special")).toMatchObject({ id: "things.special" })
		// Not a DELETE of the thing with the id "special": the path is the literal route's.
		expect(match("DELETE", "/api/v1/things/special")).toEqual({ kind: "method", allowed: ["GET"] })
	})

	it("reports the allowed methods for a known path", () => {
		expect(match("PATCH", "/api/v1/things")).toEqual({ kind: "method", allowed: ["GET", "POST"] })
		expect(match("GET", "/api/v1/nothing")).toEqual({ kind: "none" })
	})
})

describe("handling", () => {
	it("returns 404 and 405 with the error body", async () => {
		const { handle } = router()
		const missing = await handle(req("GET", "/nothing"))
		expect(missing.status).toBe(404)
		expect(await missing.json()).toEqual({
			error: { code: "not_found", message: "No such endpoint." },
		})
		const wrong = await handle(req("PUT", "/things"))
		expect(wrong.status).toBe(405)
		expect(wrong.headers.get("allow")).toBe("GET, POST")
		expect((await wrong.json()).error.code).toBe("method_not_allowed")
	})

	it("authenticates before anything else, except for scope none", async () => {
		const { handle } = router({ principal: null })
		const res = await handle(req("GET", "/things"))
		expect(res.status).toBe(401)
		expect(res.headers.get("www-authenticate")).toBe("Bearer")
		expect((await handle(req("GET", "/broken"))).status).toBe(500)
	})

	it("refuses an outdated app before authenticating it", async () => {
		const { handle } = router({ principal: null })
		const old = await handle(
			req("GET", "/things", { headers: { "x-klipstack-client": "ios/0.0.9" } }),
		)
		expect(old.status).toBe(426)
		expect((await old.json()).error).toMatchObject({
			code: "client_outdated",
			details: { minimum: "0.1.0" },
		})
		const current = await handle(
			req("GET", "/things", { headers: { "x-klipstack-client": "ios/0.1.0" } }),
		)
		expect(current.status).toBe(401)
	})

	it("needs write access for write endpoints", async () => {
		const { handle } = router({ principal: reader })
		const res = await handle(post("/things", { name: "x" }))
		expect(res.status).toBe(403)
		expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"')
		expect(res.headers.get("www-authenticate")).toContain('scope="library:write"')
		expect((await res.json()).error.code).toBe("insufficient_scope")
		expect((await handle(req("GET", "/things"))).status).toBe(200)
	})

	it("answers 429 with Retry-After when the user is over the limit", async () => {
		const { handle } = router({ limited: true })
		const res = await handle(req("GET", "/things"))
		expect(res.status).toBe(429)
		expect(res.headers.get("retry-after")).toBe("7")
		expect(await res.json()).toEqual({
			error: { code: "rate_limited", message: expect.stringContaining("7 seconds"), retryAfter: 7 },
		})
	})

	it("parses the query with defaults and coercion, and rejects bad values", async () => {
		const { handle } = router()
		expect(await (await handle(req("GET", "/things"))).json()).toEqual({ items: ["a"], limit: 5 })
		expect(await (await handle(req("GET", "/things?limit=3"))).json()).toMatchObject({ limit: 3 })
		const bad = await handle(req("GET", "/things?limit=99"))
		expect(bad.status).toBe(400)
		const body = await bad.json()
		expect(body.error.code).toBe("invalid_request")
		expect(body.error.details.where).toBe("query")
		expect(body.error.details.issues[0].path).toEqual(["limit"])
	})

	it("validates path params and turns ApiError into its body", async () => {
		const { handle } = router()
		const bad = await handle(req("GET", "/things/not-a-uuid"))
		expect(bad.status).toBe(400)
		expect((await bad.json()).error.details.where).toBe("params")
		const missing = await handle(req("GET", "/things/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"))
		expect(missing.status).toBe(404)
		expect((await missing.json()).error.message).toBe("No thing with that id.")
		const ok = await handle(req("GET", `/things/${ID}`))
		expect(ok.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
		expect(await ok.text()).toBe(`# thing ${ID}`)
	})

	it("validates JSON bodies and picks the reply status", async () => {
		const { handle } = router()
		const created = await handle(post("/things", { name: "x" }))
		expect(created.status).toBe(201)
		expect(await created.json()).toEqual({ name: "x" })
		expect((await handle(post("/things", { name: "again" }))).status).toBe(200)
		const invalid = await handle(post("/things", { name: "" }))
		expect(invalid.status).toBe(400)
		expect((await invalid.json()).error.details.where).toBe("body")
		const notJson = await handle(
			req("POST", "/things", { body: "{", headers: { "content-type": "application/json" } }),
		)
		expect(notJson.status).toBe(400)
		expect((await notJson.json()).error.message).toBe("The body is not valid JSON.")
		const none = await handle(req("POST", "/things"))
		expect(none.status).toBe(400)
	})

	it("refuses bodies over the endpoint's limit, by header or by stream", async () => {
		const { handle } = router()
		const byHeader = await handle(post("/things", { name: "x" }, { "content-length": "65" }))
		expect(byHeader.status).toBe(413)
		expect((await byHeader.json()).error.code).toBe("too_large")
		const byStream = await handle(post("/things", { name: "y".repeat(100) }))
		expect(byStream.status).toBe(413)
	})

	it("checks an endpoint's own limit before reading the body", async () => {
		const { handle } = router({ createLimited: true })
		// Over the size limit too (declared): the limit answers first, and nothing is read.
		const res = await handle(
			post("/things", { name: "y".repeat(100) }, { "content-length": "112" }),
		)
		expect(res.status).toBe(429)
		expect(res.headers.get("retry-after")).toBe("60")
		expect((await handle(req("GET", "/things"))).status).toBe(200)
	})

	it("gives an endpoint's limit back when the request is invalid, not when the handler fails", async () => {
		const refunds: string[] = []
		const r = createApiRouter({
			endpoints,
			handlers: {
				"things.list": async () => ({ items: [], limit: 1 }),
				"things.get": async () => "",
				"things.special": async () => ({ special: true }),
				"things.create": async () => {
					throw ApiError.of("invalid_url", "Nope.")
				},
				"things.delete": async () => undefined,
				"things.upload": async () => ({ ok: true }),
				"things.broken": async () => ({ ok: true }) as never,
			},
			authenticate: async () => writer,
			limits: {
				"things.create": () => ({ ok: true, refund: () => refunds.push("create") }),
			},
		})
		expect((await r.handle(post("/things", { name: "" }))).status).toBe(400)
		expect((await r.handle(post("/things", { name: "y".repeat(100) }))).status).toBe(413)
		expect(refunds).toEqual(["create", "create"])
		expect((await r.handle(post("/things", { name: "x" }))).status).toBe(422)
		expect(refunds).toHaveLength(2)
	})

	it("takes upload slots only for large bodies, per user and in all", async () => {
		let open = () => {}
		const gate = new Promise<void>((resolve) => {
			open = resolve
		})
		// Requests authenticate in the order they are sent.
		const users = ["a", "a", "a", "a", "a", "b", "c"]
		let n = 0
		const refunds: string[] = []
		const r = createApiRouter({
			endpoints: { "things.upload": endpoints["things.upload"] },
			handlers: {
				"things.upload": async () => {
					await gate
					return { ok: true }
				},
			},
			authenticate: async () => ({ ...writer, userId: users[n++] ?? "z" }),
			limits: {
				"things.upload": (userId) => ({ ok: true, refund: () => refunds.push(userId) }),
			},
			largeBodies: { perOwner: 2, total: 3 },
		})
		// Real clients declare the length; the slot is then taken before anything is read.
		const bigBody = { data: "x".repeat(LARGE_BODY) }
		const big = () =>
			post("/uploads", bigBody, { "content-length": String(JSON.stringify(bigBody).length) })
		// Small bodies never wait for a slot.
		const small = [0, 1].map(() => r.handle(post("/uploads", { data: "x" })))
		const mine = [r.handle(big()), r.handle(big())]
		await new Promise((resolve) => setTimeout(resolve, 20))
		const third = await r.handle(big())
		expect(third.status).toBe(429)
		expect((await third.json()).error).toMatchObject({ code: "rate_limited", retryAfter: 2 })
		// Refused before any work: the endpoint's limit gets its hit back.
		expect(refunds).toEqual(["a"])
		const b = r.handle(big())
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect((await r.handle(big())).status).toBe(429)
		open()
		expect((await Promise.all([...small, ...mine, b])).map((res) => res.status)).toEqual([
			200, 200, 200, 200, 200,
		])
	})

	it("takes a slot once a body without a length grows large", async () => {
		const streamed = (data: string) =>
			req("POST", "/uploads", {
				body: new ReadableStream({
					start(controller) {
						const encode = (text: string) => new TextEncoder().encode(text)
						for (const part of ['{"data":"', data, '"}']) controller.enqueue(encode(part))
						controller.close()
					},
				}),
				headers: { "content-type": "application/json" },
				duplex: "half",
			} as RequestInit)
		// No slots at all: small streamed bodies still go through, large ones are refused.
		const r = createApiRouter({
			endpoints: { "things.upload": endpoints["things.upload"] },
			handlers: { "things.upload": async () => ({ ok: true }) },
			authenticate: async () => writer,
			largeBodies: { perOwner: 0, total: 0 },
		})
		expect((await r.handle(streamed("x"))).status).toBe(200)
		expect((await r.handle(streamed("x".repeat(LARGE_BODY)))).status).toBe(429)
	})

	it("abandons uploads that stall, and gives the limit back", async () => {
		const refunds: number[] = []
		const r = createApiRouter({
			endpoints: { "things.upload": endpoints["things.upload"] },
			handlers: { "things.upload": async () => ({ ok: true }) },
			authenticate: async () => writer,
			limits: { "things.upload": () => ({ ok: true, refund: () => refunds.push(1) }) },
			bodyTimeouts: { idleMs: 30, totalMs: 1000 },
		})
		const stalled = req("POST", "/uploads", {
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"data":'))
				},
			}),
			headers: { "content-type": "application/json" },
			duplex: "half",
		} as RequestInit)
		const res = await r.handle(stalled)
		expect(res.status).toBe(408)
		expect(res.headers.get("connection")).toBe("close")
		expect((await res.json()).error.code).toBe("request_timeout")
		expect(refunds).toEqual([1])
	})

	it("closes the connection after answering bodies it did not read to the end", async () => {
		const { handle } = router()
		const declared = await handle(
			post("/things", { name: "x" }, { "content-length": String(10 * 1024 * 1024) }),
		)
		expect(declared.status).toBe(413)
		expect(declared.headers.get("connection")).toBe("close")
		const streamed = await handle(post("/things", { name: "y".repeat(100) }))
		expect(streamed.status).toBe(413)
		expect(streamed.headers.get("connection")).toBe("close")
		const fine = await handle(post("/things", { name: "x" }))
		expect(fine.headers.get("connection")).toBeNull()
		// Declared over the limit before sign-in: not read, and closed.
		const anonymous = router({ principal: null })
		const refused = await anonymous.handle(
			post("/uploads", { data: "x" }, { "content-length": String(2 * 1024 * 1024) }),
		)
		expect(refused.status).toBe(401)
		expect(refused.headers.get("connection")).toBe("close")
	})

	it("reads the whole body before refusing a signed-in request", async () => {
		const tracked = () => {
			const state = { sent: 0, done: false }
			const body = new ReadableStream({
				pull(controller) {
					if (state.sent >= 1536 * 1024) {
						state.done = true
						controller.close()
					} else {
						state.sent += 256 * 1024
						controller.enqueue(new Uint8Array(256 * 1024))
					}
				},
			})
			return { state, body }
		}
		for (const [options, status] of [
			[{ principal: reader }, 403],
			[{ limited: true }, 429],
		] as const) {
			const { handle } = router(options)
			const upload = tracked()
			const res = await handle(
				req("POST", "/uploads", { body: upload.body, duplex: "half" } as RequestInit),
			)
			expect(res.status).toBe(status)
			// 1.5 MiB, past what is read before sign-in: read to its end, the connection kept.
			expect(upload.state.done).toBe(true)
			expect(res.headers.get("connection")).toBeNull()
		}
	})

	it("reads at most a small body before sign-in", async () => {
		const endless = () => {
			const state = { pulled: 0 }
			const body = new ReadableStream({
				pull(controller) {
					state.pulled++
					controller.enqueue(new Uint8Array(256 * 1024))
				},
			})
			return { state, body }
		}
		const { handle } = router({ principal: null })
		const stream = endless()
		const res = await handle(
			req("POST", "/uploads", { body: stream.body, duplex: "half" } as RequestInit),
		)
		expect(res.status).toBe(401)
		expect(res.headers.get("connection")).toBe("close")
		// 1 MiB, then it stopped reading.
		expect(stream.state.pulled).toBeLessThanOrEqual(6)
	})

	it("does not give the limit back after reading a large body in full", async () => {
		const refunds: number[] = []
		const r = createApiRouter({
			endpoints: { "things.upload": endpoints["things.upload"] },
			handlers: { "things.upload": async () => ({ ok: true }) },
			authenticate: async () => writer,
			limits: { "things.upload": () => ({ ok: true, refund: () => refunds.push(1) }) },
		})
		const invalid = { data: 5, pad: "x".repeat(LARGE_BODY) }
		const res = await r.handle(
			post("/uploads", invalid, { "content-length": String(JSON.stringify(invalid).length) }),
		)
		expect(res.status).toBe(400)
		expect(refunds).toEqual([])
		expect((await r.handle(post("/uploads", { data: 5 }))).status).toBe(400)
		expect(refunds).toEqual([1])
	})

	it("reads and discards the body of a request it refuses early", async () => {
		const tracked = () => {
			const state = { pulled: 0, done: false }
			const body = new ReadableStream({
				pull(controller) {
					state.pulled++
					if (state.pulled > 3) {
						state.done = true
						controller.close()
					} else controller.enqueue(new TextEncoder().encode("xxxx"))
				},
			})
			return { state, body }
		}
		const { handle } = router({ principal: null })
		const refused = tracked()
		const res = await handle(
			req("POST", "/things", { body: refused.body, duplex: "half" } as RequestInit),
		)
		expect(res.status).toBe(401)
		expect(refused.state.done).toBe(true)
		// An unknown route with a body: the same.
		const unknown = tracked()
		expect(
			(await handle(req("POST", "/nothing", { body: unknown.body, duplex: "half" } as RequestInit)))
				.status,
		).toBe(404)
		expect(unknown.state.done).toBe(true)
	})

	it("answers 204 for empty endpoints", async () => {
		const { handle } = router()
		const res = await handle(req("DELETE", `/things/${ID}`))
		expect(res.status).toBe(204)
		expect(await res.text()).toBe("")
	})

	it("turns anything else into 500 internal and logs the route only", async () => {
		const { handle, logged } = router()
		const res = await handle(req("GET", "/broken"))
		expect(res.status).toBe(500)
		expect(await res.json()).toEqual({
			error: { code: "internal", message: "Something went wrong on our side." },
		})
		expect(logged).toEqual(["[api] GET /api/v1/broken"])
		// Without the response check, the mismatch goes out as is.
		const unchecked = router({ checkResponses: false })
		expect((await unchecked.handle(req("GET", "/broken"))).status).toBe(200)
	})
})

describe("readJsonBody", () => {
	it("reads within the limit and cancels beyond it", async () => {
		const body = JSON.stringify({ a: 1 })
		expect(await readJsonBody(new Request("http://x", { method: "POST", body }), 100)).toEqual({
			a: 1,
		})
		await expect(
			readJsonBody(new Request("http://x", { method: "POST", body }), 5),
		).rejects.toMatchObject({ code: "too_large", status: 413 })
		expect(await readJsonBody(new Request("http://x", { method: "POST" }), 5)).toBeUndefined()
	})
})

describe("logging", () => {
	it("logs unexpected errors without their message", async () => {
		const failure = new Error("Failed query: update documents\nparams: my secret note")
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})
		const r = createApiRouter({
			endpoints: { "things.broken": endpoints["things.broken"] },
			handlers: {
				"things.broken": async () => {
					throw failure
				},
			},
			authenticate: async () => writer,
		})
		expect((await r.handle(req("GET", "/broken"))).status).toBe(500)
		const logged = spy.mock.calls.flat().join(" ")
		spy.mockRestore()
		expect(logged).toContain("[api] GET /api/v1/broken")
		expect(logged).not.toContain("secret")
	})
})
