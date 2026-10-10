import { createHmac, randomUUID } from "node:crypto"
import { authLimits, db, eq, inArray, inviteRequests, like, sql } from "@klipstack/db"
import { afterAll, afterEach, describe, expect, it } from "vitest"
import { adminFixtures } from "~/test/admin-fixtures"
import { env } from "./env.server"
import {
	checkFormToken,
	FORM_MAX_MS,
	FORM_MIN_MS,
	formToken,
	INVITE_REQUEST_PENDING_MAX,
	requestInvite,
} from "./invite-requests.server"

const TAG = `waitlist-${randomUUID().slice(0, 8)}`
const fx = adminFixtures("invite-requests")
const emails: string[] = []
const address = () => {
	const email = `${TAG}-${randomUUID()}@example.com`
	emails.push(email)
	return email
}
const limitKey = (kind: "ip" | "account", value: string) =>
	createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update(`/request-invite:${kind}:${value}`)
		.digest("hex")
/** A token issued long enough ago to pass the minimum time. */
const aged = () => formToken(Date.now() - FORM_MIN_MS - 1000)

const ips: string[] = []
function headers() {
	const ip = `${TAG}-${randomUUID()}`
	ips.push(ip)
	return new Headers({
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
	})
}

const ask = (email: string, extra: { token?: unknown; trap?: unknown; note?: string } = {}) =>
	requestInvite(
		{ email, note: extra.note, locale: "es", token: extra.token ?? aged(), trap: extra.trap ?? "" },
		headers(),
	)

const stored = async (email: string) =>
	db.select().from(inviteRequests).where(eq(inviteRequests.email, email.toLowerCase()))

afterEach(async () => {
	await db.delete(inviteRequests).where(like(inviteRequests.email, `${TAG}-%`))
})
afterAll(async () => {
	await fx.cleanup()
	const keys = [
		...ips.map((ip) => limitKey("ip", ip)),
		...emails.map((email) => limitKey("account", email)),
	]
	await db.delete(authLimits).where(inArray(authLimits.key, keys))
})

describe("form token", () => {
	it("passes a form shown long enough ago, and no sooner", () => {
		const now = Date.now()
		expect(checkFormToken(formToken(now - FORM_MIN_MS), now)).toBe("ok")
		expect(checkFormToken(formToken(now - FORM_MIN_MS + 1), now)).toBe("too_fast")
		expect(checkFormToken(formToken(now - FORM_MAX_MS - 1), now)).toBe("expired")
	})

	it("refuses a token it did not sign", () => {
		const [issued] = formToken(Date.now() - 60_000).split(".")
		expect(checkFormToken(`${issued}.${"0".repeat(64)}`)).toBe("invalid")
		expect(checkFormToken(`${Number(issued) - 60_000}.${formToken().split(".")[1]}`)).toBe(
			"invalid",
		)
		expect(checkFormToken("nonsense")).toBe("invalid")
		expect(checkFormToken(undefined)).toBe("invalid")
	})
})

describe("requestInvite", () => {
	it("stores one request per address, lowercased, with its language and note", async () => {
		const email = address()
		expect(await ask(email.toUpperCase(), { note: "  For my reading group  " })).toBe("received")
		expect(await ask(email)).toBe("received")
		const rows = await stored(email)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ email, locale: "es", note: "For my reading group" })
	})

	it("answers bots as it answers people, and stores nothing", async () => {
		const trapped = address()
		expect(await ask(trapped, { trap: "http://spam.example" })).toBe("received")
		const hasty = address()
		expect(await ask(hasty, { token: formToken() })).toBe("received")
		expect(await stored(trapped)).toHaveLength(0)
		expect(await stored(hasty)).toHaveLength(0)
	})

	it("asks for the form again when its token is old or forged", async () => {
		const email = address()
		expect(await ask(email, { token: formToken(Date.now() - FORM_MAX_MS - 1000) })).toBe("expired")
		expect(await ask(email, { token: "123.abc" })).toBe("expired")
		expect(await stored(email)).toHaveLength(0)
	})

	it("stores nothing for an address that has an account, and says the same", async () => {
		const member = await fx.account()
		expect(await ask(member.email)).toBe("received")
		expect(await stored(member.email)).toHaveLength(0)
	})

	it("limits requests per address", async () => {
		const email = address()
		for (let i = 0; i < 3; i++) await ask(email)
		await expect(ask(email)).rejects.toMatchObject({ statusCode: 429 })
	})

	it("says the list is full past its size, without storing more", async () => {
		const [{ count }] = (await db
			.select({ count: sql<number>`count(*)::int` })
			.from(inviteRequests)) as [{ count: number }]
		const missing = Math.max(0, INVITE_REQUEST_PENDING_MAX - count)
		await db.execute(sql`
			insert into invite_requests (email, locale)
			select ${`${TAG}-fill-`} || n || '@example.com', 'en' from generate_series(1, ${missing}) n
		`)
		const email = address()
		expect(await ask(email)).toBe("full")
		expect(await stored(email)).toHaveLength(0)
	})
})
