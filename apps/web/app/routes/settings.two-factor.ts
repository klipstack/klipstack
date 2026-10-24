import { and, db, eq, ne, session as sessions } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { data } from "react-router"
import { checkAuthLimit } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { hasFeature } from "~/lib/features.server"
import { signedInRecently } from "~/lib/recent-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, getSession, requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import { authenticatorSetup, readCode } from "~/lib/two-factor.server"
import type { Route } from "./+types/settings.two-factor"

/**
 * POST /settings/two-factor  intent=start|confirm|disable: Settings' authenticator app. The
 * plugin's own endpoints are closed (`disabledPaths`); this adds our rules around them:
 *
 * - start: accounts with the `two-factor` flag and a verified email. The password, or for an
 *   account without one a sign-in from the last 30 minutes. Answers the QR code, its key and the
 *   backup codes; nothing asks for a code yet.
 * - confirm: the app's first code turns it on, and signs every other session out.
 * - disable: a current code (or a backup code) and the password, when the account has one. A
 *   reader with neither phone nor backup codes asks the operator (`admin reset-two-factor`).
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
			if (!(await hasFeature(user.id, "two-factor"))) throw data(null, { status: 404 })
			if (!user.emailVerified) return data({ result: "unverified" as const }, { status: 403 })
			const { hasPassword } = await signInMethods(user.id)
			if (!hasPassword && !signedInRecently(current.session.createdAt))
				return data({ result: "reauthentication-required" as const }, { status: 403 })
			const started = await auth.api.enableTwoFactor({
				body: {
					method: "totp",
					...(hasPassword ? { password: String(form.get("password") ?? "") } : {}),
				},
				headers: request.headers,
			})
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
			if (renewed)
				await db
					.delete(sessions)
					.where(and(eq(sessions.userId, user.id), ne(sessions.id, renewed.session.id)))
			return data({ result: "enabled" as const }, { headers: cookieHeadersFrom(headers) })
		}

		if (intent === "disable") {
			if (!enabled) return { result: "disabled" as const }
			await checkAuthLimit("/two-factor/settings-code", user.email, request.headers)
			const { kind, code } = readCode(String(form.get("code") ?? ""))
			// This session's own account: the plugin checks the code against it, using a backup code
			// up, and makes no new session.
			if (kind === "totp") await auth.api.verifyTOTP({ body: { code }, headers: request.headers })
			else
				await auth.api.verifyBackupCode({
					body: { code, disableSession: true },
					headers: request.headers,
				})
			const { hasPassword } = await signInMethods(user.id)
			const { headers } = await auth.api.disableTwoFactor({
				body: hasPassword ? { password: String(form.get("password") ?? "") } : {},
				headers: request.headers,
				returnHeaders: true,
			})
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

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
