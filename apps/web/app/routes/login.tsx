import { APIError } from "better-auth/api"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirectDocument, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { ProviderButtons } from "~/components/provider-buttons"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { type WiderFormActionHandle } from "~/hooks/use-fresh-document"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { allowFormTargets } from "~/lib/csp.server"
import { emailEnabled } from "~/lib/email.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { useIsNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { localeCookie } from "~/lib/i18n.server"
import {
	oauthApiContext,
	oauthClientOf,
	oauthRedirectUri,
	oauthRedirectUrl,
	signedOAuthQuery,
	verifySignedOAuthQuery,
} from "~/lib/oauth.server"
import { pageTitle } from "~/lib/page-title"
import {
	enabledProvider,
	PROVIDER_ORIGINS,
	providerErrorKey,
	providersFor,
	startProviderSignIn,
} from "~/lib/provider-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, requireAnonymous, safeRedirect } from "~/lib/session.server"
import { needsSecondStep } from "~/lib/two-factor.server"
import type { Route } from "./+types/login"

const schema = z.object({
	email: z.email("auth:validation.emailInvalid"),
	password: z.string().min(1, "auth:validation.required"),
	redirectTo: z.string().optional(),
	oauthQuery: z.string().optional(),
})

/** Its forms may go on to a provider or an app: leaving it loads a fresh document. */
export const handle: WiderFormActionHandle = { widerFormAction: true }

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:login.title") }]
}

/** The app authorization request this login resumes, if the OAuth provider sent the user here. */
async function validOAuthQuery(query: string | null | undefined) {
	return query && (await verifySignedOAuthQuery(query)) ? query : null
}

export async function loader({ context, request }: Route.LoaderArgs) {
	// The OAuth provider sends apps' users here, signed in or not (an app may ask to log in again).
	const url = new URL(request.url)
	const signed = signedOAuthQuery(url)
	const oauthQuery = await validOAuthQuery(signed)
	const app = await oauthClientOf(url)
	// An app's expired request ends here, signed in or not: the page says to start again from the
	// app, without a way into the web's own sign-in or library.
	if (!oauthQuery && !app) requireAnonymous(context)
	const redirectTo = url.searchParams.get("redirectTo")
	// A provider's button is a submit button, and signing in for an app goes on to the app.
	const providers = oauthQuery ? [] : providersFor(app)
	allowFormTargets(context, [
		...providers.map((provider) => PROVIDER_ORIGINS[provider]),
		oauthRedirectUri(oauthQuery),
	])
	return {
		// Arriving from a verification email (routes/verify-email.ts). Only a password login keeps the
		// password: a login link would prove the mailbox alone, and remove it.
		verifying: !!redirectTo?.startsWith("/verify-email?"),
		emailLinks: emailEnabled,
		// A provider's redirect would drop the app's authorization request, as an emailed link does.
		providers,
		// Still in the app's sign-in, expired or not: Sign up keeps it.
		appQuery: app ? signed : null,
		providerError: providerErrorKey(new URL(request.url).searchParams.get("error")),
		oauthQuery,
		oauthExpired: !!signed && !oauthQuery,
		passwordReset: new URL(request.url).searchParams.has("reset"),
		// Only a same-origin path survives; the action checks again before using it.
		redirectTo: redirectTo ? safeRedirect(redirectTo) : null,
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	const form = await readForm(request)
	const provider = enabledProvider(form.get("provider"))
	if (provider) {
		// Not offered while an app asks for authorization: the loader hides the buttons.
		requireAnonymous(context)
		const redirectTo = form.get("redirectTo")
		try {
			throw await startProviderSignIn(request, {
				provider,
				signup: false,
				redirectTo: typeof redirectTo === "string" ? redirectTo : null,
			})
		} catch (error) {
			const limited = authLimitResponse(error)
			if (limited) throw limited
			throw error
		}
	}
	const parsed = parseForm(form, schema)
	const oauthQuery = await validOAuthQuery(parsed.ok ? parsed.data.oauthQuery : null)
	if (!oauthQuery) requireAnonymous(context)
	if (!parsed.ok)
		return data(
			{ fieldErrors: parsed.fieldErrors, formError: null, values: parsed.values },
			{ status: 400 },
		)

	try {
		// With `oauth_query`, the OAuth provider resumes the authorization once the session exists and
		// answers with where to go next (the consent screen, or back to the app).
		const { headers, response } = await auth.api.signInEmail({
			body: {
				email: parsed.data.email,
				password: parsed.data.password,
				...(oauthQuery ? { oauth_query: oauthQuery } : {}),
			},
			...(oauthQuery ? oauthApiContext(request) : { headers: request.headers }),
			returnHeaders: true,
		})
		const out = cookieHeadersFrom(headers)
		// Two-factor authentication: no session yet, a pending sign-in the code page finishes. It
		// takes the app's request along in its address, as this page has it.
		if (needsSecondStep(response)) {
			const next = new URLSearchParams(oauthQuery ?? "")
			if (parsed.data.redirectTo) next.set("redirectTo", safeRedirect(parsed.data.redirectTo))
			// A page load, as every redirect from this page: see useFreshDocumentOnLeave.
			throw redirectDocument(`/login/code?${next}`, { headers: out })
		}
		if ("user" in response)
			out.append("set-cookie", await localeCookie.serialize(response.user.locale))
		const next = oauthQuery ? oauthRedirectUrl(response) : null
		// A page load for an app's request: its callback may be on this origin (see oauth.consent).
		if (next) throw redirectDocument(next, { headers: out })
		// A page load: the next page's policy, not this one's wider form-action (useFreshDocumentOnLeave).
		throw redirectDocument(safeRedirect(parsed.data.redirectTo), { headers: out })
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		if (error instanceof APIError) {
			return data(
				{
					fieldErrors: {} as FieldErrors,
					formError: "auth:login.invalid",
					values: { email: parsed.data.email },
				},
				{ status: 400 },
			)
		}
		throw error
	}
}

export default function Login({ actionData, loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const tk = useKeyTranslation()
	const isNsKey = useIsNsKey()
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const { redirectTo } = loaderData

	if (loaderData.oauthExpired && loaderData.appQuery)
		return (
			<AuthCard title={t("login.title")} appQuery={loaderData.appQuery}>
				<p className="text-sm text-danger" role="alert">
					{t("oauth.invalid")}
				</p>
			</AuthCard>
		)

	return (
		<AuthCard title={t("login.title")} appQuery={loaderData.appQuery}>
			{loaderData.oauthQuery ? (
				<p className="mb-4 text-sm text-muted-fg">{t("login.oauthNote")}</p>
			) : null}
			{loaderData.oauthExpired ? (
				<p className="mb-4 text-sm text-danger" role="status">
					{t("oauth.invalid")}
				</p>
			) : null}
			{loaderData.verifying ? (
				<p className="mb-4 text-sm text-muted-fg">{t("verification.loginNote")}</p>
			) : null}
			{loaderData.passwordReset ? (
				<p className="mb-4 text-sm text-muted-fg" role="status">
					{t("resetPassword.done")}
				</p>
			) : null}
			{loaderData.providerError && !actionData ? (
				<p className="mb-4 text-sm text-danger" role="alert">
					{t(loaderData.providerError)}
				</p>
			) : null}
			<Form method="post" className="flex flex-col gap-4">
				{redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
				{loaderData.oauthQuery ? (
					<input type="hidden" name="oauthQuery" value={loaderData.oauthQuery} />
				) : null}
				<Field
					label={t("email")}
					name="email"
					type="email"
					autoComplete="email"
					required
					defaultValue={actionData?.values?.email}
					error={actionData?.fieldErrors?.email}
				/>
				<Field
					label={t("password")}
					name="password"
					type="password"
					autoComplete="current-password"
					required
					error={actionData?.fieldErrors?.password}
				/>
				{actionData?.formError ? (
					<p className="text-sm text-danger" role="alert">
						{isNsKey(actionData.formError) ? tk(actionData.formError) : actionData.formError}
					</p>
				) : null}
				<Button type="submit" disabled={busy}>
					{t("login.submit")}
				</Button>
				<ProviderButtons providers={loaderData.providers} disabled={busy} />
			</Form>
			<div className="mt-6 flex flex-col gap-2 text-sm text-muted-fg">
				{/* An emailed link opens in a new tab and would drop the app's authorization request. */}
				{loaderData.emailLinks && !loaderData.appQuery ? (
					<>
						<Link to="/forgot-password" className="text-link hover:underline">
							{t("login.forgotPassword")}
						</Link>
						{loaderData.verifying ? null : (
							<Link
								to={
									redirectTo
										? `/magic-link?redirectTo=${encodeURIComponent(redirectTo)}`
										: "/magic-link"
								}
								className="text-link hover:underline"
							>
								{t("login.withMagicLink")}
							</Link>
						)}
					</>
				) : null}
				<p>
					{t("login.noAccount")}{" "}
					<Link
						to={loaderData.appQuery ? `/signup?${loaderData.appQuery}` : "/signup"}
						className="text-link hover:underline"
					>
						{t("login.signup")}
					</Link>
				</p>
			</div>
		</AuthCard>
	)
}
