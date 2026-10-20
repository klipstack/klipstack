import {
	APP_SIGN_IN_PATH,
	APPLE_PLATFORM_CLIENTS,
	type AppSignInErrorCode,
	MOBILE_CLIENT_ID,
	mobileRedirectUris,
} from "@klipstack/api-contract/auth"
import { eq, user } from "@klipstack/db"
import { APIError } from "better-auth/api"
import { createCookie, redirect } from "react-router"
import { withAuthTransaction } from "./auth-db.server"
import { checkAuthLimit } from "./auth-limits.server"
import { auth } from "./auth.server"
import { env, invitesRequired, oauth } from "./env.server"
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
 * None in the sign-in of one of our apps on Apple's platforms. A trip to a provider from its sheet
 * would leave the app's request behind, and end on the web inside the sheet. The app offers the
 * providers itself, with Sign in with Apple among them, as App Review wants (guideline 4.8).
 */
export function offeredIn<P extends string>(clientId: string | null, enabled: readonly P[]): P[] {
	return clientId !== null && APPLE_PLATFORM_CLIENTS.includes(clientId) ? [] : [...enabled]
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

/** Where the provider sign-in in the app's sheet lands when it fails. */
export const APP_SIGN_IN_ERROR_PATH = `${APP_SIGN_IN_PATH}/error`

/**
 * Where the app's sheet goes back to when a provider sign-in fails: its redirect URI and state,
 * for 10 minutes, in a signed cookie of the sheet's own (an ephemeral browser session).
 */
const pendingCookie = createCookie("klip_app_sign_in", {
	httpOnly: true,
	sameSite: "lax",
	secure: env.APP_URL.startsWith("https://"),
	path: "/",
	maxAge: 600,
	secrets: [env.BETTER_AUTH_SECRET],
})

type Pending = { redirectUri: string; state: string }

const AUTHORIZE_PARAMS = [
	"response_type",
	"client_id",
	"redirect_uri",
	"scope",
	"state",
	"code_challenge",
	"code_challenge_method",
	"resource",
]

/**
 * `GET /app/sign-in/<provider>` with the app's authorization request: straight to Google or GitHub.
 * After the provider's callback better-auth goes on to that request, now signed in, which answers
 * the app's redirect URI with the code. Only the app's own request is taken: another client, or a
 * redirect URI not the app's, is 404.
 */
export async function startAppProviderSignIn(
	request: Request,
	providerParam: string | undefined,
): Promise<Response> {
	const query = new URL(request.url).searchParams
	const pending = { redirectUri: query.get("redirect_uri") ?? "", state: query.get("state") ?? "" }
	if (query.get("client_id") !== MOBILE_CLIENT_ID || !isAppRedirect(pending.redirectUri))
		return new Response("Not found", { status: 404 })
	const provider = enabledProvider(providerParam)
	if (provider !== "google" && provider !== "github") return redirect(backToApp(pending, "failed"))
	// A sign-up from the app: its invite checked here, behind the sign-up limit, and carried in the
	// state's server context, as /signup does; the callback consumes it if it creates the account.
	const signUp = query.get("sign_up") === "1"
	let invite: string | null = null
	if (signUp) {
		await checkAuthLimit("/sign-up/provider", undefined, request.headers)
		if (invitesRequired) {
			invite = (await findUsableInvite(query.get("invite") ?? ""))?.code ?? null
			if (!invite) return redirect(backToApp(pending, "invalid_invite"))
		}
	}
	const authorize = new URLSearchParams()
	for (const key of AUTHORIZE_PARAMS) {
		const value = query.get(key)
		if (value !== null) authorize.set(key, value)
	}
	const sheet = {
		inviteCode: invite,
		app: true as const,
		...(signUp ? { appSignUp: true as const } : {}),
	}
	const { headers, response } = await withProviderSignup(sheet, () =>
		auth.api.signInSocial({
			body: {
				provider,
				callbackURL: `/api/auth/oauth2/authorize?${authorize}`,
				errorCallbackURL: APP_SIGN_IN_ERROR_PATH,
				requestSignUp: signUp,
				disableRedirect: true,
			},
			headers: request.headers,
			returnHeaders: true,
		}),
	)
	if (!response.url) throw new Error("the provider sign-in returned no URL")
	const out = cookieHeadersFrom(headers)
	out.append("set-cookie", await pendingCookie.serialize(pending))
	return redirect(response.url, { headers: out })
}

/** `GET /app/sign-in/error?error=…`: back to the app, with why. */
export async function returnAppProviderError(request: Request): Promise<Response> {
	const pending = await readPending(request)
	if (!pending) return redirect("/login")
	const code = appErrorCode(new URL(request.url).searchParams.get("error"))
	return redirect(backToApp(pending, code), {
		headers: { "set-cookie": await pendingCookie.serialize("", { maxAge: 0 }) },
	})
}

async function readPending(request: Request): Promise<Pending | null> {
	const value: unknown = await pendingCookie.parse(request.headers.get("cookie"))
	if (!value || typeof value !== "object") return null
	const { redirectUri, state } = value as Record<string, unknown>
	if (typeof redirectUri !== "string" || typeof state !== "string" || !isAppRedirect(redirectUri))
		return null
	return { redirectUri, state }
}

const isAppRedirect = (uri: string) => mobileRedirectUris(env.APP_URL).includes(uri)

function backToApp({ redirectUri, state }: Pending, error: AppSignInErrorCode): string {
	const url = new URL(redirectUri)
	url.searchParams.set("error", error)
	if (state) url.searchParams.set("state", state)
	return url.href
}

/** better-auth's callback errors (and ours), as the app's. */
function appErrorCode(error: string | null): AppSignInErrorCode {
	if (error === "INVITE_REQUIRED" || error === "signup_disabled") return "no_account"
	if (error === "account_not_linked") return "not_linked"
	if (error === "email_not_found") return "no_email"
	return "failed"
}
