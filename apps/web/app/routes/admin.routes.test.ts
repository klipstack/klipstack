import { db, sql } from "@klipstack/db"
import { afterAll, describe, expect, it } from "vitest"
import { adminFixtures, statusOf, thrownBy } from "~/test/admin-fixtures"
import routes from "../routes"
import * as layout from "./admin-layout"
import * as activity from "./admin.activity"
import * as audit from "./admin.audit"
import * as invites from "./admin.invites"
import * as invitesCreate from "./admin.invites.create"
import * as invitesRevoke from "./admin.invites.revoke"
import * as jobs from "./admin.jobs"
import * as jobsRetry from "./admin.jobs.retry"
import * as overview from "./admin.overview"
import * as reauthenticate from "./admin.reauthenticate"
import * as reports from "./admin.reports"
import * as reportsDismiss from "./admin.reports.dismiss"
import * as reportsRemove from "./admin.reports.remove"
import * as reportsRestore from "./admin.reports.restore"
import * as requests from "./admin.requests"
import * as requestsApprove from "./admin.requests.approve"
import * as requestsDismiss from "./admin.requests.dismiss"
import * as system from "./admin.system"
import * as usage from "./admin.usage"
import * as userDetail from "./admin.user"
import * as userBilling from "./admin.user.billing"
import * as userFeatures from "./admin.user.features"
import * as users from "./admin.users"

const fx = adminFixtures("admin-routes")
afterAll(fx.cleanup)

type Args = { request: Request; context: never; params: never }
type Handler = (args: Args) => unknown

const loaders: Array<[string, Handler, Record<string, string>]> = [
	["/admin", layout.loader as unknown as Handler, {}],
	["/admin", overview.loader as unknown as Handler, {}],
	["/admin/invites", invites.loader as unknown as Handler, {}],
	["/admin/requests", requests.loader as unknown as Handler, {}],
	["/admin/reports", reports.loader as unknown as Handler, {}],
	["/admin/users?q=a", users.loader as unknown as Handler, {}],
	["/admin/users/%27%3B--", userDetail.loader as unknown as Handler, { id: "';--" }],
	["/admin/activity", activity.loader as unknown as Handler, {}],
	["/admin/usage?by=storage", usage.loader as unknown as Handler, {}],
	["/admin/jobs", jobs.loader as unknown as Handler, {}],
	["/admin/system", system.loader as unknown as Handler, {}],
	["/admin/audit", audit.loader as unknown as Handler, {}],
]
const actions: Array<[string, Handler, Record<string, string>, Record<string, string>]> = [
	["/admin/invites/create", invitesCreate.action as unknown as Handler, {}, { expiry: "bogus" }],
	[
		"/admin/invites/not-a-uuid/revoke",
		invitesRevoke.action as unknown as Handler,
		{ id: "not-a-uuid" },
		{},
	],
	[
		"/admin/requests/not-a-uuid/approve",
		requestsApprove.action as unknown as Handler,
		{ id: "not-a-uuid" },
		{},
	],
	[
		"/admin/requests/not-a-uuid/dismiss",
		requestsDismiss.action as unknown as Handler,
		{ id: "not-a-uuid" },
		{},
	],
	[
		"/admin/reports/not-a-uuid/remove",
		reportsRemove.action as unknown as Handler,
		{ id: "not-a-uuid" },
		{ ground: "bogus", note: "" },
	],
	[
		"/admin/reports/not-a-uuid/dismiss",
		reportsDismiss.action as unknown as Handler,
		{ id: "not-a-uuid" },
		{},
	],
	[
		"/admin/reports/not-a-uuid/restore",
		reportsRestore.action as unknown as Handler,
		{ id: "not-a-uuid" },
		{},
	],
	[
		"/admin/jobs/retry",
		jobsRetry.action as unknown as Handler,
		{},
		{ kind: "purge", documentId: "x" },
	],
	[
		"/admin/users/%27%3B--/features",
		userFeatures.action as unknown as Handler,
		{ id: "';--" },
		{ feature: "bogus", enabled: "maybe" },
	],
	[
		"/admin/users/%27%3B--/billing",
		userBilling.action as unknown as Handler,
		{ id: "';--" },
		{ freeUntil: "2027-02-30" },
	],
	[
		"/admin/reauthenticate",
		reauthenticate.action as unknown as Handler,
		{},
		{ returnTo: "//evil.example" },
	],
]

const call = (handler: Handler, request: Request, context: unknown, params: unknown) =>
	thrownBy(async () => {
		const result = await handler({ request, context: context as never, params: params as never })
		throw new Error(`expected a denial, got ${JSON.stringify(result)}`)
	})

type RouteEntry = { path?: string; file: string; children?: RouteEntry[] }
const files = (entry: RouteEntry): string[] => [
	entry.file,
	...(entry.children ?? []).flatMap(files),
]

describe("every admin route denies on its own", () => {
	it("has every loader and action registered under /admin in the tables below", async () => {
		const admin = (await (routes as unknown as Promise<RouteEntry[]>)).find(
			(entry) => entry.path === "admin",
		)
		const modules = import.meta.glob<{ loader?: Handler; action?: Handler }>(
			["./admin*.ts", "./admin*.tsx", "!./*.test.ts"],
			{ eager: true },
		)
		const registered = files(admin as RouteEntry)
		expect(registered.length).toBeGreaterThan(10)
		const denied = new Set<unknown>([...loaders, ...actions].map(([, handler]) => handler))
		for (const file of registered) {
			const mod = modules[file.replace(/^routes\//, "./")]
			expect(mod, `${file} is not an admin.* module this test can see`).toBeDefined()
			// A new route must join the tables, or this fails: no admin handler goes unchecked.
			if (mod?.action) expect(denied.has(mod.action), `${file} action is unchecked`).toBe(true)
			if (mod?.loader && !denied.has(mod.loader)) {
				// The only loaders left out are the action routes' stubs: GET reads and changes nothing.
				const stub = await Promise.resolve()
					.then(() => (mod.loader as unknown as () => { init?: { status?: number } })())
					.catch(() => null)
				expect(stub?.init?.status, `${file} loader is unchecked`).toBe(405)
			}
		}
	})

	it.each([
		["anonymous", null, 401],
		["ordinary", { role: "user", verified: true }, 403],
		["unverified admin", { role: "admin", verified: false }, 403],
	] as const)("%s callers, including malformed targets", async (_, who, status) => {
		const account = who ? await fx.account(who) : null
		const context = await fx.routerContext(account)
		for (const [path, loader, params] of loaders) {
			for (const url of [path, path.replace(/(\?|$)/, ".data$1")]) {
				const denied = await call(
					loader,
					new Request(new URL(url, "http://localhost:5180")),
					context,
					params,
				)
				// Anonymous page visits go to login; nothing else is said.
				expect(statusOf(denied)).toBe(who ? status : 302)
			}
		}
		for (const [path, action, params, fields] of actions) {
			const denied = await call(action, fx.post(path, fields), context, params)
			expect(statusOf(denied)).toBe(status)
			expect(JSON.stringify((denied as { data?: unknown }).data ?? {})).toMatch(
				/^\{"error":"(unauthenticated|forbidden)"\}$/,
			)
		}
	})

	it("changes nothing for a denied caller", async () => {
		const ordinary = await fx.account()
		const context = await fx.routerContext(ordinary)
		await call(
			invitesCreate.action as unknown as Handler,
			fx.post("/admin/invites/create", { expiry: "7d" }),
			context,
			{},
		)
		const made = await db.execute<{ n: number }>(sql`
			select (select count(*) from invites where created_by = ${ordinary.id})::int
				+ (select count(*) from admin_audit_events where actor_user_id = ${ordinary.id})::int as n`)
		expect(made.rows[0]!.n).toBe(0)
	})
})

describe("admin actions", () => {
	it("answer 400 for invalid input and 404 for a missing invite, after authorization", async () => {
		const admin = await fx.account({ role: "admin" })
		const context = (await fx.routerContext(admin)) as never
		const run = async (handler: Handler, request: Request, params = {}) => {
			const result = (await handler({ request, context, params: params as never })) as {
				init?: { status?: number }
			}
			return result.init?.status
		}
		for (const [path, action, params, fields] of actions.slice(0, 3))
			expect(await run(action, fx.post(path, fields), params)).toBe(400)
		const missing = "00000000-0000-4000-8000-000000000000"
		expect(
			await run(
				invitesRevoke.action as unknown as Handler,
				fx.post(`/admin/invites/${missing}/revoke`),
				{
					id: missing,
				},
			),
		).toBe(404)
	})

	it("sign-in-again ends the session and returns only inside /admin", async () => {
		const admin = await fx.account({ role: "admin" })
		const context = await fx.routerContext(admin)
		const request = fx.post(
			"/admin/reauthenticate",
			{ returnTo: "https://evil.example/admin" },
			{ cookie: admin.headers().get("cookie") ?? "" },
		)
		const response = (await thrownBy(() =>
			Promise.resolve(reauthenticate.action({ request, context, params: {} } as never)),
		)) as Response
		expect(response.status).toBe(302)
		expect(response.headers.get("location")).toBe("/login?redirectTo=%2Fadmin")
		expect(await admin.session()).toBeNull()
	})
})
