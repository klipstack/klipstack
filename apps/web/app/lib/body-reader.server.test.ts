import { describe, expect, it } from "vitest"
import { type BodyRefusal, discardBody, readBody } from "./body-reader.server"

const timeouts = { idleMs: 50, totalMs: 500 }
const post = (body: BodyInit, headers?: HeadersInit) =>
	new Request("http://localhost/x", {
		method: "POST",
		body,
		headers,
		duplex: "half",
	} as RequestInit)
const refusal = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error) => error as BodyRefusal,
	)

describe("readBody", () => {
	it("returns the bytes, or nothing for an empty body", async () => {
		expect(await readBody(post("abc"), 10, { timeouts })).toEqual(new TextEncoder().encode("abc"))
		expect(await readBody(new Request("http://x", { method: "POST" }), 10, { timeouts })).toBe(
			undefined,
		)
	})
	it("refuses a declared length over the limit without reading", async () => {
		const request = post("x", { "Content-Length": "100" })
		const error = await refusal(readBody(request, 10, { timeouts }))
		expect(error).toMatchObject({ reason: "too_large", unread: true })
		expect(request.bodyUsed).toBe(false)
	})
	it("refuses a stream over the limit and counts what it read", async () => {
		const progress = { bytes: 0 }
		const error = await refusal(readBody(post("x".repeat(30)), 10, { timeouts, progress }))
		expect(error).toMatchObject({ reason: "too_large", unread: true })
		expect(progress.bytes).toBe(30)
	})
	it("throws an oversized body away within `overflow`, and says the connection can stay", async () => {
		const error = await refusal(readBody(post("x".repeat(30)), 10, { timeouts, overflow: 100 }))
		expect(error).toMatchObject({ reason: "too_large", unread: false })
	})
	it("refuses a stalled stream", async () => {
		const stalled = new ReadableStream()
		const error = await refusal(readBody(post(stalled), 10, { timeouts }))
		expect(error).toMatchObject({ reason: "too_slow", unread: true })
	})
	it("drains the rest when onLarge refuses", async () => {
		const boom = new Error("no slot")
		const error = await refusal(
			readBody(post("x".repeat(20)), 100, {
				timeouts,
				largeAt: 5,
				onLarge: () => {
					throw boom
				},
			}),
		)
		expect(error).toMatchObject({ reason: "large_refused", unread: false, cause: boom })
	})
	it("runs onLarge once", async () => {
		let calls = 0
		await readBody(post("x".repeat(20)), 100, { timeouts, largeAt: 5, onLarge: () => calls++ })
		expect(calls).toBe(1)
	})
})

describe("discardBody", () => {
	it("is true for no body or a body read to its end, false for a declared overflow", async () => {
		expect(await discardBody(new Request("http://x"), 10, timeouts)).toBe(true)
		expect(await discardBody(post("abc"), 10, timeouts)).toBe(true)
		expect(await discardBody(post("x", { "Content-Length": "100" }), 10, timeouts)).toBe(false)
	})
})
