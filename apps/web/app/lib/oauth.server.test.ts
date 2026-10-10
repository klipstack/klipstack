import { makeSignature } from "better-auth/crypto"
import { describe, expect, it } from "vitest"
import { env } from "./env.server"
import { signedOAuthQuery, verifySignedOAuthQuery } from "./oauth.server"

/** An authorization request signed the way the provider signs the one it sends to /login. */
async function signed(exp: number) {
	const values = { client_id: "klipstack-cli", exp: String(exp) }
	const params = new URLSearchParams([
		...Object.keys(values).map((name) => ["ba_param", name]),
		...Object.entries(values),
	])
	const sorted = new URLSearchParams(
		[...params].sort(([ka, va], [kb, vb]) =>
			ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1,
		),
	)
	sorted.append("sig", await makeSignature(sorted.toString(), env.BETTER_AUTH_SECRET))
	return sorted.toString()
}

const now = () => Math.floor(Date.now() / 1000)

describe("the signed OAuth query", () => {
	it("is taken from the page's address without the parameters it did not sign", async () => {
		const query = await signed(now() + 600)
		const url = new URL(`http://localhost/login?${query}&utm_source=mail`)
		expect(signedOAuthQuery(url)).toBe(query)
		expect(signedOAuthQuery(new URL("http://localhost/login?client_id=x"))).toBeNull()
	})

	it("holds while intact and unexpired, and not after", async () => {
		expect(await verifySignedOAuthQuery(await signed(now() + 600))).toBe(true)
		expect(await verifySignedOAuthQuery(await signed(now() - 1))).toBe(false)

		const tampered = (await signed(now() + 600)).replace("klipstack-cli", "someone-else")
		expect(await verifySignedOAuthQuery(tampered)).toBe(false)
		const twice = await signed(now() + 600)
		expect(
			await verifySignedOAuthQuery(`${twice}&sig=${new URLSearchParams(twice).get("sig")}`),
		).toBe(false)
	})
})
