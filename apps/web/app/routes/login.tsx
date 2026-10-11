import { APIError } from "better-auth/api"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { ProviderButtons } from "~/components/provider-buttons"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { emailEnabled } from "~/lib/email.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { useIsNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { localeCookie } from "~/lib/i18n.server"
import {
	oauthApiContext,
	oauthRedirectUrl,
	signedOAuthQuery,
	verifySignedOAuthQuery,
} from "~/lib/oauth.server"
import { pageTitle } from "~/lib/page-title"
import {
	enabledProvider,
	enabledProviders,
	providerErrorKey,
	startProviderSignIn,
} from "~/lib/provider-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, requireAnonymous, safeRedirect } from "~/lib/session.server"
import type { Route } from "./+types/login"

const schema = z.object({
	email: z.email("auth:validation.emailInvalid"),
	password: z.string().min(1, "auth:validation.required"),
	redirectTo: z.string().optional(),
	oauthQuery: z.string().optional(),
})

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:login.title") }]
}

/** The app authorization request this login resumes, if the OAuth provider sent the user here. */
async function validOAuthQuery(query: string | null | undefined) {
	return query && (await verifySignedOAuthQuery(query)) ? query : null
}

export async function loader({ context, request }: Route.LoaderArgs) {
	// The OAuth provider sends apps' users here, signed in or not (an app may ask to log in again).
	const signed = signedOAuthQuery(new URL(request.url))
	const oauthQuery = await validOAuthQuery(signed)
	if (!oauthQuery) requireAnonymous(context)
	const redirectTo = new URL(request.url).searchParams.get("redirectTo")
	return {
		// Arriving from a verification email (routes/verify-email.ts). Only a password login keeps the
		// password: a login link would prove the mailbox alone, and remove it.
		verifying: !!redirectTo?.startsWith("/verify-email?"),
		emailLinks: emailEnabled,
		// A provider's redirect would drop the app's authorization request, as an emailed link does.
		providers: oauthQuery ? [] : enabledProviders,
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
		if ("user" in response)
			out.append("set-cookie", await localeCookie.serialize(response.user.locale))
		const next = oauthQuery ? oauthRedirectUrl(response) : null
		throw redirect(next ?? safeRedirect(parsed.data.redirectTo), { headers: out })
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

	return (
		<AuthCard title={t("login.title")}>
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
				{loaderData.emailLinks && !loaderData.oauthQuery ? (
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
					<Link to="/signup" className="text-link hover:underline">
						{t("login.signup")}
					</Link>
				</p>
			</div>
		</AuthCard>
	)
}
