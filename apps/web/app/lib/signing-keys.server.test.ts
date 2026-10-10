import { db, jwks } from "@klipstack/db"
import { describe, expect, it } from "vitest"
import { createSigningKeyCheck, namesKnownSigningKey, tokenKeyId } from "./signing-keys.server"

const jws = (header: unknown) =>
	`${Buffer.from(JSON.stringify(header)).toString("base64url")}.e30.c2ln`

describe("signing key ids", () => {
	it("reads the kid of a compact JWS", () => {
		expect(tokenKeyId(jws({ alg: "EdDSA", kid: "k1" }))).toBe("k1")
		expect(tokenKeyId(jws({ alg: "EdDSA" }))).toBeNull()
		expect(tokenKeyId(jws({ kid: 3 }))).toBeNull()
		expect(tokenKeyId("opaque-token")).toBeNull()
		expect(tokenKeyId("")).toBeNull()
	})

	it("accepts a key created after an unknown one was looked up", async () => {
		const keys = new Set<string>()
		const looked: string[] = []
		const check = createSigningKeyCheck(async (kid) => {
			looked.push(kid)
			return keys.has(kid)
		})
		expect(await check(jws({ alg: "EdDSA", kid: "made-up" }))).toBe(false)
		// The first key is created just now, as on a fresh database or after a rotation.
		keys.add("new-key")
		expect(await check(jws({ alg: "EdDSA", kid: "new-key" }))).toBe(true)
		// Found keys are remembered; unknown ones are looked up again.
		expect(await check(jws({ alg: "EdDSA", kid: "new-key" }))).toBe(true)
		expect(await check(jws({ alg: "EdDSA", kid: "made-up" }))).toBe(false)
		expect(looked).toEqual(["made-up", "new-key", "made-up"])
	})

	it("skips the lookup for tokens that name no plausible key", async () => {
		const looked: string[] = []
		const check = createSigningKeyCheck(async (kid) => {
			looked.push(kid)
			return true
		})
		expect(await check("not.a.jwt")).toBe(false)
		expect(await check(jws({ alg: "EdDSA" }))).toBe(false)
		expect(await check(jws({ alg: "EdDSA", kid: "x".repeat(129) }))).toBe(false)
		expect(looked).toEqual([])
	})

	it("looks our keys up in the database", async () => {
		const [ours] = await db.select({ id: jwks.id }).from(jwks).limit(1)
		expect(await namesKnownSigningKey(jws({ alg: "EdDSA", kid: `made-up-${Date.now()}` }))).toBe(
			false,
		)
		if (ours) expect(await namesKnownSigningKey(jws({ alg: "EdDSA", kid: ours.id }))).toBe(true)
	})
})
