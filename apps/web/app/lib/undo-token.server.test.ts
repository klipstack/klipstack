import { describe, expect, it } from "vitest"
import { readUndo, signUndo, UNDO_TTL_MS } from "./undo-token.server"

describe("undo tokens", () => {
	const payload = { docs: [{ id: "a", starredAt: null }] }

	it("give back what was signed, to the same user", () => {
		expect(readUndo("u1", signUndo("u1", payload))).toEqual(payload)
	})

	it("refuse another user", () => {
		expect(readUndo("u2", signUndo("u1", payload))).toBeNull()
	})

	it("refuse a changed payload", () => {
		const [, sig] = signUndo("u1", payload).split(".")
		const forged = Buffer.from(
			JSON.stringify({ u: "u1", t: Date.now(), p: { docs: [{ id: "b" }] } }),
		).toString("base64url")
		expect(readUndo("u1", `${forged}.${sig}`)).toBeNull()
	})

	it("refuse an old token, and garbage", () => {
		const now = Date.now()
		const token = signUndo("u1", payload, now)
		expect(readUndo("u1", token, now + UNDO_TTL_MS - 1)).toEqual(payload)
		expect(readUndo("u1", token, now + UNDO_TTL_MS + 1)).toBeNull()
		expect(readUndo("u1", "")).toBeNull()
		expect(readUndo("u1", "a.b.c")).toBeNull()
		expect(readUndo("u1", `${token}x`)).toBeNull()
	})
})
