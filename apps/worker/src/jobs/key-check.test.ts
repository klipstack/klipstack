import { db, inArray, keyChecks, pool, user } from "@klipstack/db"
import type { Email } from "@klipstack/email"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { handleKeyCheck, type KeyProbes, probesFromEnv } from "./key-check"

const tag = `key-check-${Date.now().toString(36)}`
const admin = { id: `${tag}-admin`, email: `${tag}-admin@example.com` }
// Neither may get the alert: an admin whose address is unverified, and a verified non-admin.
const unverifiedAdmin = { id: `${tag}-unverified`, email: `${tag}-unverified@example.com` }
const reader = { id: `${tag}-reader`, email: `${tag}-reader@example.com` }
let saved: (typeof keyChecks.$inferSelect)[] = []

// key_checks has one row per provider for the whole database: keep what was there, and put it back.
beforeAll(async () => {
	saved = await db.select().from(keyChecks)
	await db.insert(user).values([
		{
			id: admin.id,
			name: "Key admin",
			email: admin.email,
			role: "admin",
			emailVerified: true,
			locale: "es",
		},
		{ ...unverifiedAdmin, name: "Unverified admin", role: "admin", emailVerified: false },
		{ ...reader, name: "Reader", emailVerified: true },
	])
})
beforeEach(async () => {
	await db.delete(keyChecks)
})
afterAll(async () => {
	await db.delete(keyChecks)
	if (saved.length > 0) await db.insert(keyChecks).values(saved)
	await db.delete(user).where(inArray(user.id, [admin.id, unverifiedAdmin.id, reader.id]))
	await pool.end()
})

function outbox({ fails = false } = {}) {
	const sent: Email[] = []
	return {
		sent,
		mine: () => sent.filter((email) => email.to === admin.email),
		/** This file's other accounts, who must never get the alert. */
		others: () =>
			sent.filter((email) => email.to === unverifiedAdmin.email || email.to === reader.email),
		send: async (email: Email) => {
			if (fails) throw new Error("resend refused")
			sent.push(email)
		},
	}
}

const all = (result: "working" | "rejected" | "unchecked" | "unset"): KeyProbes => ({
	anthropic: async () => result,
	typesafe: async () => result,
	resend: async () => result,
	storage: async () => result,
})

const rows = async () =>
	Object.fromEntries((await db.select().from(keyChecks)).map((row) => [row.provider, row]))

describe("handleKeyCheck", () => {
	it("records every provider's result, and sends nothing while they work", async () => {
		const mail = outbox()
		await handleKeyCheck({ probes: { ...all("working"), typesafe: async () => "unset" }, ...mail })
		const saved = await rows()
		expect(saved.anthropic?.result).toBe("working")
		expect(saved.typesafe?.result).toBe("unset")
		expect(saved.storage?.checkedAt).toBeInstanceOf(Date)
		expect(mail.sent).toHaveLength(0)
	})

	it("tells the admins once when a key is rejected, naming only the rejected ones", async () => {
		const probes = { ...all("working"), anthropic: async () => "rejected" as const }
		const first = outbox()
		await handleKeyCheck({ probes, ...first })
		const [email, ...more] = first.mine()
		expect(more).toHaveLength(0)
		expect(email!.subject).toBe("Una clave de Klipstack dejó de funcionar")
		expect(email!.text).toContain("Anthropic")
		expect(email!.text).not.toContain("Resend")
		expect(email!.text).toContain("/admin/system")
		expect(first.others()).toHaveLength(0)

		// The next day it is still rejected: no second email.
		const second = outbox()
		await handleKeyCheck({ probes, ...second })
		expect(second.mine()).toHaveLength(0)
	})

	it("names the providers as a list in the admin's language", async () => {
		const mail = outbox()
		await handleKeyCheck({
			probes: {
				...all("working"),
				anthropic: async () => "rejected",
				resend: async () => "rejected",
			},
			...mail,
		})
		expect(mail.mine()[0]!.text).toContain("Anthropic y Resend (correo) rechazaron")
	})

	it("names only the newly rejected key when another was already reported", async () => {
		const anthropic = { ...all("working"), anthropic: async () => "rejected" as const }
		await handleKeyCheck({ probes: anthropic, ...outbox() })
		const next = outbox()
		await handleKeyCheck({ probes: { ...anthropic, resend: async () => "rejected" }, ...next })
		const [email] = next.mine()
		expect(email!.text).toContain("Resend")
		expect(email!.text).not.toContain("Anthropic")
	})

	it("alerts again after the key worked, or was unset, in between", async () => {
		for (const between of ["working", "unset"] as const) {
			const rejected = { ...all("working"), resend: async () => "rejected" as const }
			await handleKeyCheck({ probes: rejected, ...outbox() })
			await handleKeyCheck({ probes: { ...rejected, resend: async () => between }, ...outbox() })
			const again = outbox()
			await handleKeyCheck({ probes: rejected, ...again })
			expect(again.mine(), between).toHaveLength(1)
		}
	})

	it("does not alert, or forget an alert, when a provider can't be reached", async () => {
		const outage = outbox()
		await handleKeyCheck({ probes: all("unchecked"), ...outage })
		expect(outage.sent).toHaveLength(0)

		const rejected = { ...all("working"), storage: async () => "rejected" as const }
		await handleKeyCheck({ probes: rejected, ...outbox() })
		await handleKeyCheck({ probes: { ...rejected, storage: async () => "unchecked" }, ...outbox() })
		const back = outbox()
		await handleKeyCheck({ probes: rejected, ...back })
		expect(back.mine()).toHaveLength(0)
	})

	it("counts a probe that throws as unchecked", async () => {
		await handleKeyCheck({
			probes: {
				...all("working"),
				anthropic: async () => {
					throw new Error("socket hang up")
				},
			},
			...outbox(),
		})
		expect((await rows()).anthropic?.result).toBe("unchecked")
	})

	it("tries the email again on the next check when sending failed", async () => {
		const probes = { ...all("working"), resend: async () => "rejected" as const }
		await handleKeyCheck({ probes, ...outbox({ fails: true }) })
		expect((await rows()).resend?.alertedAt).toBeNull()
		const retry = outbox()
		await handleKeyCheck({ probes, ...retry })
		expect(retry.mine()).toHaveLength(1)
	})
})

/** A fetch that answers every request with `status` and `body`, and records the requests. */
function answering(status: number, body: unknown = {}) {
	const calls: { url: string; init?: RequestInit }[] = []
	const fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url, init })
		return new Response(JSON.stringify(body), { status })
	}) as typeof globalThis.fetch
	return { calls, fetch }
}

const env = {
	ANTHROPIC_API_KEY: "sk-ant-test",
	TYPESAFE_API_KEY: "ts-test",
	RESEND_API_KEY: "re_test",
}

describe("probesFromEnv", () => {
	it("reads the provider's answer: 200 works, 401 and 403 are rejections, the rest unclear", async () => {
		for (const provider of ["anthropic", "typesafe", "resend"] as const) {
			const probe = (status: number) => probesFromEnv(env, answering(status).fetch)[provider]()
			expect(await probe(200), provider).toBe("working")
			expect(await probe(401), provider).toBe("rejected")
			expect(await probe(403), provider).toBe("rejected")
			expect(await probe(500), provider).toBe("unchecked")
			expect(await probe(429), provider).toBe("unchecked")
		}
	})

	it("sends each key the way its provider reads it, to a request that costs nothing", async () => {
		const sent = async (provider: "anthropic" | "typesafe" | "resend") => {
			const recorded = answering(200)
			await probesFromEnv(env, recorded.fetch)[provider]()
			const [call] = recorded.calls
			expect(call!.init?.method ?? "GET").toBe("GET")
			return { url: call!.url, headers: call!.init?.headers as Record<string, string> }
		}
		const anthropic = await sent("anthropic")
		expect(anthropic.url).toBe("https://api.anthropic.com/v1/models")
		expect(anthropic.headers["x-api-key"]).toBe(env.ANTHROPIC_API_KEY)
		const typesafe = await sent("typesafe")
		expect(typesafe.url).toBe("https://api.typesafe.ai/v1/models")
		expect(typesafe.headers.authorization).toBe(`Bearer ${env.TYPESAFE_API_KEY}`)
		const resend = await sent("resend")
		expect(resend.url).toBe("https://api.resend.com/api-keys")
		expect(resend.headers.authorization).toBe(`Bearer ${env.RESEND_API_KEY}`)
	})

	it("counts a send-only Resend key as working, and Resend's invalid-key answer as rejected", async () => {
		const restricted = answering(401, { name: "restricted_api_key" })
		expect(await probesFromEnv(env, restricted.fetch).resend()).toBe("working")
		const invalid = answering(400, { name: "validation_error", message: "API key is invalid" })
		expect(await probesFromEnv(env, invalid.fetch).resend()).toBe("rejected")
		// Another 400, or a proxy's error page, says nothing about the key.
		const other = answering(400, { name: "invalid_parameter" })
		expect(await probesFromEnv(env, other.fetch).resend()).toBe("unchecked")
	})

	it("calls no one for a key that is not set", async () => {
		const quiet = answering(200)
		const probes = probesFromEnv({ STORAGE_DRIVER: "fs" }, quiet.fetch)
		for (const probe of Object.values(probes)) expect(await probe()).toBe("unset")
		expect(quiet.calls).toHaveLength(0)
	})

	it("reads a missing object with the storage key: not found works, access denied is a rejection", async () => {
		const s3 = { ...env, STORAGE_DRIVER: "s3" }
		const storage = (get: () => Promise<null>) => probesFromEnv(s3, fetch, { get }).storage()
		expect(await storage(async () => null)).toBe("working")
		const denied = Object.assign(new Error("denied"), {
			name: "InvalidAccessKeyId",
			$metadata: { httpStatusCode: 403 },
		})
		expect(
			await storage(async () => {
				throw denied
			}),
		).toBe("rejected")
		expect(
			await storage(async () => {
				throw Object.assign(new Error("down"), { $metadata: { httpStatusCode: 503 } })
			}),
		).toBe("unchecked")
	})
})
