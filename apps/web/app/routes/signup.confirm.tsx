import { db, eq, user } from "@klipstack/db"
import { errorLabel } from "@klipstack/log"
import { APIError } from "better-auth/api"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { getLocale, localeCookie } from "~/lib/i18n.server"
import { confirmSignupLink, peekMagicLink } from "~/lib/magic-link.server"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { cookieHeadersFrom, requireAnonymous, SIGNED_IN_HOME } from "~/lib/session.server"
import type { Route } from "./+types/signup.confirm"

type Problem = "expired" | "invite" | "exists"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:signup.title") }]
}

// Opening the link changes nothing: mail scanners follow links, and the token works once. The
// account is created by the button below.
export async function loader({ request, context }: Route.LoaderArgs) {
	requireAnonymous(context)
	const params = new URL(request.url).searchParams
	const token = params.get("token") ?? ""
	const email = await peekMagicLink(token)
	if (!email) return { problem: "expired" as Problem, email: null, token: "", invite: "" }
	return { problem: null, email, token, invite: params.get("invite") ?? "" }
}

export async function action({ request, context }: Route.ActionArgs) {
	requireAnonymous(context)
	const form = await readForm(request)
	const token = String(form.get("token") ?? "")
	const inviteCode = String(form.get("invite") ?? "")
	// The token first: without a valid one, this answers nothing about invite codes.
	const email = await peekMagicLink(token)
	if (!email) return data({ problem: "expired" as Problem }, { status: 400 })
	// The account appeared after the link was sent. The link does not log in to it: for an
	// unverified account that would remove its password, and this email never said so.
	const existing = await db.query.user.findFirst({ where: eq(user.email, email) })
	if (existing) return data({ problem: "exists" as Problem }, { status: 409 })

	const locale = getLocale(context)
	try {
		const { headers } = await confirmSignupLink({ token, inviteCode, locale }, request.headers)
		const out = cookieHeadersFrom(headers)
		out.append("set-cookie", await localeCookie.serialize(locale))
		throw redirect(SIGNED_IN_HOME, { headers: out })
	} catch (error) {
		if (error instanceof Response) throw error
		const limited = authLimitResponse(error)
		if (limited) throw limited
		if (error instanceof APIError) {
			const code = (error.body as { code?: string } | undefined)?.code
			if (code === "INVITE_REQUIRED") return data({ problem: "invite" as Problem }, { status: 400 })
			// better-auth answers a used or expired token with a redirect: the message names no one.
			console.warn(`[signup] link confirmation failed: ${errorLabel(error)}`)
			return data({ problem: "expired" as Problem }, { status: 400 })
		}
		throw error
	}
}

export default function SignupConfirm({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	const problem = actionData?.problem ?? loaderData.problem

	if (problem) {
		return (
			<AuthCard title={t(`signupLink.${problem}Title`)}>
				<p className="text-sm text-muted-fg" role="alert">
					{t(`signupLink.${problem}`)}
				</p>
				<Link
					to={problem === "exists" ? "/login" : "/signup"}
					className="mt-6 inline-block text-sm text-link hover:underline"
				>
					{t(problem === "exists" ? "signup.login" : "signupLink.startAgain")}
				</Link>
			</AuthCard>
		)
	}

	return (
		<AuthCard title={t("signupLink.confirmTitle")}>
			<p className="mb-4 text-sm text-muted-fg">
				{t("signupLink.confirmDescription", { email: loaderData.email })}
			</p>
			<Form method="post" className="flex flex-col gap-4">
				<input type="hidden" name="token" value={loaderData.token} />
				<input type="hidden" name="invite" value={loaderData.invite} />
				<Button type="submit" disabled={busy}>
					{t("signup.submit")}
				</Button>
			</Form>
		</AuthCard>
	)
}
