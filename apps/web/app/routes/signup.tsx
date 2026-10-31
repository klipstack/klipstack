import { errorLabel } from "@klipstack/log"
import { APIError } from "better-auth/api"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirectDocument, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { ProviderButtons } from "~/components/provider-buttons"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { type WiderFormActionHandle } from "~/hooks/use-fresh-document"
import {
	MAGIC_LINK_MINUTES,
	MIN_PASSWORD_LENGTH as MIN_PASSWORD,
	VERIFY_TO_CONTINUE_PAGE,
} from "~/lib/auth-constants"
import { authLimitResponse, checkAuthLimit, withAuthLimitChecked } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { allowFormTargets } from "~/lib/csp.server"
import { requestEmailVerification } from "~/lib/email-verification.server"
import { emailEnabled } from "~/lib/email.server"
import { env, invitesRequired } from "~/lib/env.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { useIsNsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { getLocale, localeCookie } from "~/lib/i18n.server"
import { findUsableInvite, signupWithInvite } from "~/lib/invites.server"
import { requestSignupLink } from "~/lib/magic-link.server"
import { resumeAuthorization } from "~/lib/oauth-resume.server"
import {
	appSignInQuery,
	oauthClientOf,
	oauthRedirectUri,
	verifySignedOAuthQuery,
} from "~/lib/oauth.server"
import { pageTitle } from "~/lib/page-title"
import {
	enabledProvider,
	InvalidInviteError,
	type Provider,
	PROVIDER_ORIGINS,
	providerErrorKey,
	providersFor,
	startProviderSignIn,
} from "~/lib/provider-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import {
	cookieHeadersFrom,
	getSession,
	requireAnonymous,
	SIGNED_IN_HOME,
} from "~/lib/session.server"
import { withSignupAllowed } from "~/lib/signup-gate.server"
import type { Route } from "./+types/signup"

const schema = z.object({
	name: z.string().trim().min(1, "auth:validation.required").max(100),
	email: z.email("auth:validation.emailInvalid"),
	// Empty where email works: the account is created from an emailed link instead.
	password: z
		.union([z.literal(""), z.string().min(MIN_PASSWORD, "auth:signup.passwordTooShort")])
		.optional(),
	inviteCode: z.string().trim().optional(),
	oauthQuery: z.string().optional(),
})

/** Its forms may go on to a provider or an app: leaving it loads a fresh document. */
export const handle: WiderFormActionHandle = { widerFormAction: true }

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:signup.title") }]
}

/** The app authorization request this sign-up continues, if it is intact and unexpired. */
async function validOAuthQuery(query: string | null | undefined) {
	return query && (await verifySignedOAuthQuery(query)) ? query : null
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const url = new URL(request.url)
	// Sign up from an app's sign-in (/login's link keeps its signed authorization request).
	const app = await oauthClientOf(url)
	const appQuery = await appSignInQuery(url)
	const oauthQuery = await validOAuthQuery(appQuery)
	// Signed in already, the app's sign-in goes on with that account (or another, from /login).
	// Expired, /login says to start again from the app.
	if (appQuery && (!oauthQuery || getSession(context))) throw redirectDocument(`/login?${appQuery}`)
	requireAnonymous(context)
	// A provider's button is a submit button, and signing up for an app goes on to the app.
	const providers = providersFor(app)
	allowFormTargets(context, [
		...providers.map((provider) => PROVIDER_ORIGINS[provider]),
		oauthRedirectUri(oauthQuery),
	])
	return {
		inviteRequired: invitesRequired,
		waitlist: env.SIGNUP_MODE === "waitlist",
		// The invite email links here with its code.
		invite: url.searchParams.get("invite")?.slice(0, 32) ?? "",
		// An emailed sign-up link opens in the mail app's browser, outside an app's sign-in sheet,
		// which would never hear back: there, the account needs a password.
		linkSignup: emailEnabled && !app,
		providers,
		appQuery,
		oauthQuery,
		providerError: providerErrorKey(url.searchParams.get("error")),
	}
}

export async function action({ request, context }: Route.ActionArgs) {
	requireAnonymous(context)
	const form = await readForm(request)
	const provider = enabledProvider(form.get("provider"))
	if (provider) return withProvider(request, provider, String(form.get("inviteCode") ?? ""))
	const parsed = parseForm(form, schema)
	if (!parsed.ok)
		return data(
			{ fieldErrors: parsed.fieldErrors, formError: null, values: parsed.values },
			{ status: 400 },
		)
	const { name, email, password, inviteCode } = parsed.data
	const values = { name, email, inviteCode: inviteCode ?? "" }
	const oauthQuery = await validOAuthQuery(parsed.data.oauthQuery)
	// In an app's sign-in, expired or not: the reader stays in it.
	const appQuery = await appSignInQuery(
		new URL(`/signup?${parsed.data.oauthQuery ?? ""}`, request.url),
	)

	const locale = getLocale(context)
	if (!password) {
		if (!emailEnabled || appQuery)
			return data(
				{
					fieldErrors: { password: "auth:validation.required" } as FieldErrors,
					formError: null,
					values,
				},
				{ status: 400 },
			)
		return requestLink({ name, email, inviteCode, locale }, request.headers, values)
	}
	try {
		await checkAuthLimit("/sign-up/email", email, request.headers)
		const create = () =>
			withAuthLimitChecked(() =>
				auth.api.signUpEmail({
					body: { name, email, password, locale },
					headers: request.headers,
					returnHeaders: true,
				}),
			)
		const { headers } = await (invitesRequired
			? signupWithInvite(inviteCode, create)
			: withSignupAllowed(create))
		const out = cookieHeadersFrom(headers)
		out.append("set-cookie", await localeCookie.serialize(locale))
		const next = oauthQuery ? await continueInApp(request, oauthQuery, email, out) : null
		// A page load for an app's request: its callback may be on this origin (see oauth.consent).
		if (next) throw redirectDocument(next, { headers: out })
		// The request expired while the form was filled in: /login says to start again from the app.
		// A page load: the next page's policy, not this one's wider form-action.
		throw redirectDocument(appQuery ? `/login?${appQuery}` : SIGNED_IN_HOME, { headers: out })
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		if (error instanceof APIError) {
			const code = (error.body as { code?: string } | undefined)?.code
			if (code === "INVITE_REQUIRED")
				return data(
					{
						fieldErrors: { inviteCode: "auth:signup.invalidInvite" } as FieldErrors,
						formError: null,
						values,
					},
					{ status: 400 },
				)
			if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
				return data(
					{
						fieldErrors: { email: "auth:signup.emailTaken" } as FieldErrors,
						formError: null,
						values,
					},
					{ status: 400 },
				)
			}
			if (code === "PASSWORD_TOO_SHORT") {
				return data(
					{
						fieldErrors: { password: "auth:signup.passwordTooShort" } as FieldErrors,
						formError: null,
						values,
					},
					{ status: 400 },
				)
			}
			return data(
				{ fieldErrors: {} as FieldErrors, formError: error.message, values },
				{ status: 400 },
			)
		}
		throw error
	}
}

/**
 * Takes the app's authorization request up again with the new account: the consent screen, or,
 * with the email not verified yet, the page that waits for it. That page gets the link sent now.
 */
async function continueInApp(request: Request, oauthQuery: string, email: string, out: Headers) {
	const cookie = out
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ")
	const next = await resumeAuthorization(request, oauthQuery, cookie)
	if (!next || !emailEnabled) return next
	const to = new URL(next, request.url)
	if (to.pathname !== VERIFY_TO_CONTINUE_PAGE) return next
	try {
		await requestEmailVerification(
			email,
			new Headers({ ...Object.fromEntries(request.headers), cookie }),
		)
		to.searchParams.set("sent", "1")
	} catch (error) {
		// The page offers to send it again.
		console.warn(`[signup] verification email failed: ${errorLabel(error)}`)
	}
	return to.pathname + to.search
}

/** Sign-up with Google or GitHub: only the invite matters here, the provider supplies the rest. */
async function withProvider(request: Request, provider: Provider, inviteCode: string) {
	try {
		throw await startProviderSignIn(request, { provider, signup: true, inviteCode })
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		if (error instanceof InvalidInviteError)
			return data(
				{
					fieldErrors: { inviteCode: "auth:signup.invalidInvite" } as FieldErrors,
					formError: null,
					values: { name: "", email: "", inviteCode },
				},
				{ status: 400 },
			)
		throw error
	}
}

/** Sign-up without a password: the account is created when the emailed link is confirmed. */
async function requestLink(
	{
		name,
		email,
		inviteCode,
		locale,
	}: { name: string; email: string; inviteCode: string | undefined; locale: string },
	headers: Headers,
	values: { name: string; email: string; inviteCode: string },
) {
	try {
		// Before the invite check: the limit also bounds guesses at invite codes.
		await checkAuthLimit("/sign-up/email", email, headers)
		const invite = invitesRequired ? await findUsableInvite(inviteCode ?? "") : null
		if (invitesRequired && !invite)
			return data(
				{
					fieldErrors: { inviteCode: "auth:signup.invalidInvite" } as FieldErrors,
					formError: null,
					values,
				},
				{ status: 400 },
			)
		await requestSignupLink({ name, email, inviteCode: invite?.code ?? null, locale }, headers)
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		// An address with an account gets a login link by the same path: this failure tells nothing
		// about it. The error may name the address: log its kind only.
		console.warn(`[signup] link request failed: ${errorLabel(error)}`)
		return data(
			{ fieldErrors: {} as FieldErrors, formError: "auth:signupLink.failed", values },
			{ status: 502 },
		)
	}
	return { sent: true as const, email }
}

export default function Signup({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const tk = useKeyTranslation()
	const isNsKey = useIsNsKey()
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"

	if (actionData && "sent" in actionData) {
		return (
			<AuthCard title={t("signupLink.sentTitle")}>
				<p className="text-sm text-muted-fg">
					{t("signupLink.sentDescription", {
						email: actionData.email,
						minutes: MAGIC_LINK_MINUTES,
					})}
				</p>
				<Link to="/login" className="mt-6 inline-block text-sm text-link hover:underline">
					{t("magicLink.backToLogin")}
				</Link>
			</AuthCard>
		)
	}

	return (
		<AuthCard title={t("signup.title")} appQuery={loaderData.appQuery}>
			{loaderData.providerError && !actionData ? (
				<p className="mb-4 text-sm text-danger" role="alert">
					{t(loaderData.providerError)}
				</p>
			) : null}
			<Form method="post" className="flex flex-col gap-4">
				{loaderData.oauthQuery ? (
					<input type="hidden" name="oauthQuery" value={loaderData.oauthQuery} />
				) : null}
				{loaderData.inviteRequired ? (
					<>
						<p className="text-sm text-muted-fg">{t("signup.inviteRequired")}</p>
						<Field
							label={t("inviteCode")}
							name="inviteCode"
							autoComplete="off"
							required
							defaultValue={actionData?.values?.inviteCode ?? loaderData.invite}
							error={actionData?.fieldErrors?.inviteCode}
						/>
						{loaderData.waitlist ? (
							<p className="-mt-2 text-sm text-muted-fg">
								{t("signup.noCode")}{" "}
								<Link
									to={
										loaderData.appQuery
											? `/request-invite?${loaderData.appQuery}`
											: "/request-invite"
									}
									className="text-link hover:underline"
								>
									{t("signup.requestInvite")}
								</Link>
							</p>
						) : null}
					</>
				) : null}
				<Field
					label={t("name")}
					name="name"
					autoComplete="name"
					required
					defaultValue={actionData?.values?.name}
					error={actionData?.fieldErrors?.name}
				/>
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
					autoComplete="new-password"
					required={!loaderData.linkSignup}
					minLength={MIN_PASSWORD}
					hint={loaderData.linkSignup ? t("signupLink.passwordHint") : undefined}
					error={
						actionData?.fieldErrors?.password === "auth:validation.required"
							? actionData.fieldErrors.password
							: actionData?.fieldErrors?.password
								? t("signup.passwordTooShort", { min: MIN_PASSWORD })
								: undefined
					}
				/>
				{actionData?.formError ? (
					<p className="text-sm text-danger" role="alert">
						{isNsKey(actionData.formError) ? tk(actionData.formError) : actionData.formError}
					</p>
				) : null}
				<Button type="submit" disabled={busy}>
					{t("signup.submit")}
				</Button>
				<ProviderButtons providers={loaderData.providers} disabled={busy} />
				<p className="text-xs text-muted-fg">
					{t("signup.agree")}{" "}
					<Link
						to={loaderData.appQuery ? `/terms?${loaderData.appQuery}` : "/terms"}
						className="text-link hover:underline"
					>
						{t("signup.terms")}
					</Link>{" "}
					{t("signup.and")}{" "}
					<Link
						to={loaderData.appQuery ? `/privacy?${loaderData.appQuery}` : "/privacy"}
						className="text-link hover:underline"
					>
						{t("signup.privacy")}
					</Link>
					.
				</p>
			</Form>
			<p className="mt-6 text-sm text-muted-fg">
				{t("signup.haveAccount")}{" "}
				<Link
					to={loaderData.appQuery ? `/login?${loaderData.appQuery}` : "/login"}
					className="text-link hover:underline"
				>
					{t("signup.login")}
				</Link>
			</p>
		</AuthCard>
	)
}
