import { createHmac } from "node:crypto"
import { authLimits, db, eq } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { addressLimitKey, checkAuthLimit, trustedAuthAddress } from "./auth-limits.server"
import { auth } from "./auth.server"
import { env } from "./env.server"

const owned = new Set<string>()
const key = (path: string, kind: string, value: string) => {
	const result = createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(`${path}:${kind}:${value}`)
		.digest("hex")
	owned.add(result)
	return result
}
function headers(ip: string) {
	return new Headers({
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
	})
}
afterAll(async () => {
	for (const k of owned) await db.delete(authLimits).where(eq(authLimits.key, k))
})

it.each([
	["/sign-in/email", 10],
	["/sign-up/email", 5],
	["/sign-in/magic-link", 3],
	["/request-password-reset", 3],
	["/send-verification-email", 3],
] as const)(
	"shares the %s account limit across addresses and resets after cooldown",
	async (path, limit) => {
		const email = `limit-${crypto.randomUUID()}@example.com`
		const accountKey = key(path, "account", email)
		for (let i = 0; i < limit; i++) {
			const ip = `test-${crypto.randomUUID()}`
			key(path, "ip", ip)
			await checkAuthLimit(path, email.toUpperCase(), headers(ip))
		}
		const ip = `test-${crypto.randomUUID()}`
		key(path, "ip", ip)
		await expect(checkAuthLimit(path, email, headers(ip))).rejects.toMatchObject({
			statusCode: 429,
		})
		await db
			.update(authLimits)
			.set({ resetAt: new Date(0) })
			.where(eq(authLimits.key, accountKey))
		await expect(checkAuthLimit(path, email, headers(ip))).resolves.toBeUndefined()
	},
)

it("applies the same limiter to server API calls and HTTP magic-link requests", async () => {
	const email = `limit-${crypto.randomUUID()}@example.com`
	const ip = `test-${crypto.randomUUID()}`
	key("/sign-in/magic-link", "account", email)
	key("/sign-in/magic-link", "ip", ip)
	for (let i = 0; i < 3; i++)
		await auth.api.signInMagicLink({ body: { email }, headers: headers(ip) })
	const h = headers(ip)
	h.set("content-type", "application/json")
	h.set("origin", env.APP_URL)
	const response = await auth.handler(
		new Request(`${env.APP_URL}/api/auth/sign-in/magic-link`, {
			method: "POST",
			headers: h,
			body: JSON.stringify({ email }),
		}),
	)
	expect(response.status).toBe(429)
	expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0)
})

it("ignores forged forwarding headers for client-IP limits", () => {
	expect(
		trustedAuthAddress(
			new Headers({ "x-forwarded-for": "1.2.3.4", "x-klipstack-client-ip": "1.2.3.4" }),
		),
	).toBe("unknown")
	const signed = headers("192.0.2.1")
	signed.set("x-forwarded-for", "1.2.3.4")
	expect(trustedAuthAddress(signed)).toBe("192.0.2.1")
	signed.set("x-klipstack-client-ip", "1.2.3.4")
	expect(trustedAuthAddress(signed)).toBe("unknown")
})

describe("per-address limits", () => {
	const path = "/app/sign-in/apple" // The address alone, 30 in 15 minutes.
	const limit = 30
	const hex = () => Math.floor(Math.random() * 0xffff).toString(16)

	it("count every address of one IPv6 /64 together, and each /64 apart", async () => {
		const prefix = `2001:db8:${hex()}:${hex()}`
		key(path, "ip", `${prefix}::/64`)
		for (let i = 0; i < limit; i++)
			await checkAuthLimit(path, undefined, headers(`${prefix}:${hex()}:${hex()}:${hex()}:${i}`))
		await expect(
			checkAuthLimit(path, undefined, headers(`${prefix.toUpperCase()}::beef`)),
		).rejects.toMatchObject({ statusCode: 429 })
		const other = `2001:db8:${hex()}:${hex()}`
		key(path, "ip", `${other}::/64`)
		await expect(checkAuthLimit(path, undefined, headers(`${other}::1`))).resolves.toBeUndefined()
	})

	it("name an address's counter by its key, so deleting it (as the e2e helpers do) resets it", async () => {
		const prefix = `2001:db8:${hex()}:${hex()}`
		key(path, "ip", `${prefix}::/64`)
		for (let i = 0; i < limit; i++) await checkAuthLimit(path, undefined, headers(`${prefix}::1`))
		await expect(checkAuthLimit(path, undefined, headers(`${prefix}::1`))).rejects.toMatchObject({
			statusCode: 429,
		})
		await db.delete(authLimits).where(eq(authLimits.key, addressLimitKey(path, `${prefix}::2`)))
		await expect(checkAuthLimit(path, undefined, headers(`${prefix}::1`))).resolves.toBeUndefined()
	})

	it("count an IPv4-mapped IPv6 address as its IPv4 address", async () => {
		const ipv4 = `198.18.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
		key(path, "ip", ipv4)
		for (let i = 0; i < limit; i++)
			await checkAuthLimit(path, undefined, headers(i % 2 ? ipv4 : `::ffff:${ipv4}`))
		await expect(checkAuthLimit(path, undefined, headers(ipv4))).rejects.toMatchObject({
			statusCode: 429,
		})
		await expect(checkAuthLimit(path, undefined, headers(`::FFFF:${ipv4}`))).rejects.toMatchObject({
			statusCode: 429,
		})
	})
})
