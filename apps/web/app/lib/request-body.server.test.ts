import { describe, expect, it } from "vitest"
import { boundedRequest, readForm } from "./request-body.server"
import { takeUploadSlot } from "./upload-slots.server"

const request = (body: BodyInit, headers?: HeadersInit) =>
	new Request("http://localhost/login.data", {
		method: "POST",
		body,
		headers,
		duplex: "half",
	} as RequestInit)

describe("bounded request bodies", () => {
	it("limits actual UTF-8 bytes with missing or dishonest Content-Length", async () => {
		for (const headers of [undefined, { "Content-Length": "1" }]) {
			await expect(boundedRequest(request("é".repeat(10), headers), 10)).rejects.toMatchObject({
				status: 413,
			})
		}
	})
	it("rejects an oversized declared length before parsing", async () => {
		await expect(
			boundedRequest(request("x", { "Content-Length": "100" }), 10),
		).rejects.toMatchObject({ status: 413 })
	})
	it("bounds unknown form fields on both document and data posts", async () => {
		for (const path of ["/login", "/login.data"]) {
			const req = new Request(`http://localhost${path}`, {
				method: "POST",
				body: new URLSearchParams({ padding: "x".repeat(65536) }),
			})
			await expect(readForm(req)).rejects.toMatchObject({ status: 413 })
		}
	})
	it("times out stalled streams, closes the connection, and frees upload slots", async () => {
		let cancelled = false
		const stream = new ReadableStream({
			cancel() {
				cancelled = true
			},
		})
		await expect(
			boundedRequest(request(stream), 100, "slow", { idleMs: 5, totalMs: 50 }),
		).rejects.toMatchObject({ status: 408 })
		expect(cancelled).toBe(false) // The response must reach Express before the socket closes.
		expect(await (await boundedRequest(request("ok"), 100, "slow")).text()).toBe("ok")
	})
	it("counts large uploads with the API's: one pool per owner", async () => {
		const big = 2 * 1024 * 1024
		// Two API uploads in progress for this owner.
		const api = [takeUploadSlot("owner-a"), takeUploadSlot("owner-a")]
		await expect(boundedRequest(request("{}"), big, "owner-a")).rejects.toMatchObject({
			status: 429,
		})
		// Small bodies and other owners are not held up.
		expect(await (await boundedRequest(request("ok"), 100, "owner-a")).text()).toBe("ok")
		expect(await (await boundedRequest(request("ok"), big, "owner-b")).text()).toBe("ok")
		api[0]?.()
		expect(await (await boundedRequest(request("ok"), big, "owner-a")).text()).toBe("ok")
		api[1]?.()
	})
	it("accepts valid forms", async () => {
		const form = await readForm(request(new URLSearchParams({ email: "owner@example.com" })))
		expect(form.get("email")).toBe("owner@example.com")
	})
})
