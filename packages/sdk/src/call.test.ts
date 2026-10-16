import { defineEndpoint, empty, events, json, text } from "@klipstack/api-contract"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { type ClientOptions, createCaller } from "./call"
import { KlipstackApiError, KlipstackContractError, KlipstackInputError } from "./errors"

const table = {
	"things.list": defineEndpoint({
		id: "things.list",
		method: "GET",
		path: "/things",
		scope: "read",
		query: z.object({
			limit: z.coerce.number().int().min(1).max(10).default(5),
			all: z.stringbool().default(false),
			cursor: z.string().optional(),
		}),
		response: json(z.object({ items: z.array(z.string()), nextCursor: z.string().nullable() })),
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
	"things.create": defineEndpoint({
		id: "things.create",
		method: "POST",
		path: "/things",
		scope: "write",
		body: z.object({ name: z.string().min(1), tags: z.array(z.string()).default([]) }),
		response: json(z.object({ id: z.string() }), [201]),
		errors: [],
	}),
	"things.upload": defineEndpoint({
		id: "things.upload",
		method: "POST",
		path: "/uploads",
		scope: "write",
		bodyLimit: 100,
		body: z.object({ data: z.string() }),
		response: json(z.object({ ok: z.boolean() })),
		errors: [],
	}),
	"things.big": defineEndpoint({
		id: "things.big",
		method: "POST",
		path: "/big",
		scope: "write",
		bodyLimit: 4 * 1024 * 1024,
		retryOnCutoff: true,
		body: z.object({ data: z.string() }),
		response: json(z.object({ ok: z.boolean() })),
		errors: [],
	}),
	"things.bigOnce": defineEndpoint({
		id: "things.bigOnce",
		method: "POST",
		path: "/big-once",
		scope: "write",
		bodyLimit: 4 * 1024 * 1024,
		body: z.object({ data: z.string() }),
		response: json(z.object({ ok: z.boolean() })),
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
	"things.watch": defineEndpoint({
		id: "things.watch",
		method: "POST",
		path: "/watch",
		scope: "write",
		response: events(
			z.discriminatedUnion("type", [
				z.object({ type: z.literal("text"), text: z.string() }),
				z.object({ type: z.literal("done"), n: z.number() }),
			]),
		),
		errors: [],
	}),
	"things.public": defineEndpoint({
		id: "things.public",
		method: "GET",
		path: "/public",
		scope: "none",
		response: json(z.object({ ok: z.boolean() })),
		errors: [],
	}),
} as const

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

type Call = { url: URL; method: string; headers: Headers; body: string | null }

/** A client over a fake fetch; `respond` picks the response for each call, in order. */
function client(
	respond: (call: Call, n: number) => Response,
	options: Partial<ClientOptions> = {},
) {
	const calls: Call[] = []
	const tokens: boolean[] = []
	const call = createCaller(table, {
		baseUrl: "https://klipstack.test/",
		token: ({ refresh }) => {
			tokens.push(refresh)
			return refresh ? "fresh" : "stale"
		},
		userAgent: "klipstack-test/1.0",
		fetch: async (input, init) => {
			const headers = new Headers(init?.headers)
			const entry = {
				url: new URL(String(input)),
				method: init?.method ?? "GET",
				headers,
				body: init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : null,
			}
			calls.push(entry)
			return respond(entry, calls.length)
		},
		...options,
	})
	return { call, calls, tokens }
}

const ok = (body: unknown, status = 200) => Response.json(body, { status })
const error = (status: number, code: string, extra: Record<string, unknown> = {}) =>
	Response.json({ error: { code, message: `${code} happened`, ...extra } }, { status })

describe("requests", () => {
	it("builds the URL under /api/v1 with params and query, and sends auth headers", async () => {
		const { call, calls, tokens } = client(() => ok({ items: ["a"], nextCursor: null }))
		await call("things.list", { query: { limit: 3, all: true } })
		const [c] = calls
		expect(c?.url.href).toBe("https://klipstack.test/api/v1/things?limit=3&all=true")
		expect(c?.headers.get("authorization")).toBe("Bearer stale")
		expect(c?.headers.get("user-agent")).toBe("klipstack-test/1.0")
		expect(c?.headers.get("accept")).toBe("application/json")
		expect(tokens).toEqual([false])
	})

	it("sends the caller's headers without letting them replace its own", async () => {
		const { call, calls } = client(() => ok({ items: [], nextCursor: null }), {
			headers: { "X-Klipstack-Client": "ios/1.0.0", Accept: "text/plain" },
		})
		await call("things.list")
		expect(calls[0]?.headers.get("x-klipstack-client")).toBe("ios/1.0.0")
		expect(calls[0]?.headers.get("accept")).toBe("application/json")
	})

	it("fills and encodes path params, and asks for the text type", async () => {
		const { call, calls } = client(
			() => new Response("# hi", { headers: { "content-type": "text/markdown" } }),
		)
		expect(await call("things.get", { params: { id: ID } })).toBe("# hi")
		expect(calls[0]?.url.pathname).toBe(`/api/v1/things/${ID}`)
		expect(calls[0]?.headers.get("accept")).toBe("text/markdown")
	})

	it("sends JSON bodies as given and leaves absent query values out", async () => {
		const { call, calls } = client((c) =>
			c.method === "POST" ? ok({ id: "1" }, 201) : ok({ items: [], nextCursor: null }),
		)
		await call("things.create", { body: { name: "x" } })
		expect(calls[0]?.method).toBe("POST")
		expect(calls[0]?.headers.get("content-type")).toBe("application/json")
		expect(calls[0]?.body).toBe('{"name":"x"}')
		await call("things.list", { query: { cursor: undefined } })
		expect(calls[1]?.url.search).toBe("")
	})

	it("refuses a body over the endpoint's byte limit before sending", async () => {
		const { call, calls } = client(() => ok({ ok: true }))
		// 30 characters of 3 bytes each: fine by length, too big in UTF-8 with the JSON around it.
		const error = await call("things.upload", { body: { data: "€".repeat(30) } }).catch(
			(e: unknown) => e,
		)
		expect(error).toBeInstanceOf(KlipstackInputError)
		expect((error as KlipstackInputError).message).toContain("takes at most 100")
		expect(calls).toHaveLength(0)
		await call("things.upload", { body: { data: "€".repeat(20) } })
		expect(calls).toHaveLength(1)
	})

	it("sends no token to endpoints without a scope", async () => {
		const { call, calls, tokens } = client(() => ok({ ok: true }))
		await call("things.public")
		expect(calls[0]?.headers.has("authorization")).toBe(false)
		expect(tokens).toEqual([])
	})

	it("checks the input against the contract before sending", async () => {
		const { call, calls } = client(() => ok({}))
		await expect(call("things.list", { query: { limit: 99 } })).rejects.toBeInstanceOf(
			KlipstackInputError,
		)
		await expect(call("things.get", { params: { id: "nope" } })).rejects.toMatchObject({
			where: "params",
		})
		await expect(call("things.create", { body: { name: "" } })).rejects.toMatchObject({
			where: "body",
			issues: [expect.objectContaining({ path: ["name"] })],
		})
		expect(calls).toHaveLength(0)
	})
})

describe("responses", () => {
	it("refreshes the token once after a 401 and retries", async () => {
		const { call, calls, tokens } = client((c) =>
			c.headers.get("authorization") === "Bearer fresh"
				? ok({ items: [], nextCursor: null })
				: error(401, "unauthorized"),
		)
		expect(await call("things.list")).toEqual({ items: [], nextCursor: null })
		expect(calls.map((c) => c.headers.get("authorization"))).toEqual([
			"Bearer stale",
			"Bearer fresh",
		])
		expect(tokens).toEqual([false, true])
	})

	it("checks the token before sending a large body, and refreshes it first if refused", async () => {
		const data = "x".repeat(2 * 1024 * 1024)
		const expired = client((c) => {
			const fresh = c.headers.get("authorization") === "Bearer fresh"
			if (c.url.pathname === "/api/v1/me") return fresh ? ok({}) : error(401, "unauthorized")
			if (!fresh) throw new TypeError("fetch failed")
			return ok({ ok: true })
		})
		expect(await expired.call("things.bigOnce", { body: { data } })).toEqual({ ok: true })
		expect(expired.calls.map((c) => c.url.pathname)).toEqual([
			"/api/v1/me",
			"/api/v1/me",
			"/api/v1/big-once",
		])
		expect(expired.tokens).toEqual([false, true])

		// Still refused after refreshing: the 401, and the body never goes out.
		const revoked = client((c) =>
			c.url.pathname === "/api/v1/me" ? error(401, "unauthorized") : ok({ ok: true }),
		)
		await expect(revoked.call("things.big", { body: { data } })).rejects.toMatchObject({
			status: 401,
			code: "unauthorized",
		})
		expect(revoked.calls.map((c) => c.url.pathname)).toEqual(["/api/v1/me", "/api/v1/me"])

		// Small bodies need no check.
		const small = client(() => ok({ ok: true }))
		await small.call("things.big", { body: { data: "x" } })
		expect(small.calls.map((c) => c.url.pathname)).toEqual(["/api/v1/big"])
	})

	it("sends a broken large upload again only where the contract allows it", async () => {
		const data = "x".repeat(2 * 1024 * 1024)
		// The token is fine when checked, and expires before the upload lands.
		const expiring = () => {
			let checks = 0
			return client((c) => {
				const fresh = c.headers.get("authorization") === "Bearer fresh"
				if (c.url.pathname === "/api/v1/me")
					return fresh || checks++ === 0 ? ok({}) : error(401, "unauthorized")
				if (!fresh) throw new TypeError("fetch failed")
				return ok({ ok: true })
			})
		}
		const resendable = expiring()
		expect(await resendable.call("things.big", { body: { data } })).toEqual({ ok: true })
		expect(resendable.calls.map((c) => c.url.pathname)).toEqual([
			"/api/v1/me",
			"/api/v1/big",
			"/api/v1/me",
			"/api/v1/big",
		])
		const once = expiring()
		await expect(once.call("things.bigOnce", { body: { data } })).rejects.toMatchObject({
			status: 401,
		})
		expect(once.calls.map((c) => c.url.pathname)).toEqual([
			"/api/v1/me",
			"/api/v1/big-once",
			"/api/v1/me",
		])
	})

	it("treats a proxy's gateway error on a large upload like a broken connection", async () => {
		const data = "x".repeat(2 * 1024 * 1024)
		const proxied = (tokenFine: boolean) => {
			let checks = 0
			return client((c) => {
				const fresh = c.headers.get("authorization") === "Bearer fresh"
				if (c.url.pathname === "/api/v1/me")
					return tokenFine || fresh || checks++ === 0 ? ok({}) : error(401, "unauthorized")
				if (!fresh) return new Response("<html>502 Bad Gateway</html>", { status: 502 })
				return ok({ ok: true })
			})
		}
		expect(await proxied(false).call("things.big", { body: { data } })).toEqual({ ok: true })
		await expect(proxied(true).call("things.big", { body: { data } })).rejects.toMatchObject({
			status: 502,
			code: "unknown",
		})
	})

	it("keeps a network error when the token is fine, or the body is small", async () => {
		const failure = new TypeError("fetch failed")
		const down = client((c) => {
			if (c.url.pathname === "/api/v1/me") return ok({})
			throw failure
		})
		await expect(
			down.call("things.big", { body: { data: "x".repeat(2 * 1024 * 1024) } }),
		).rejects.toBe(failure)
		expect(down.calls.map((c) => c.url.pathname)).toEqual([
			"/api/v1/me",
			"/api/v1/big",
			"/api/v1/me",
		])
		const small = client(() => {
			throw failure
		})
		await expect(small.call("things.big", { body: { data: "x" } })).rejects.toBe(failure)
		expect(small.calls).toHaveLength(1)
	})

	it("gives up after a second 401", async () => {
		const { call, calls } = client(() => error(401, "unauthorized"))
		await expect(call("things.list")).rejects.toMatchObject({ status: 401, code: "unauthorized" })
		expect(calls).toHaveLength(2)
	})

	it("maps error bodies to KlipstackApiError, and other failures to unknown", async () => {
		const limited = client(() =>
			error(429, "rate_limited", { retryAfter: 30, details: { window: "minute" } }),
		)
		const err = await limited.call("things.list").catch((e: unknown) => e)
		expect(err).toBeInstanceOf(KlipstackApiError)
		expect(err).toMatchObject({
			status: 429,
			code: "rate_limited",
			message: "rate_limited happened",
			retryAfter: 30,
			details: { window: "minute" },
		})
		const proxy = client(() => new Response("<html>Bad gateway</html>", { status: 502 }))
		await expect(proxy.call("things.list")).rejects.toMatchObject({
			status: 502,
			code: "unknown",
			message: "HTTP 502: <html>Bad gateway</html>",
			retryAfter: null,
		})
	})

	it("checks JSON responses against the contract and drops unknown keys", async () => {
		const extra = client(() => ok({ items: ["a"], nextCursor: null, newField: 1 }))
		expect(await extra.call("things.list")).toEqual({ items: ["a"], nextCursor: null })
		const broken = client(() => ok({ items: "a" }))
		await expect(broken.call("things.list")).rejects.toBeInstanceOf(KlipstackContractError)
	})

	it("returns nothing for empty responses", async () => {
		const { call } = client(() => new Response(null, { status: 204 }))
		expect(await call("things.delete", { params: { id: ID } })).toBeUndefined()
	})
})

describe("cancelling", () => {
	/** A fetch that answers only when told, and gives up when its signal aborts. */
	const hanging = () => {
		const seen: (AbortSignal | undefined)[] = []
		const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			seen.push(init?.signal ?? undefined)
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
			})
		}) as typeof globalThis.fetch
		return { fetch, seen }
	}

	it("stops a request when the call's or the client's signal aborts", async () => {
		const perCall = hanging()
		const { call } = client(() => ok({}), { fetch: perCall.fetch })
		const controller = new AbortController()
		const pending = call("things.get", { params: { id: ID }, signal: controller.signal })
		await new Promise((resolve) => setTimeout(resolve, 0))
		controller.abort()
		await expect(pending).rejects.toMatchObject({ name: "AbortError" })
		expect(perCall.seen).toHaveLength(1)

		const clientWide = hanging()
		const timeout = client(() => ok({}), {
			fetch: clientWide.fetch,
			signal: AbortSignal.timeout(20),
		})
		await expect(timeout.call("things.get", { params: { id: ID } })).rejects.toMatchObject({
			name: "TimeoutError",
		})
	})

	it("sends nothing once the signal has aborted", async () => {
		const { call, calls } = client(() => ok({}), { signal: AbortSignal.abort() })
		await expect(call("things.get", { params: { id: ID } })).rejects.toMatchObject({
			name: "AbortError",
		})
		expect(calls).toEqual([])
	})
})

describe("events", () => {
	const stream = (...lines: unknown[]) =>
		new Response(lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		})
	const all = async (iterable: AsyncIterable<unknown>) => {
		const out: unknown[] = []
		for await (const event of iterable) out.push(event)
		return out
	}

	it("asks for an event stream and reads each event, skipping a kind it doesn't know", async () => {
		const { call, calls } = client(() =>
			stream({ type: "text", text: "Hi" }, { type: "later", x: 1 }, { type: "done", n: 2 }),
		)
		expect(await all(await call("things.watch"))).toEqual([
			{ type: "text", text: "Hi" },
			{ type: "done", n: 2 },
		])
		expect(calls[0]?.headers.get("accept")).toBe("text/event-stream")
	})

	it("fails on an event of a known kind that breaks the contract", async () => {
		const { call } = client(() => stream({ type: "text", text: "Hi" }, { type: "done", n: "two" }))
		const seen: unknown[] = []
		const reading = (async () => {
			for await (const event of await call("things.watch")) seen.push(event)
		})()
		await expect(reading).rejects.toBeInstanceOf(KlipstackContractError)
		expect(seen).toEqual([{ type: "text", text: "Hi" }])
	})

	it("answers a refusal before the stream as an API error", async () => {
		const { call } = client(() => error(403, "limit_reached", { details: { max: 5 } }))
		const refused = await call("things.watch").catch((e: unknown) => e)
		expect(refused).toBeInstanceOf(KlipstackApiError)
		expect(refused).toMatchObject({ code: "limit_reached", details: { max: 5 } })
	})
})
