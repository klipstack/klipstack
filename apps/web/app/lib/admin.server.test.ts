import { account, and, db, eq, session, sql, user } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { AppError } from "~/lib/app-error"
import { changeRole } from "~/services/admin-roles.server"
import { adminFixtures, statusOf, thrownBy } from "~/test/admin-fixtures"
import {
	ADMIN_LIMITS,
	ADMIN_WRITE_WINDOW_MS,
	adminMutation,
	assertAdminContext,
	authorizeAdmin,
	checkAdminLimit,
	requireAdmin,
	requireAdminAction,
	safeAdminPath,
	signedInRecently,
} from "./admin.server"
import { auth } from "./auth.server"

const fx = adminFixtures("admin-auth")
afterAll(fx.cleanup)

describe("authorizeAdmin", () => {
	it("denies anonymous callers with 401 and everyone short of a verified admin with 403", async () => {
		const ordinary = await fx.account()
		const unverified = await fx.account({ role: "admin", verified: false })
		expect(statusOf(await thrownBy(() => authorizeAdmin(null)))).toBe(401)
		expect(statusOf(await thrownBy(async () => authorizeAdmin(await ordinary.session())))).toBe(403)
		expect(statusOf(await thrownBy(async () => authorizeAdmin(await unverified.session())))).toBe(
			403,
		)
	})

	it("denies an admin account without a password: there is no way to confirm its sign-in", async () => {
		const admin = await fx.account({ role: "admin" })
		await db
			.delete(account)
			.where(and(eq(account.userId, admin.id), eq(account.providerId, "credential")))
		expect(statusOf(await thrownBy(async () => authorizeAdmin(await admin.session())))).toBe(403)
	})

	it("reads the role from the database, not from the session object it was handed", async () => {
		const ordinary = await fx.account()
		const forged = await ordinary.session()
		;(forged!.user as { role: string }).role = "admin"
		expect(statusOf(await thrownBy(() => authorizeAdmin(forged)))).toBe(403)
	})

	it("admits a verified admin, and only its own contexts pass for one", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		expect(ctx.userId).toBe(admin.id)
		expect(() => assertAdminContext(ctx)).not.toThrow()
		expect(() => assertAdminContext({ ...ctx })).toThrow()
	})

	it("sends anonymous page visits to login with a path inside /admin only", async () => {
		const context = await fx.routerContext(null)
		const thrown = (await thrownBy(() =>
			requireAdmin(context, new Request("http://localhost:5180/admin/users?q=a")),
		)) as Response
		expect(thrown.status).toBe(302)
		expect(thrown.headers.get("location")).toBe(
			`/login?redirectTo=${encodeURIComponent("/admin/users?q=a")}`,
		)
	})

	it("does not accept a bearer credential: those requests never get a session", async () => {
		// session.server.ts signs every `Authorization: Bearer` request out before any route runs.
		const context = await fx.routerContext(null)
		const request = fx.post("/admin/invites/create", {}, { authorization: "Bearer klip_x" })
		expect(statusOf(await thrownBy(() => requireAdminAction(context, request)))).toBe(401)
	})
})

describe("safeAdminPath", () => {
	it.each([
		["/admin", "/admin"],
		["/admin/jobs?cursor=x", "/admin/jobs?cursor=x"],
		["/administrator", "/admin"],
		["/library", "/admin"],
		["//evil.example/admin", "/admin"],
		["https://evil.example/admin", "/admin"],
		["/admin/../settings", "/admin"],
		["/admin\\evil", "/admin"],
		[null, "/admin"],
	])("%s -> %s", (input, expected) => expect(safeAdminPath(input)).toBe(expected))
})

describe("recent sign-in", () => {
	it("refreshing a session keeps its creation time, so it measures the sign-in", async () => {
		const admin = await fx.account({ role: "admin" })
		const before = await admin.session()
		const created = new Date(before!.session.createdAt).getTime()
		// Due for renewal (past `updateAge`): the next read extends it.
		await db.execute(sql`
			update session set created_at = created_at - interval '3 days',
				updated_at = updated_at - interval '3 days', expires_at = expires_at - interval '3 days'
			where id = ${before!.session.id}`)
		const old = await db.select().from(session).where(eq(session.id, before!.session.id))
		const renewed = await auth.api.getSession({ headers: admin.headers() })
		const row = await db.select().from(session).where(eq(session.id, before!.session.id))
		expect(row[0]!.expiresAt.getTime()).toBeGreaterThan(old[0]!.expiresAt.getTime())
		expect(new Date(renewed!.session.createdAt).getTime()).toBe(created - 3 * 86_400_000)
		expect(row[0]!.createdAt.getTime()).toBe(created - 3 * 86_400_000)
		expect(signedInRecently(await authorizeAdmin(renewed))).toBe(false)
	})

	it("counts 30 minutes from the sign-in; unknown and future times deny", () => {
		const at = (ms: number) => ({ signedInAt: new Date(ms) }) as never
		const now = 1_800_000_000_000
		expect(signedInRecently(at(now - ADMIN_WRITE_WINDOW_MS), now)).toBe(true)
		expect(signedInRecently(at(now - ADMIN_WRITE_WINDOW_MS - 1), now)).toBe(false)
		expect(signedInRecently(at(now + 1), now)).toBe(false)
		expect(signedInRecently(at(Number.NaN), now)).toBe(false)
	})

	it("refuses writes from an older session, except signing in again", async () => {
		const admin = await fx.account({ role: "admin" })
		const current = await admin.session()
		await db.execute(
			sql`update session set created_at = now() - interval '31 minutes' where id = ${current!.session.id}`,
		)
		const context = await fx.routerContext(admin)
		const denied = await thrownBy(() =>
			requireAdminAction(context, fx.post("/admin/invites/create")),
		)
		expect(statusOf(denied)).toBe(403)
		expect((denied as { data: { error: string } }).data.error).toBe("reauthentication_required")
		const allowed = await requireAdminAction(
			context,
			fx.post("/admin/reauthenticate", { returnTo: "/admin/jobs" }),
			{ recentSignIn: false },
		)
		expect(allowed.form.get("returnTo")).toBe("/admin/jobs")
	})
})

describe("requireAdminAction", () => {
	it("rejects foreign and missing origins, GET, and bodies over 16 KiB", async () => {
		const admin = await fx.account({ role: "admin" })
		const context = await fx.routerContext(admin)
		const call = (request: Request) => thrownBy(() => requireAdminAction(context, request))
		const foreign = fx.post("/admin/invites/create", {}, { origin: "https://evil.example" })
		expect(statusOf(await call(foreign))).toBe(403)
		const missing = fx.post("/admin/invites/create")
		missing.headers.delete("origin")
		expect(statusOf(await call(missing))).toBe(403)
		expect(statusOf(await call(new Request("http://localhost:5180/admin/invites/create")))).toBe(
			405,
		)
		const big = fx.post("/admin/invites/create", { note: "x".repeat(17 * 1024) })
		expect(statusOf(await call(big))).toBe(413)
	})

	it("checks who is calling before anything else about the request", async () => {
		const ordinary = await fx.account()
		const context = await fx.routerContext(ordinary)
		const request = fx.post("/admin/jobs/retry", { kind: "nonsense" }, { origin: "https://x" })
		expect(statusOf(await thrownBy(() => requireAdminAction(context, request)))).toBe(403)
	})
})

describe("role revocation", () => {
	it("ends the account's sessions, so the next request is anonymous", async () => {
		const admin = await fx.account({ role: "admin" })
		expect((await authorizeAdmin(await admin.session())).userId).toBe(admin.id)
		await changeRole({ userId: admin.id }, "user", "test revoke")
		expect(await admin.session()).toBeNull()
		expect(statusOf(await thrownBy(async () => authorizeAdmin(await admin.session())))).toBe(401)
	})

	it("fails a mutation authorized before the revoke but run after it", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		await changeRole({ userId: admin.id }, "user", "test revoke")
		let ran = false
		const error = await thrownBy(() =>
			adminMutation(ctx, async () => {
				ran = true
			}),
		)
		expect(error).toBeInstanceOf(AppError)
		expect((error as AppError).status).toBe(403)
		expect(ran).toBe(false)
	})

	it("makes a concurrent revoke wait for a mutation that already holds the actor's row", async () => {
		const admin = await fx.account({ role: "admin" })
		const ctx = await authorizeAdmin(await admin.session())
		const order: string[] = []
		let inside!: () => void
		let finish!: () => void
		const entered = new Promise<void>((resolve) => {
			inside = resolve
		})
		const gate = new Promise<void>((resolve) => {
			finish = resolve
		})
		const mutation = adminMutation(ctx, async () => {
			inside()
			await gate
			order.push("mutation committed")
		})
		await entered
		const revoke = changeRole({ userId: admin.id }, "user", "test revoke").then(() =>
			order.push("revoke committed"),
		)
		// Barrier, not a sleep: go on only once PostgreSQL shows the revoke waiting on the row lock.
		let blocked = 0
		for (let i = 0; i < 200 && !blocked; i++) {
			const waiting = await db.execute<{ n: number }>(sql`
				select count(*)::int as n from pg_stat_activity
				where wait_event_type = 'Lock' and query ilike '%from "user"%for update%'`)
			blocked = waiting.rows[0]!.n
		}
		expect(blocked).toBeGreaterThan(0)
		expect(order).toEqual([])
		finish()
		await Promise.all([mutation, revoke])
		expect(order).toEqual(["mutation committed", "revoke committed"])
		const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, admin.id))
		expect(row!.role).toBe("user")
	})
})

describe("admin limits", () => {
	it("allows the hourly quota, then answers 429 with Retry-After, without counting past it", async () => {
		const admin = await fx.account({ role: "admin" })
		const hit = () =>
			db.transaction((tx) => checkAdminLimit(tx, ADMIN_LIMITS.inviteCreate, admin.id))
		for (let i = 0; i < ADMIN_LIMITS.inviteCreate.limit; i++) await hit()
		const error = (await thrownBy(hit)) as AppError
		expect(error).toBeInstanceOf(AppError)
		expect(error.status).toBe(429)
		expect(error.retryAfter).toBeGreaterThan(0)
		expect(error.retryAfter).toBeLessThanOrEqual(3600)
		// A separate namespace, and the authentication limits, are untouched.
		await db.transaction((tx) => checkAdminLimit(tx, ADMIN_LIMITS.inviteRevoke, admin.id))
	})
})

describe("the role field", () => {
	it("cannot be set by signing up or by updating the profile", async () => {
		const account = await fx.account({ signupBody: { role: "admin" } })
		const fresh = await db.select({ role: user.role }).from(user).where(eq(user.id, account.id))
		expect(fresh[0]!.role).toBe("user")
		await auth.api
			.updateUser({ headers: account.headers(), body: { name: "Renamed", role: "admin" } as never })
			.catch(() => undefined)
		const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, account.id))
		expect(row!.role).toBe("user")
	})

	it("is constrained to user or admin by the database", async () => {
		const account = await fx.account()
		await expect(
			db.execute(sql`update "user" set role = 'owner' where id = ${account.id}`),
		).rejects.toThrow()
	})
})
