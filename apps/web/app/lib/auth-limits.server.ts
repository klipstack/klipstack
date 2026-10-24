import { AsyncLocalStorage } from "node:async_hooks"
import { createHmac, timingSafeEqual } from "node:crypto"
import { db, sql } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { env } from "./env.server"

const checked = new AsyncLocalStorage<boolean>()
export const withAuthLimitChecked = <T>(fn: () => Promise<T>) => checked.run(true, fn)

export function trustedAuthAddress(headers?: Headers) {
	const address = headers?.get("x-klipstack-client-ip") ?? ""
	const signature = headers?.get("x-klipstack-client-signature") ?? ""
	const expected = createHmac("sha256", env.BETTER_AUTH_SECRET).update(address).digest("hex")
	return /^[a-f0-9]{64}$/.test(signature) &&
		timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
		? address
		: "unknown"
}

export async function checkAuthLimit(path: string, email: unknown, headers?: Headers) {
	if (checked.getStore()) return
	const policies: Record<string, { account?: number; ip: number; seconds: number }> = {
		"/sign-in/email": { account: 10, ip: 60, seconds: 900 },
		"/sign-up/email": { account: 5, ip: 20, seconds: 3600 },
		"/sign-in/magic-link": { account: 3, ip: 20, seconds: 900 },
		// The iPhone app's emailed code, a day's: each code allows 3 tries, so at most 30 guesses a
		// day at 6 digits. (Ten requests for someone's address stop their codes for that day.)
		"/email-otp/send-verification-otp": { account: 10, ip: 100, seconds: 86400 },
		"/sign-in/email-otp": { account: 10, ip: 60, seconds: 900 },
		// Its Sign in with Apple, whose ID token names the account only once Apple's code is
		// exchanged: the address alone.
		"/app/sign-in/apple": { ip: 30, seconds: 900 },
		// The app's sign-up: its emailed codes as the sign-in's, a day's (with a valid invite unless
		// sign-up is open), and the sign-up itself per address typed.
		"/app/sign-up/code": { account: 10, ip: 100, seconds: 86400 },
		"/app/sign-up": { account: 10, ip: 20, seconds: 3600 },
		"/request-password-reset": { account: 3, ip: 20, seconds: 900 },
		"/send-verification-email": { account: 3, ip: 20, seconds: 900 },
		// The provider names the account only at the callback: the address alone is counted.
		"/sign-up/provider": { ip: 20, seconds: 3600 },
		"/change-password": { account: 5, ip: 20, seconds: 900 },
		// A sign-in's second step (lib/two-factor.server.ts): the pending sign-in allows 5 codes and
		// the plugin locks the account for 15 minutes after 10 wrong ones; this bounds one address
		// across accounts. The body names no account.
		"/two-factor/verify-totp": { ip: 30, seconds: 900 },
		"/two-factor/verify-backup-code": { ip: 30, seconds: 900 },
		// Codes typed in Settings, by a signed-in account (confirming the app, turning it off): the
		// plugin counts no tries there, so the account's are counted here.
		"/two-factor/settings-code": { account: 10, ip: 30, seconds: 900 },
		// Turning it on or off checks the password, when the account has one: counted as the
		// password change's.
		"/two-factor/enable": { account: 5, ip: 20, seconds: 900 },
		"/two-factor/disable": { account: 5, ip: 20, seconds: 900 },
		// The public wait list form (lib/invite-requests.server.ts), not a better-auth endpoint.
		"/request-invite": { account: 3, ip: 10, seconds: 3600 },
		// The public report form (lib/edition-reports.server.ts). Its "account" is one edition from
		// one address: a person cannot flood a page, and nobody can use up its reports for others.
		"/report-edition": { account: 3, ip: 10, seconds: 3600 },
	}
	const policy = policies[path]
	if (!policy) return
	const normalized = typeof email === "string" ? email.trim().toLowerCase() : ""
	for (const [kind, value, limit] of [
		["ip", trustedAuthAddress(headers), policy.ip],
		["account", normalized, policy.account],
	] as const) {
		// No account named (a body without one): counting "" would pool every account's tries.
		if (limit === undefined || value === "") continue
		const key = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update(`${path}:${kind}:${value}`)
			.digest("hex")
		const result = await db.execute<{ hits: number; retry: number }>(sql`
			insert into auth_limits (key, hits, reset_at) values (${key}, 1, now() + ${policy.seconds} * interval '1 second')
			on conflict (key) do update set
				hits = case when auth_limits.reset_at <= now() then 1 else least(auth_limits.hits + 1, ${limit + 1}) end,
				reset_at = case when auth_limits.reset_at <= now() then now() + ${policy.seconds} * interval '1 second' else auth_limits.reset_at end
			returning hits, greatest(1, ceil(extract(epoch from reset_at - now())))::int as retry
		`)
		const row = result.rows[0]!
		if (row.hits > limit)
			throw new APIError(
				"TOO_MANY_REQUESTS",
				{
					code: "RATE_LIMITED",
					message: "Too many attempts. Try again later.",
				},
				{ "Retry-After": String(row.retry) },
			)
	}
	await db.execute(
		sql`delete from auth_limits where key in (select key from auth_limits where reset_at < now() - interval '1 day' limit 100)`,
	)
}

export function authLimitResponse(error: unknown) {
	if (!(error instanceof APIError) || error.statusCode !== 429) return null
	return new Response("Too many attempts. Try again later.", {
		status: 429,
		headers: {
			"Retry-After": new Headers(error.headers).get("Retry-After") ?? "900",
			"Cache-Control": "no-store",
		},
	})
}
