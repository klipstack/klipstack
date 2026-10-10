import { createHmac, randomUUID } from "node:crypto"
import { db, eq, inArray, invites, sql, user } from "@klipstack/db"
import { RouterContextProvider } from "react-router"
import { auth, type SessionData } from "~/lib/auth.server"
import { env } from "~/lib/env.server"
import { createInvite, signupWithInvite } from "~/lib/invites.server"
import { sessionContext } from "~/lib/session.server"

/**
 * Test accounts made through the real invite-gated signup, so their sessions are real ones. The
 * role is then set the way the operator CLI's SQL would: there is no application path to it.
 */
export function adminFixtures(tag: string) {
	const suffix = randomUUID()
	const userIds: string[] = []
	const codes: string[] = []
	const ip = `${tag}-${suffix}`
	const signed = new Headers({
		"x-klipstack-client-ip": ip,
		"x-klipstack-client-signature": createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(ip)
			.digest("hex"),
	})

	async function account({
		role = "user",
		verified = true,
		signupBody = {},
	}: {
		role?: "user" | "admin"
		verified?: boolean
		/** Extra fields a hostile client might add to the signup request. */
		signupBody?: Record<string, unknown>
	} = {}) {
		const code = await createInvite({ note: "test" })
		codes.push(code)
		const email = `${tag}-${randomUUID()}@example.com`
		const result = await signupWithInvite(code, () =>
			auth.api.signUpEmail({
				headers: signed,
				body: { name: `Test ${tag}`, email, password: "password123", ...signupBody } as never,
				returnHeaders: true,
			}),
		)
		const id = result.response.user.id
		userIds.push(id)
		await db
			.update(user)
			.set({ ...(role === "admin" ? { role } : {}), emailVerified: verified })
			.where(eq(user.id, id))
		const cookie = result.headers
			.getSetCookie()
			.map((c) => c.split(";")[0])
			.join("; ")
		const headers = () => new Headers({ cookie })
		const session = async (): Promise<SessionData | null> =>
			(await auth.api.getSession({ headers: headers() })) ?? null
		return { id, email, headers, session }
	}

	/** What the session middleware would have put in the router context. */
	async function routerContext(who: { session: () => Promise<SessionData | null> } | null) {
		const context = new RouterContextProvider()
		context.set(sessionContext, who ? await who.session() : null)
		return context
	}

	function post(path: string, fields: Record<string, string> = {}, headers: HeadersInit = {}) {
		return new Request(new URL(path, env.APP_URL), {
			method: "POST",
			headers: { origin: new URL(env.APP_URL).origin, ...headers },
			body: new URLSearchParams(fields),
		})
	}

	async function cleanup() {
		// Audit events outlive their account on purpose (the actor becomes null), so a test run
		// would leave dozens behind: remove this fixture's own, by actor, target and owner.
		await db.execute(sql`
			delete from admin_audit_events
			where actor_user_id = any(${sql.param(userIds)}::text[])
				or target_id = any(${sql.param(userIds)}::text[])
				or metadata->>'ownerId' = any(${sql.param(userIds)}::text[])
				or target_id in (
					select id::text from invites
					where code = any(${sql.param(codes)}::text[])
						or created_by = any(${sql.param(userIds)}::text[])
						or used_by = any(${sql.param(userIds)}::text[])
				)`)
		if (codes.length) await db.delete(invites).where(inArray(invites.code, codes))
		if (userIds.length) {
			await db.execute(
				sql`delete from auth_limits where key like 'admin:%' and split_part(key, ':', 3) = any(${sql.param(userIds)}::text[])`,
			)
			await db.delete(user).where(inArray(user.id, userIds))
		}
	}

	return { account, routerContext, post, cleanup, signedHeaders: signed }
}

/** The status of a thrown or returned `data()` / Response, for `expect`. */
export function statusOf(thrown: unknown): number | undefined {
	if (thrown instanceof Response) return thrown.status
	const init = (thrown as { init?: { status?: number } } | null)?.init
	return init?.status
}

export async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn()
	} catch (error) {
		return error
	}
	throw new Error("expected a throw")
}
