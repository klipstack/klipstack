import { CLI_CLIENT_ID, EXTENSION_CLIENT_ID, MOBILE_CLIENT_ID } from "@klipstack/api-contract/auth"
import { APIError } from "better-auth/api"
import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, redirectDocument, useNavigation } from "react-router"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { IDENTITY_SCOPES, identityKey, optionalScopesFor, scopeKey } from "~/lib/auth-constants"
import { auth } from "~/lib/auth.server"
import { hasGrant } from "~/lib/credential-policy.server"
import { allowFormTargets } from "~/lib/csp.server"
import { useKeyTranslation } from "~/lib/i18n-keys"
import {
	appSignInQuery,
	describeOAuthRequest,
	oauthApiContext,
	oauthRedirectUri,
	oauthRedirectUrl,
	signedOAuthQuery,
	verifySignedOAuthQuery,
} from "~/lib/oauth.server"
import { pageTitle } from "~/lib/page-title"
import { signedInRecently } from "~/lib/recent-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { getSession, requireUser, signOutHeaders } from "~/lib/session.server"
import type { Route } from "./+types/oauth.consent"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:oauth.title") }]
}

// A consent screen must never be framed: a hostile page could overlay it and steal the click.
export function headers() {
	return {
		"Content-Security-Policy": "frame-ancestors 'none'",
		"X-Frame-Options": "DENY",
		"Cache-Control": "no-store",
	}
}

/**
 * Connecting a new app needs a recent sign-in (see `consentReference`, which enforces it for every
 * endpoint). An app connected before may be allowed again from any session.
 */
async function mustSignInAgain(context: Route.LoaderArgs["context"], clientId: string) {
	const session = getSession(context)
	if (!session || signedInRecently(session.session.createdAt)) return false
	return !(await hasGrant(session.user.id, clientId))
}

/** GET /oauth/consent?client_id&scope&redirect_uri…&sig — the OAuth provider sends users here. */
export async function loader({ request, context }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	if (!user.emailVerified) throw redirect("/settings/account")
	const url = new URL(request.url)
	const oauthQuery = signedOAuthQuery(url)
	const clientId = url.searchParams.get("client_id")
	if (!oauthQuery || !clientId || !(await verifySignedOAuthQuery(oauthQuery)))
		return data({ request: null, appQuery: await appSignInQuery(url) }, { status: 400 })
	let clientName: string | null | undefined
	try {
		const client = await auth.api.getOAuthClientPublic({
			query: { client_id: clientId },
			headers: request.headers,
		})
		clientName = client.client_name
	} catch (error) {
		if (error instanceof APIError)
			return data({ request: null, appQuery: await appSignInQuery(url) }, { status: 400 })
		throw error
	}
	// Allow and Deny both end at the app's redirect URI.
	allowFormTargets(context, [oauthRedirectUri(oauthQuery)])
	return {
		request: {
			...describeOAuthRequest(url, clientName),
			oauthQuery,
			// Our own CLI and app: any local program or app can start this flow under their name, so
			// say what to check.
			firstPartyCli: clientId === CLI_CLIENT_ID,
			firstPartyMobile: clientId === MOBILE_CLIENT_ID,
			firstPartyExtension: clientId === EXTENSION_CLIENT_ID,
			optionalScopes: optionalScopesFor(clientId),
		},
		account: { name: user.name, email: user.email },
		signInAgain: await mustSignInAgain(context, clientId),
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	requireUser(context, request)
	const form = await readForm(request)
	const oauthQuery = String(form.get("oauthQuery") ?? "")
	// Another account: sign this one out and log in again, still on the app's request.
	if (form.get("intent") === "switch") {
		// Expired, the app's /login says to start again from the app.
		const appQuery = await appSignInQuery(new URL(`/login?${oauthQuery}`, request.url))
		const next = appQuery ? `/login?${appQuery}` : "/login"
		throw redirect(next, { headers: await signOutHeaders(request) })
	}
	const query = new URLSearchParams(oauthQuery)
	const clientId = query.get("client_id")
	// Optional scopes come back as checkboxes; the rest of the request is granted as asked.
	const optional = optionalScopesFor(clientId)
	const requested = (query.get("scope") ?? "").split(" ").filter(Boolean)
	const kept = new Set(form.getAll("grant").map(String))
	const granted = requested.filter((s) => !optional.includes(s) || kept.has(s))
	// Clearing every box of a request that only asked for optional scopes grants nothing: a denial.
	const accept = form.get("intent") === "allow" && (granted.length > 0 || requested.length === 0)
	// The page stayed open past the window: ask again rather than fail.
	if (accept && clientId && (await mustSignInAgain(context, clientId)))
		return data({ signInAgain: true }, { status: 403 })
	let result: unknown
	try {
		result = await auth.api.oauth2Consent({
			body: {
				accept,
				oauth_query: oauthQuery,
				...(granted.length < requested.length ? { scope: granted.join(" ") } : {}),
			},
			...oauthApiContext(request),
		})
	} catch (error) {
		if (!(error instanceof APIError)) throw error
		result = error
	}
	const next = oauthRedirectUrl(result)
	if (!next) return data({ failed: true, signInAgain: false }, { status: 400 })
	// A page load, not the router's navigation: the app's callback may be on this origin, and the
	// sign-in sheet hands it to the app only when the browser loads it.
	throw redirectDocument(next)
}

export default function OAuthConsent({ loaderData, actionData }: Route.ComponentProps) {
	const { t, i18n } = useTranslation("auth")
	const tk = useKeyTranslation()
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const req = loaderData.request

	if (!req || (actionData && "failed" in actionData)) {
		return (
			<AuthCard
				title={t("oauth.title")}
				appQuery={req?.oauthQuery ?? ("appQuery" in loaderData ? loaderData.appQuery : null)}
			>
				<p className="text-sm" role="alert">
					{t("oauth.invalid")}
				</p>
			</AuthCard>
		)
	}

	const { account } = loaderData
	const signInAgain = loaderData.signInAgain || actionData?.signInAgain
	const optional = req.optionalScopes
	// Who you are reads as one line; every other scope keeps its own.
	const identity = identityKey(req.scopes)
	const lines = identity ? req.scopes.filter((s) => !IDENTITY_SCOPES.includes(s)) : req.scopes
	const firstParty = req.firstPartyCli || req.firstPartyMobile || req.firstPartyExtension
	return (
		<AuthCard title={t("oauth.title")} appQuery={req.oauthQuery}>
			{account ? (
				<div className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">
					<div data-testid="oauth-account">
						<p className="text-xs text-muted-fg">{t("oauth.signedInAs")}</p>
						<p className="font-medium [overflow-wrap:anywhere]">{account.name}</p>
						<p className="text-muted-fg [overflow-wrap:anywhere]">{account.email}</p>
					</div>
					<Form method="post" className="mt-1">
						<input type="hidden" name="oauthQuery" value={req.oauthQuery} />
						<button
							type="submit"
							name="intent"
							value="switch"
							disabled={busy}
							className="text-link hover:underline disabled:opacity-50"
						>
							{t("oauth.switchAccount")}
						</button>
					</Form>
				</div>
			) : null}
			<p className="font-medium [overflow-wrap:anywhere]">{t("oauth.intro", { app: req.name })}</p>
			<p className="mt-2 text-sm text-muted-fg [overflow-wrap:anywhere]">
				{req.firstPartyCli ? (
					t("oauth.firstPartyCli", { command: "klip auth login" })
				) : req.firstPartyMobile ? (
					t("oauth.firstPartyMobile")
				) : req.firstPartyExtension ? (
					t("oauth.firstPartyExtension")
				) : (
					<>
						{req.clientHost ? `${t("oauth.identifiedBy", { host: req.clientHost })} ` : ""}
						{t("oauth.unverified")}
					</>
				)}
			</p>
			{req.scopes.length > 0 ? (
				<>
					<h2 className="mt-4 text-sm font-medium">{t("oauth.scopesTitle")}</h2>
					<ul className="mt-2 flex flex-col gap-1.5 text-sm">
						{identity ? (
							<li className="flex items-start gap-2">
								<Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
								<span>{tk(identity)}</span>
							</li>
						) : null}
						{lines.map((scope) => {
							const key = scopeKey(i18n, scope)
							const label = key ? tk(key) : scope
							return optional.includes(scope) ? (
								<li key={scope}>
									<label className="flex items-start gap-2">
										<input
											type="checkbox"
											name="grant"
											value={scope}
											form="oauth-consent"
											defaultChecked
											className="mt-0.5 size-4 shrink-0 accent-accent"
										/>
										<span className="[overflow-wrap:anywhere]">{label}</span>
									</label>
								</li>
							) : (
								<li key={scope} className="flex items-start gap-2">
									<Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
									<span className="[overflow-wrap:anywhere]">{label}</span>
								</li>
							)
						})}
					</ul>
					{req.scopes.some((s) => optional.includes(s)) ? (
						<p className="mt-2 text-xs text-muted-fg">{t("oauth.optionalHint")}</p>
					) : null}
				</>
			) : null}
			{/* Our own apps' redirects are fixed; the line above already says what to check. */}
			{req.redirectTarget && !firstParty ? (
				<p className="mt-4 text-sm text-muted-fg [overflow-wrap:anywhere]">
					{t("oauth.redirectsTo", { target: req.redirectTarget })}
				</p>
			) : null}
			{signInAgain ? (
				<p className="mt-4 text-sm" role="alert">
					{t("oauth.signInAgain")}
				</p>
			) : null}
			<Form method="post" id="oauth-consent" className="mt-5 flex gap-2">
				<input type="hidden" name="oauthQuery" value={req.oauthQuery} />
				{signInAgain ? (
					// Signs out and back in, still on the app's request (the "switch" flow).
					<Button type="submit" name="intent" value="switch" disabled={busy} className="flex-1">
						{t("oauth.signInAgainButton")}
					</Button>
				) : (
					<Button type="submit" name="intent" value="allow" disabled={busy} className="flex-1">
						{t("oauth.allow")}
					</Button>
				)}
				<Button
					type="submit"
					name="intent"
					value="deny"
					variant="secondary"
					disabled={busy}
					className="flex-1"
				>
					{t("oauth.deny")}
				</Button>
			</Form>
			<p className="mt-4 text-xs text-muted-fg">{t("oauth.revokeHint")}</p>
		</AuthCard>
	)
}
