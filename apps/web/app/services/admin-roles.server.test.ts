import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import {
	account as accounts,
	adminAuditEvents,
	and,
	apiKeys,
	db,
	eq,
	session,
	user,
} from "@klipstack/db"
import { afterAll, describe, expect, it, vi } from "vitest"
import { adminFixtures } from "~/test/admin-fixtures"

const audit = vi.hoisted(() => ({ fail: false }))
vi.mock("./admin-audit.server", async (original) => {
	const real = await original<typeof import("./admin-audit.server")>()
	return {
		...real,
		recordAudit: (...args: Parameters<typeof real.recordAudit>) => {
			if (audit.fail) throw new Error("audit unavailable")
			return real.recordAudit(...args)
		},
	}
})
const { changeRole } = await import("./admin-roles.server")

const fx = adminFixtures("admin-roles")
afterAll(fx.cleanup)

const roleOf = async (id: string) =>
	(await db.select({ role: user.role }).from(user).where(eq(user.id, id)))[0]!.role

describe("changeRole", () => {
	it("grants by normalized email, ends browser sessions, and records the operator CLI", async () => {
		const account = await fx.account()
		await db.insert(apiKeys).values({
			userId: account.id,
			name: "kept",
			prefix: "klip_test",
			keyHash: `hash-${account.id}`,
		} as never)
		const result = await changeRole(
			{ email: `  ${account.email.toUpperCase()} ` },
			"admin",
			"Initial operator",
		)
		expect(result).toMatchObject({ userId: account.id, role: "admin", changed: true })
		expect(result.sessionsRevoked).toBeGreaterThan(0)
		expect(await account.session()).toBeNull()
		expect(await db.select().from(session).where(eq(session.userId, account.id))).toHaveLength(0)
		expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, account.id))).toHaveLength(1)
		const events = await db
			.select()
			.from(adminAuditEvents)
			.where(eq(adminAuditEvents.targetId, account.id))
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			actorKind: "operator-cli",
			actorUserId: null,
			action: "role.grant",
			metadata: { fromRole: "user", toRole: "admin", reason: "Initial operator" },
		})
		expect(JSON.stringify(events[0])).not.toContain(account.email)
	})

	it("reports no change when repeated, and revokes the last admin if asked", async () => {
		const account = await fx.account({ role: "admin" })
		const again = await changeRole({ userId: account.id }, "admin", "again")
		expect(again).toMatchObject({ changed: false, sessionsRevoked: 0 })
		expect(await account.session()).not.toBeNull()
		const revoked = await changeRole({ userId: account.id }, "user", "Access removed")
		expect(revoked).toMatchObject({ changed: true, role: "user" })
		expect(await account.session()).toBeNull()
	})

	it("refuses unverified grants, unknown accounts and empty reasons", async () => {
		const unverified = await fx.account({ verified: false })
		await expect(changeRole({ userId: unverified.id }, "admin", "x")).rejects.toMatchObject({
			code: "verification_required",
		})
		expect(await roleOf(unverified.id)).toBe("user")
		// Admins confirm a sign-in with their password: an account without one cannot be one.
		const passwordless = await fx.account()
		await db
			.delete(accounts)
			.where(and(eq(accounts.userId, passwordless.id), eq(accounts.providerId, "credential")))
		await expect(changeRole({ userId: passwordless.id }, "admin", "x")).rejects.toMatchObject({
			code: "invalid_request",
		})
		expect(await roleOf(passwordless.id)).toBe("user")
		await expect(changeRole({ email: "nobody@example.com" }, "admin", "x")).rejects.toMatchObject({
			code: "not_found",
		})
		await expect(changeRole({ userId: unverified.id }, "user", "  ")).rejects.toMatchObject({
			code: "invalid_request",
		})
	})

	it("changes nothing when the audit event cannot be written", async () => {
		const account = await fx.account()
		audit.fail = true
		try {
			await expect(changeRole({ userId: account.id }, "admin", "x")).rejects.toThrow(
				"audit unavailable",
			)
		} finally {
			audit.fail = false
		}
		expect(await roleOf(account.id)).toBe("user")
		expect(await account.session()).not.toBeNull()
	})
})

describe("the admin CLI", () => {
	const run = (...args: string[]) =>
		promisify(execFile)("pnpm", ["exec", "tsx", "scripts/admin.ts", ...args], {
			cwd: fileURLToPath(new URL("../..", import.meta.url)),
		}).then(
			(out) => ({ code: 0, ...out }),
			(error: { code: number; stdout: string; stderr: string }) => error,
		)

	it("grants by email, and exits 2 on bad arguments", async () => {
		const account = await fx.account()
		const [granted, bad] = await Promise.all([
			run("grant", "--email", account.email, "--reason", "Initial operator"),
			run("grant", "--email", account.email, "--user-id", account.id, "--reason", "both"),
		])
		expect(bad.code).toBe(2)
		expect(granted).toMatchObject({ code: 0 })
		expect(granted.stdout).toContain(`${account.id}: role is now admin`)
		expect(await roleOf(account.id)).toBe("admin")
	}, 60_000)
})
