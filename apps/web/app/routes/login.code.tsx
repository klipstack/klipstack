import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, redirectDocument, useNavigation } from "react-router"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { type WiderFormActionHandle } from "~/hooks/use-fresh-document"
import { allowFormTargets } from "~/lib/csp.server"
import { localeCookie } from "~/lib/i18n.server"
import {
	oauthRedirectUri,
	oauthRedirectUrl,
	signedOAuthQuery,
	verifySignedOAuthQuery,
} from "~/lib/oauth.server"
import { pageTitle } from "~/lib/page-title"
import { appRedirectIn } from "~/lib/provider-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, requireAnonymous, safeRedirect } from "~/lib/session.server"
import { type CodeRefusal, completeSignIn, pendingSignInSent } from "~/lib/two-factor.server"
import type { Route } from "./+types/login.code"

/** Its forms may go on to a provider or an app: leaving it loads a fresh document. */
export const handle: WiderFormActionHandle = { widerFormAction: true }

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:twoFactor.title") }]
}

async function validOAuthQuery(query: string | null | undefined) {
	return query && (await verifySignedOAuthQuery(query)) ? query : null
}

/**
 * GET /login/code: a sign-in's second step, for an account with two-factor authentication. The
 * first step (the password, on /login) left a pending sign-in in a cookie; the address carries
 * where to go next, and an app's signed authorization request when the sign-in is part of one.
 * Without a pending sign-in there is nothing to finish: back to /login.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	const oauthQuery = await validOAuthQuery(signedOAuthQuery(url))
	if (!oauthQuery) requireAnonymous(context)
	if (!pendingSignInSent(request.headers)) throw redirect(`/login${url.search}`)
	const redirectTo = url.searchParams.get("redirectTo")
	// The code finishes a sign-in that goes on to an app: the one this page's request names, or the
	// iPhone app's request a provider's sheet carries in `redirectTo` (see the action).
	allowFormTargets(context, [oauthRedirectUri(oauthQuery), appRedirectIn(redirectTo)])
	return {
		oauthQuery,
		appQuery: oauthQuery,
		redirectTo: redirectTo ? safeRedirect(redirectTo) : null,
	}
}

export async function action({ context, request }: Route.ActionArgs) {
	const form = await readForm(request)
	const oauthQuery = await validOAuthQuery(String(form.get("oauthQuery") ?? ""))
	if (!oauthQuery) requireAnonymous(context)
	const pending = pendingSignInSent(request.headers)
	if (!pending) return data({ error: "expired" as CodeRefusal }, { status: 400 })
	const result = await completeSignIn(request, pending, String(form.get("code") ?? ""), oauthQuery)
	if ("error" in result)
		return data({ error: result.error }, { status: result.error === "limited" ? 429 : 400 })
	const out = cookieHeadersFrom(result.headers)
	if (result.locale) out.append("set-cookie", await localeCookie.serialize(result.locale))
	const next = oauthQuery ? oauthRedirectUrl(result.response) : null
	// A page load for an app's request: its callback may be on this origin (see oauth.consent).
	if (next) throw redirectDocument(next, { headers: out })
	const redirectTo = form.get("redirectTo")
	const to = safeRedirect(typeof redirectTo === "string" ? redirectTo : null)
	// A page load: an app's request from a provider's sheet goes on at the provider's endpoint, not
	// a page, and the next page gets its own policy, not this one's wider form-action.
	throw redirectDocument(to, { headers: out })
}

export default function LoginCode({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const busy = useNavigation().state !== "idle"
	const error = actionData?.error
	const over = error === "expired" || error === "limited"
	const back = loaderData.oauthQuery
		? `/login?${loaderData.oauthQuery}`
		: loaderData.redirectTo
			? `/login?redirectTo=${encodeURIComponent(loaderData.redirectTo)}`
			: "/login"
	return (
		<AuthCard title={t("twoFactor.title")} appQuery={loaderData.appQuery}>
			<p className="mb-4 text-sm text-muted-fg">{t("twoFactor.description")}</p>
			{over ? (
				<div className="flex flex-col items-start gap-3" role="alert">
					<p className="text-sm text-danger">
						{t(error === "limited" ? "twoFactor.limited" : "twoFactor.expired")}
					</p>
					<Link to={back} className="text-sm text-link hover:underline">
						{t("twoFactor.startOver")}
					</Link>
				</div>
			) : (
				<Form method="post" className="flex flex-col gap-4">
					{loaderData.redirectTo ? (
						<input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
					) : null}
					{loaderData.oauthQuery ? (
						<input type="hidden" name="oauthQuery" value={loaderData.oauthQuery} />
					) : null}
					<Field
						label={t("twoFactor.code")}
						name="code"
						autoComplete="one-time-code"
						autoCapitalize="off"
						spellCheck={false}
						required
						autoFocus
						maxLength={20}
						hint={t("twoFactor.hint")}
						error={error === "wrong-code" ? t("twoFactor.wrongCode") : undefined}
					/>
					<Button type="submit" disabled={busy}>
						{t("twoFactor.submit")}
					</Button>
				</Form>
			)}
		</AuthCard>
	)
}
