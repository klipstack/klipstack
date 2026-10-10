import { randomUUID } from "node:crypto"
import { db, eq, sql, type Tx, user } from "@klipstack/db"
import { errorLabel } from "@klipstack/log"
import { data, type RouterContextProvider, redirect } from "react-router"
import type { AuditActor } from "~/services/admin-audit.server"
import { AppError, rateLimited } from "./app-error"
import type { SessionData } from "./auth.server"
import { env } from "./env.server"
import { RECENT_SIGN_IN_MS, signedInRecently as signedInWithin } from "./recent-sign-in.server"
import { boundedRequest } from "./request-body.server"
import { getSession, safeRedirect } from "./session.server"

/** Admin writes need a sign-in (not a session refresh) this recent. */
export const ADMIN_WRITE_WINDOW_MS = RECENT_SIGN_IN_MS
/** Admin forms are a few short fields. */
export const ADMIN_BODY_LIMIT = 16 * 1024
export const ADMIN_PAGE_SIZE = 50

const NO_STORE = { "Cache-Control": "private, no-store" }
const issued = new WeakSet<object>()

/**
 * Proof that this request came from a verified admin's browser session, checked against the
 * database. Only `authorizeAdmin` makes one: admin services take it instead of a user ID or role,
 * so no caller-supplied value can stand in for the check.
 */
export interface AdminContext {
	readonly userId: string
	readonly sessionId: string
	/** When the person signed in. Better Auth keeps it through session refreshes (tested). */
	readonly signedInAt: Date
	readonly correlationId: string
}

export function assertAdminContext(ctx: AdminContext): void {
	if (!issued.has(ctx)) throw new Error("admin context was not issued by authorizeAdmin")
}

export const auditActor = (ctx: AdminContext): AuditActor => ({ kind: "user", userId: ctx.userId })

function deny(status: number, error: string, fields: Record<string, unknown> = {}): never {
	// An operational log line, never an audit event: nothing changed.
	console.warn(`[admin] denied: ${error}`, fields)
	throw data({ error }, { status, headers: NO_STORE })
}

/** A verified admin account, by the fields the session carries. Used only to show the menu link. */
export function looksLikeAdmin(sessionUser: SessionData["user"] | null | undefined): boolean {
	return sessionUser?.role === "admin" && sessionUser.emailVerified === true
}

/**
 * The policy every admin loader, action and resource route runs first: a browser session (bearer
 * credentials never produce one), then the role and the verified email as the database has them
 * now. Anonymous callers get 401, everyone else without both gets 403. A database error denies.
 */
export async function authorizeAdmin(session: SessionData | null): Promise<AdminContext> {
	const correlationId = randomUUID()
	if (!session) deny(401, "unauthenticated", { correlationId })
	let row: { role: string; emailVerified: boolean } | undefined
	try {
		;[row] = await db
			.select({ role: user.role, emailVerified: user.emailVerified })
			.from(user)
			.where(eq(user.id, session.user.id))
	} catch (error) {
		console.error(`[admin] authorization check failed: ${errorLabel(error)}`, { correlationId })
		throw data({ error: "unavailable" }, { status: 503, headers: NO_STORE })
	}
	if (row?.role !== "admin" || !row.emailVerified)
		deny(403, "forbidden", { userId: session.user.id, correlationId })
	const ctx: AdminContext = Object.freeze({
		userId: session.user.id,
		sessionId: session.session.id,
		signedInAt: new Date(session.session.createdAt),
		correlationId,
	})
	issued.add(ctx)
	return ctx
}

/** For page loaders: an anonymous visit goes to login and comes back; the rest as above. */
export async function requireAdmin(
	context: Readonly<RouterContextProvider>,
	request: Request,
): Promise<AdminContext> {
	const session = getSession(context)
	if (!session) {
		const url = new URL(request.url)
		const back = safeAdminPath(url.pathname.replace(/\.data$/, "") + url.search)
		throw redirect(`/login?redirectTo=${encodeURIComponent(back)}`, { headers: NO_STORE })
	}
	return authorizeAdmin(session)
}

/** Only paths inside /admin may be a return destination of the admin sign-in flow. */
export function safeAdminPath(to: string | null | undefined): string {
	const safe = safeRedirect(to, "/admin")
	return /^\/admin(?:[/?#]|$)/.test(safe) && !safe.includes("..") ? safe : "/admin"
}

/** Browsers send Origin on every POST. A missing or foreign one is not our form. */
export function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin")
	return !!origin && origin === new URL(env.APP_URL).origin
}

export function signedInRecently(ctx: AdminContext, now = Date.now()): boolean {
	return signedInWithin(ctx.signedInAt, now)
}

/**
 * For admin actions. In order: authorization (401/403), POST only, same origin, a sign-in within
 * the write window (`recentSignIn: false` only for the sign-in-again action), then the bounded form.
 * Nothing about the target is read before this returns.
 */
export async function requireAdminAction(
	context: Readonly<RouterContextProvider>,
	request: Request,
	{ recentSignIn = true }: { recentSignIn?: boolean } = {},
): Promise<{ ctx: AdminContext; form: FormData }> {
	const ctx = await authorizeAdmin(getSession(context))
	const fields = { userId: ctx.userId, correlationId: ctx.correlationId }
	if (request.method !== "POST") deny(405, "method_not_allowed", fields)
	if (!sameOrigin(request)) deny(403, "bad_origin", fields)
	if (recentSignIn && !signedInRecently(ctx)) deny(403, "reauthentication_required", fields)
	let form: FormData
	try {
		form = await (await boundedRequest(request, ADMIN_BODY_LIMIT, `admin:${ctx.userId}`)).formData()
	} catch (error) {
		if (error instanceof Response) throw error
		deny(400, "invalid", fields)
	}
	return { ctx, form }
}

/**
 * An admin service's refusal (an `AppError`, as every change's) as the route answers it, never
 * cached. Null for anything else.
 */
export function adminErrorResponse(error: unknown) {
	if (!(error instanceof AppError)) return null
	return data(
		{ ok: false as const, error: error.body },
		{
			status: error.status,
			headers: {
				...NO_STORE,
				...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
			},
		},
	)
}

/** A refusal a route makes itself (a form it cannot read), in the same shape. */
export const adminRefusal = (code: "invalid_request", message: string) =>
	adminErrorResponse(new AppError(code, message))!

/**
 * Runs an admin change in one transaction that first locks the actor's row (FOR SHARE) and checks
 * the role again. The CLI's revoke updates that row: whichever takes the lock first goes first. A
 * change that committed before the revoke stands; one authorized after it fails here.
 */
export function adminMutation<T>(ctx: AdminContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
	assertAdminContext(ctx)
	return db.transaction(async (tx) => {
		const [actor] = await tx
			.select({ role: user.role, emailVerified: user.emailVerified })
			.from(user)
			.where(eq(user.id, ctx.userId))
			.for("share")
		if (actor?.role !== "admin" || !actor.emailVerified) {
			console.warn("[admin] denied: role changed before the mutation", {
				userId: ctx.userId,
				correlationId: ctx.correlationId,
			})
			throw new AppError("forbidden", "Only administrators can do that.")
		}
		return fn(tx)
	})
}

export const ADMIN_LIMITS = {
	inviteCreate: { namespace: "admin:invite-create", limit: 20 },
	inviteRevoke: { namespace: "admin:invite-revoke", limit: 60 },
	requestDismiss: { namespace: "admin:request-dismiss", limit: 120 },
	retry: { namespace: "admin:retry", limit: 30 },
	retryGlobal: { namespace: "admin:retry-global", limit: 60 },
	reportDecide: { namespace: "admin:report-decide", limit: 120 },
	editionRestore: { namespace: "admin:edition-restore", limit: 60 },
} as const

/**
 * Hourly fixed-window counters in `auth_limits`, under `admin:` keys (the authentication limits
 * keep their own). Counted inside the change's transaction: only changes that commit use quota.
 */
export async function checkAdminLimit(
	tx: Tx,
	{ namespace, limit }: { namespace: string; limit: number },
	subject: string,
): Promise<void> {
	const key = `${namespace}:${subject}`
	const result = await tx.execute<{ hits: number; retry: number }>(sql`
		insert into auth_limits (key, hits, reset_at) values (${key}, 1, now() + interval '1 hour')
		on conflict (key) do update set
			hits = case when auth_limits.reset_at <= now() then 1 else least(auth_limits.hits + 1, ${limit + 1}) end,
			reset_at = case when auth_limits.reset_at <= now() then now() + interval '1 hour' else auth_limits.reset_at end
		returning hits, greatest(1, ceil(extract(epoch from reset_at - now())))::int as retry
	`)
	const row = result.rows[0]
	if (!row || row.hits > limit) throw rateLimited(row?.retry ?? 3600, "changes of this kind")
}
