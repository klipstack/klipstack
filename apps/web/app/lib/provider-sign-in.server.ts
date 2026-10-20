import { APPLE_PLATFORM_CLIENTS } from "@klipstack/api-contract/auth"
import { eq, user } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { redirect } from "react-router"
import { withAuthTransaction } from "./auth-db.server"
import { checkAuthLimit } from "./auth-limits.server"
import { auth } from "./auth.server"
import { invitesRequired, oauth } from "./env.server"
import { consumeInvite, findUsableInvite } from "./invites.server"
import { cookieHeadersFrom, safeRedirect } from "./session.server"
import {
	type ProviderCallback,
	withProviderCallback,
	withProviderSignup,
} from "./signup-gate.server"

export const PROVIDERS = ["apple", "google", "github"] as const
export type Provider = (typeof PROVIDERS)[number]

/** The providers with credentials in the environment, in display order. */
export const enabledProviders: Provider[] = PROVIDERS.filter((provider) => oauth[provider])

/**
 * The providers to offer on a page of this app's sign-in (`clientId`: the app's authorization
 * request the page is part of; null on the web).
 */
export function providersFor(clientId: string | null): Provider[] {
	return offeredIn(clientId, enabledProviders)
}

/**
 * In the sign-in of one of our apps on Apple's platforms, App Review wants Sign in with Apple
 * wherever another company's sign-in is offered (guideline 4.8): none without Apple among them.
 */
export function offeredIn<P extends string>(clientId: string | null, enabled: readonly P[]): P[] {
	const apple = clientId !== null && APPLE_PLATFORM_CLIENTS.includes(clientId)
	return apple && !enabled.some((p) => p === "apple") ? [] : [...enabled]
}

export function enabledProvider(value: unknown): Provider | null {
	return enabledProviders.find((provider) => provider === value) ?? null
}

/**
 * The message for an `error` a provider sign-in came back with (better-auth's callback codes, or
 * ours). Null without one.
 */
export function providerErrorKey(code: string | null) {
	if (!code) return null
	if (code === "INVITE_REQUIRED" || code === "signup_disabled")
		return "providers.errors.inviteRequired" as const
	if (code === "account_not_linked") return "providers.errors.notLinked" as const
	if (code === "email_not_found") return "providers.errors.noEmail" as const
	return "providers.errors.failed" as const
}

/** Thrown by `startProviderSignIn` for /signup to show on its invite field. */
export class InvalidInviteError extends Error {}

/**
 * Answers with the redirect to the provider. A sign-up checks its invite first, behind the sign-up
 * limit, and sends it along in the state's server context; the callback consumes it. A login
 * carries none: in invite mode it can only reach an account that exists.
 */
export async function startProviderSignIn(
	request: Request,
	{
		provider,
		signup,
		inviteCode,
		redirectTo,
	}: { provider: Provider; signup: boolean; inviteCode?: string; redirectTo?: string | null },
): Promise<Response> {
	let invite: string | null = null
	if (signup) {
		await checkAuthLimit("/sign-up/provider", undefined, request.headers)
		if (invitesRequired) {
			invite = (await findUsableInvite(inviteCode ?? ""))?.code ?? null
			if (!invite) throw new InvalidInviteError()
		}
	}
	const { headers, response } = await withProviderSignup({ inviteCode: invite }, () =>
		auth.api.signInSocial({
			body: {
				provider,
				callbackURL: safeRedirect(redirectTo),
				errorCallbackURL: signup ? "/signup" : "/login",
				requestSignUp: signup,
				disableRedirect: true,
			},
			headers: request.headers,
			returnHeaders: true,
		}),
	)
	if (!response.url) throw new Error("the provider sign-in returned no URL")
	return redirect(response.url, { headers: cookieHeadersFrom(headers) })
}

/**
 * The provider's redirect back to us (/api/auth/callback/:provider). One transaction holds the
 * invite lock taken when the user is created, the user, its session and the invite's consumption:
 * a sign-up never commits without its invite.
 */
export async function handleProviderCallback(request: Request): Promise<Response> {
	const scope: ProviderCallback = {}
	try {
		return await withAuthTransaction(async (tx) => {
			const response = await withProviderCallback(scope, () => auth.handler(request))
			if (scope.inviteCode && scope.email) {
				const [created] = await tx
					.select({ id: user.id })
					.from(user)
					.where(eq(user.email, scope.email.toLowerCase()))
				if (created) await consumeInvite(scope.inviteCode, created.id, tx)
			}
			return response
		})
	} catch (error) {
		if (error instanceof APIError && error.body?.code === "INVITE_REQUIRED")
			return redirect("/signup?error=INVITE_REQUIRED")
		throw error
	}
}
