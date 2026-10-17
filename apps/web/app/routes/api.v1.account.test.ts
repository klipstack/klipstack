import { randomUUID } from "node:crypto"
import { CLI_CLIENT_ID, MOBILE_CLIENT_ID } from "@klipstack/api-contract/auth"
import {
	db,
	eq,
	feeds,
	monthOf,
	subscriptions,
	topicLibraries,
	usageCounts,
	user,
	userFeatures,
} from "@klipstack/db"
import { stopBoss } from "@klipstack/queue"
import type { KlipstackApiError } from "@klipstack/sdk"
import { afterAll, describe, expect, it, vi } from "vitest"

// A server with an AI provider and topic models set up.
vi.hoisted(() => {
	process.env.AI_FAKE = "1"
})

const { env } = await import("~/lib/env.server")
const { apiUsers, browserSession, captured, FIXTURES, oauthToken, request, sdk } =
	await import("~/test/api-harness")

/** The account's usage and deleting it, through /api/v1, as the iPhone app calls them. */

const users = apiUsers("api-account")
const feedUrl = `https://example.com/${randomUUID()}/feed`
afterAll(async () => {
	await users.cleanup()
	await db.delete(feeds).where(eq(feeds.url, feedUrl))
	await stopBoss()
})

const errorOf = (promise: Promise<unknown>) =>
	promise.then(
		() => {
			throw new Error("expected the call to fail")
		},
		(e: unknown) => e as KlipstackApiError,
	)

const MINUTE = 60 * 1000

/** Whether the account is still there. */
const exists = async (id: string) =>
	(await db.select({ id: user.id }).from(user).where(eq(user.id, id))).length === 1

describe("GET /usage", () => {
	it("answers where the account stands against each cap, to any client", async () => {
		const me = await users.create("Counter")
		await captured(me.id, FIXTURES.joel)
		const { month } = monthOf()
		await db.insert(usageCounts).values([
			{ userId: me.id, metric: "ai", month, count: 7 },
			{ userId: me.id, metric: "topic_sorts", month, count: 42 },
			// Last month's counts are not this month's.
			{ userId: me.id, metric: "saves", month: "2020-01-01", count: 99 },
		])
		const [feed] = await db
			.insert(feeds)
			.values({ url: feedUrl, urlHash: randomUUID() })
			.returning({ id: feeds.id })
		await db.insert(subscriptions).values({ userId: me.id, feedId: feed!.id })

		// Without AI or topics, those caps are not the account's.
		const plain = await me.client.usage()
		expect(plain.saves).toEqual({ used: 1, max: env.LIMIT_SAVES_PER_MONTH })
		expect(plain.feeds).toEqual({ used: 1, max: env.LIMIT_FEEDS })
		expect(plain.editions).toEqual({ used: 0, max: env.LIMIT_EDITIONS_PER_MONTH })
		expect(plain.storage.max).toBe(env.LIMIT_STORAGE_MB * 1024 * 1024)
		// The captured page and its extracted text, at least.
		expect(plain.storage.used).toBeGreaterThan(10_000)
		expect([plain.ai, plain.topicSorts]).toEqual([null, null])
		expect(plain.resetsAt).toBe(monthOf().resetsAt.toISOString())

		await db.insert(userFeatures).values([
			{ userId: me.id, feature: "ai" },
			{ userId: me.id, feature: "topics" },
		])
		// Offered topics, but not turned on: still no sorting.
		expect((await me.client.usage()).topicSorts).toBeNull()
		await db.insert(topicLibraries).values({ userId: me.id })
		const full = await me.client.usage()
		expect(full.ai).toEqual({ used: 7, max: env.LIMIT_AI_PER_MONTH })
		expect(full.topicSorts?.used).toBe(42)
	})
})

describe("POST /account/delete", () => {
	/** An account signed in to the iPhone app through a browser session signed in `minutesAgo`. */
	async function appUser(name: string, minutesAgo = 1) {
		const u = await users.create(name)
		const sid = await browserSession(u.id, new Date(Date.now() - minutesAgo * MINUTE))
		const token = await oauthToken(u.id, MOBILE_CLIENT_ID, undefined, { sid })
		return { ...u, sid, token, app: sdk(token) }
	}

	it("refuses API keys and other apps, whatever their sign-in", async () => {
		const me = await appUser("Keyholder")
		const byKey = await errorOf(me.client.account.delete(me.email))
		expect([byKey.status, byKey.code]).toEqual([403, "forbidden"])
		const cli = await oauthToken(me.id, CLI_CLIENT_ID, undefined, { sid: me.sid })
		const byCli = await errorOf(sdk(cli).account.delete(me.email))
		expect([byCli.status, byCli.code]).toEqual([403, "forbidden"])
		expect(await exists(me.id)).toBe(true)
	})

	it("needs the account's email typed to confirm", async () => {
		const me = await appUser("Typist")
		for (const typed of ["", "someone@example.com", `${me.email}x`]) {
			const error = await errorOf(me.app.account.delete(typed))
			expect([error.status, error.code]).toEqual([400, "invalid_request"])
			expect(error.details).toEqual({ field: "confirmEmail" })
		}
		expect(await exists(me.id)).toBe(true)
	})

	it("needs a sign-in from the last 30 minutes behind the token", async () => {
		const stale = await appUser("Stale", 31)
		const old = await errorOf(stale.app.account.delete(stale.email))
		expect([old.status, old.code]).toEqual([403, "reauthentication_required"])
		expect(await exists(stale.id)).toBe(true)

		// A token that names no sign-in, or someone else's.
		const other = await appUser("Other")
		for (const sid of [undefined, other.sid]) {
			const token = await oauthToken(stale.id, MOBILE_CLIENT_ID, undefined, { sid })
			const error = await errorOf(sdk(token).account.delete(stale.email))
			expect([error.status, error.code]).toEqual([403, "reauthentication_required"])
		}
		expect(await exists(stale.id)).toBe(true)
		expect(await exists(other.id)).toBe(true)
	})

	it("deletes the account after a recent sign-in, and its token stops working", async () => {
		const me = await appUser("Leaver", 29)
		await captured(me.id, FIXTURES.makers)
		const res = await request("/api/v1/account/delete", {
			method: "POST",
			token: me.token,
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ confirmEmail: ` ${me.email.toUpperCase()} ` }),
		})
		expect(res.status).toBe(204)
		expect(await exists(me.id)).toBe(false)
		const after = await errorOf(me.app.me())
		expect(after.status).toBe(401)
	})
})
