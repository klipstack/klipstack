import { useTranslation } from "react-i18next"
import { data, Form, redirect, redirectDocument, useFetcher, useNavigation } from "react-router"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { VERIFY_EMAIL_MINUTES, VERIFY_TO_CONTINUE_PAGE } from "~/lib/auth-constants"
import { allowFormTargets } from "~/lib/csp.server"
import { emailEnabled } from "~/lib/email.server"
import { resumeAuthorization } from "~/lib/oauth-resume.server"
import {
	oauthClientOf,
	oauthRedirectUri,
	signedOAuthQuery,
	verifySignedOAuthQuery,
} from "~/lib/oauth.server"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import type { Route } from "./+types/oauth.verify-email"
import type { action as sendAction } from "./settings.verify-email"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:oauth.title") }]
}

/**
 * Where the OAuth provider sends a signed-in reader whose email is not verified (`postLogin` in
 * auth.server.ts): an app can't be connected before it is. The page keeps the app's request, so
 * once the emailed link is opened, Continue takes the sign-in up where it stopped. Without a
 * request, Settings has the verification.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	if (!(await oauthClientOf(url))) throw redirect("/settings/account")
	const query = signedOAuthQuery(url)
	const expired = !query || !(await verifySignedOAuthQuery(query))
	// Continue resumes the app's request, which may end at the app's redirect URI.
	if (!expired) allowFormTargets(context, [oauthRedirectUri(query)])
	return {
		appQuery: query,
		email: user.email,
		emailEnabled,
		// The request lasts minutes; past that, the app has to start again.
		expired,
		// Sign-up sent the link already; Continue came back before it was opened.
		sent: url.searchParams.has("sent"),
		pending: url.searchParams.has("pending"),
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	requireUser(context, request)
	await readForm(request)
	const here = new URL(request.url)
	const query = signedOAuthQuery(here)
	const next =
		query && (await verifySignedOAuthQuery(query))
			? await resumeAuthorization(request, query)
			: null
	if (!next) return data({ expired: true }, { status: 400 })
	// Still not verified: the provider sends the reader back here, with a fresh request. The page
	// still says the link was sent.
	const to = new URL(next, request.url)
	if (to.pathname === VERIFY_TO_CONTINUE_PAGE) {
		to.searchParams.set("pending", "1")
		if (here.searchParams.has("sent")) to.searchParams.set("sent", "1")
	}
	// A page load: the app's callback may be on this origin (see oauth.consent).
	throw redirectDocument(to.origin === here.origin ? to.pathname + to.search : next)
}

export default function OAuthVerifyEmail({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const navigation = useNavigation()
	const fetcher = useFetcher<typeof sendAction>()
	const busy = navigation.state !== "idle"
	const { email } = loaderData
	const result = fetcher.data?.result

	if (loaderData.expired || actionData?.expired)
		return (
			<AuthCard title={t("oauth.verify.title")} appQuery={loaderData.appQuery}>
				<p className="text-sm" role="alert">
					{t("oauth.invalid")}
				</p>
			</AuthCard>
		)

	return (
		<AuthCard title={t("oauth.verify.title")} appQuery={loaderData.appQuery}>
			<p className="text-sm [overflow-wrap:anywhere]">{t("oauth.verify.description", { email })}</p>
			{loaderData.sent || result === "sent" ? (
				<p className="mt-3 text-sm text-muted-fg [overflow-wrap:anywhere]" role="status">
					{t("verification.sent", { email, minutes: VERIFY_EMAIL_MINUTES })}
				</p>
			) : null}
			<p className="mt-3 text-sm text-muted-fg">{t("oauth.verify.instructions")}</p>
			{loaderData.pending && !result ? (
				<p className="mt-3 text-sm text-danger" role="alert">
					{t("oauth.verify.pending")}
				</p>
			) : null}
			{result === "failed" || result === "unavailable" || result === "limited" ? (
				<p className="mt-3 text-sm text-danger" role="alert">
					{t(`verification.${result}`, {
						minutes: fetcher.data && "minutes" in fetcher.data ? fetcher.data.minutes : 15,
					})}
				</p>
			) : null}
			<Form method="post" className="mt-5">
				<Button type="submit" disabled={busy} className="w-full">
					{t("oauth.verify.continue")}
				</Button>
			</Form>
			{loaderData.emailEnabled ? (
				<fetcher.Form method="post" action="/settings/verify-email" className="mt-2">
					<Button
						type="submit"
						variant="secondary"
						disabled={fetcher.state !== "idle"}
						className="w-full"
					>
						{t(
							fetcher.state !== "idle"
								? "verification.sending"
								: loaderData.sent || result === "sent"
									? "verification.resend"
									: "verification.send",
						)}
					</Button>
				</fetcher.Form>
			) : (
				<p className="mt-3 text-sm">{t("verification.unavailable")}</p>
			)}
		</AuthCard>
	)
}
