import { account, and, db, eq } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { data, redirect } from "react-router"
import { revokeAppleSignIn } from "~/lib/apple-tokens.server"
import { checkAuthLimit, withAuthLimitChecked } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { emailEnabled } from "~/lib/email.server"
import { enabledProvider } from "~/lib/provider-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import type { Route } from "./+types/settings.sign-in"

/**
 * Settings' password and provider controls. better-auth's own endpoints for them are closed
 * (`disabledPaths`): these add the verified-account rule, the limit on password guesses and the
 * rule that the last way in stays.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const intent = form.get("intent")
	const methods = await signInMethods(user.id)

	if (intent === "unlink") {
		const provider = String(form.get("provider") ?? "")
		if (!methods.linked.includes(provider)) return { result: "unlinked" as const }
		const others =
			methods.linked.length - 1 + (methods.hasPassword ? 1 : 0) + (emailEnabled ? 1 : 0)
		if (others === 0) return data({ result: "last-method" as const }, { status: 409 })
		if (provider === "apple") await revokeAppleSignIn(user.id)
		await db
			.delete(account)
			.where(and(eq(account.userId, user.id), eq(account.providerId, provider)))
		return { result: "unlinked" as const }
	}

	// A password or a provider added to an unverified account would be a way in made before the
	// mailbox was proven: the first proof removes those (docs/security.md). Verify first.
	if (!user.emailVerified) return data({ result: "unverified" as const }, { status: 403 })

	if (intent === "link") {
		const provider = enabledProvider(form.get("provider"))
		if (!provider) return data({ result: "failed" as const }, { status: 400 })
		const { headers, response } = await auth.api.linkSocialAccount({
			body: {
				provider,
				callbackURL: "/settings/account/sign-in?connected=1",
				errorCallbackURL: "/settings/account/sign-in?connect=failed",
				disableRedirect: true,
			},
			headers: request.headers,
			returnHeaders: true,
		})
		throw redirect(response.url, { headers: cookieHeadersFrom(headers) })
	}

	if (intent === "password") {
		const newPassword = String(form.get("newPassword") ?? "")
		try {
			if (!methods.hasPassword) {
				await auth.api.setPassword({ body: { newPassword }, headers: request.headers })
				return { result: "password-set" as const }
			}
			// A stolen session must not get unlimited guesses at the current password.
			await checkAuthLimit("/change-password", user.email, request.headers)
			const { headers } = await withAuthLimitChecked(() =>
				auth.api.changePassword({
					body: {
						currentPassword: String(form.get("currentPassword") ?? ""),
						newPassword,
						revokeOtherSessions: true,
					},
					headers: request.headers,
					returnHeaders: true,
				}),
			)
			return data({ result: "password-changed" as const }, { headers: cookieHeadersFrom(headers) })
		} catch (error) {
			if (!(error instanceof APIError)) throw error
			if (error.statusCode === 429) return data({ result: "limited" as const }, { status: 429 })
			const code = (error.body as { code?: string } | undefined)?.code
			if (code === "INVALID_PASSWORD")
				return data({ result: "wrong-password" as const }, { status: 400 })
			if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG")
				return data({ result: "bad-length" as const }, { status: 400 })
			throw error
		}
	}

	return data({ result: "failed" as const }, { status: 400 })
}

export function loader() {
	return data({ error: "method_not_allowed" }, { status: 405 })
}
