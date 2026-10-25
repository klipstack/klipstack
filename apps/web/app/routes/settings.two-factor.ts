import { and, db, eq, ne, session as sessions } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { data } from "react-router"
import { checkAuthLimit, withAuthLimitChecked } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { signedInRecently } from "~/lib/recent-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, getSession, requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import { authenticatorSetup, readCode, twoFactorOffered } from "~/lib/two-factor.server"
import type { Route } from "./+types/settings.two-factor"

/**
 * POST /settings/two-factor  intent=start|confirm|disable|backup-codes: Settings' authenticator app. The
 * plugin's own endpoints are closed (`disabledPaths`); this adds our rules around them:
 *
 * - start: accounts it is offered to (`twoFactorOffered`: the flag, or admins) with a verified email. The password, or for an
 *   account without one a sign-in from the last 30 minutes. Answers the QR code, its key and the
 *   backup codes; nothing asks for a code yet.
 * - confirm: the app's first code turns it on, and signs every other session out.
 * - disable: a current code (or a backup code) and the password, when the account has one. A
 *   reader with neither phone nor backup codes asks the operator (`admin reset-two-factor`).
 * - backup-codes: the same proof as disable; answers 10 new backup codes, which replace the old.
 *
 * Codes typed here count against the account's limit (`/two-factor/settings-code`).
 */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const current = getSession(context)!
	const form = await readForm(request)
	const intent = form.get("intent")
	const enabled = Boolean(user.twoFactorEnabled)
	try {
		if (intent === "start") {
			if (enabled) return { result: "already-on" as const }
			if (!(await twoFactorOffered(user))) throw data(null, { status: 404 })
			if (!user.emailVerified) return data({ result: "unverified" as const }, { status: 403 })
			const { hasPassword } = await signInMethods(user.id)
			if (!hasPassword && !signedInRecently(current.session.createdAt))
				return data({ result: "reauthentication-required" as const }, { status: 403 })
			if (hasPassword) await checkAuthLimit("/two-factor/enable", user.email, request.headers)
			const started = await withAuthLimitChecked(() =>
				auth.api.enableTwoFactor({
					body: {
						method: "totp",
						...(hasPassword ? { password: String(form.get("password") ?? "") } : {}),
					},
					headers: request.headers,
				}),
			)
			if (started.method !== "totp") throw new Error("expected an authenticator app's setup")
			return {
				result: "started" as const,
				...authenticatorSetup(started.totpURI),
				backupCodes: started.backupCodes,
			}
		}

		if (intent === "confirm") {
			if (enabled) return { result: "already-on" as const }
			await checkAuthLimit("/two-factor/settings-code", user.email, request.headers)
			const { kind, code } = readCode(String(form.get("code") ?? ""))
			if (kind !== "totp") return data({ result: "wrong-code" as const }, { status: 400 })
			// The plugin replaces this session with a new one as it turns 2FA on.
			const { headers } = await auth.api.verifyTOTP({
				body: { code },
				headers: request.headers,
				returnHeaders: true,
			})
			const cookie = headers
				.getSetCookie()
				.map((pair) => pair.split(";")[0])
				.join("; ")
			const renewed = await auth.api.getSession({ headers: new Headers({ cookie }) })
			// Every other session ends; should the new one not be found, this one ends too.
			await db
				.delete(sessions)
				.where(
					renewed
						? and(eq(sessions.userId, user.id), ne(sessions.id, renewed.session.id))
						: eq(sessions.userId, user.id),
				)
			return data({ result: "enabled" as const }, { headers: cookieHeadersFrom(headers) })
		}

		if (intent === "disable" || intent === "backup-codes") {
			if (!enabled) return { result: "disabled" as const }
			await checkAuthLimit("/two-factor/settings-code", user.email, request.headers)
			const { hasPassword } = await signInMethods(user.id)
			const password = String(form.get("password") ?? "")
			// The password before the code, so a wrong one uses up no backup code.
			if (hasPassword) {
				await checkAuthLimit("/two-factor/disable", user.email, request.headers)
				if (!(await passwordMatches(user.id, password)))
					return data({ result: "wrong-password" as const }, { status: 400 })
			}
			const { kind, code } = readCode(String(form.get("code") ?? ""))
			// This session's own account: the plugin checks the code against it, using a backup code
			// up, and makes no new session.
			if (kind === "totp") await auth.api.verifyTOTP({ body: { code }, headers: request.headers })
			else
				await auth.api.verifyBackupCode({
					body: { code, disableSession: true },
					headers: request.headers,
				})
			const body = hasPassword ? { password } : {}
			if (intent === "backup-codes") {
				// New codes replace every old one, the unused ones too.
				const { backupCodes } = await withAuthLimitChecked(() =>
					auth.api.generateBackupCodes({ body, headers: request.headers }),
				)
				return { result: "new-codes" as const, backupCodes }
			}
			const { headers } = await withAuthLimitChecked(() =>
				auth.api.disableTwoFactor({ body, headers: request.headers, returnHeaders: true }),
			)
			return data({ result: "disabled" as const }, { headers: cookieHeadersFrom(headers) })
		}
	} catch (error) {
		if (!(error instanceof APIError)) throw error
		if (error.statusCode === 429) return data({ result: "limited" as const }, { status: 429 })
		const code = (error.body as { code?: string } | undefined)?.code
		if (code === "INVALID_PASSWORD")
			return data({ result: "wrong-password" as const }, { status: 400 })
		if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE")
			return data({ result: "wrong-code" as const }, { status: 400 })
		// Confirming a setup that is gone (finished elsewhere, or 2FA turned off meanwhile).
		if (code === "TOTP_NOT_ENABLED") return data({ result: "expired" as const }, { status: 409 })
		if (code === "TOTP_ALREADY_ENABLED") return { result: "already-on" as const }
		throw error
	}
	return data({ result: "failed" as const }, { status: 400 })
}

async function passwordMatches(userId: string, password: string) {
	const context = await auth.$context
	const accounts = await context.internalAdapter.findAccounts(userId)
	const hash = accounts.find((account) => account.providerId === "credential")?.password
	return Boolean(hash) && (await context.password.verify({ hash: hash!, password }))
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
