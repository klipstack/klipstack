import { createHmac } from "node:crypto"
import { authLimits, db, eq } from "@klipstack/db"
import { afterAll, expect, it } from "vitest"
import { checkAuthLimit, trustedAuthAddress } from "./auth-limits.server"
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
