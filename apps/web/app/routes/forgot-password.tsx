import { errorLabel } from "@klipstack/log"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { RESET_PASSWORD_MINUTES } from "~/lib/auth-constants"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { auth } from "~/lib/auth.server"
import { emailEnabled } from "~/lib/email.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireAnonymous } from "~/lib/session.server"
import type { Route } from "./+types/forgot-password"

const schema = z.object({ email: z.email("auth:validation.emailInvalid") })

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:resetPassword.requestTitle") }]
}

export function loader({ context }: Route.LoaderArgs) {
	requireAnonymous(context)
	if (!emailEnabled) throw redirect("/login")
	return null
}

export async function action({ request, context }: Route.ActionArgs) {
	requireAnonymous(context)
	if (!emailEnabled) throw redirect("/login")
	const parsed = parseForm(await readForm(request), schema)
	if (!parsed.ok)
		return data(
			{ sent: false as const, fieldErrors: parsed.fieldErrors, email: parsed.values.email ?? "" },
			{ status: 400 },
		)
	const email = parsed.data.email.trim().toLowerCase()
	try {
		await auth.api.requestPasswordReset({
			body: { email, redirectTo: "/reset-password" },
			headers: request.headers,
		})
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		// Do not reveal whether the account exists. The error may name the address: log its kind only.
		console.warn(`[forgot-password] request failed: ${errorLabel(error)}`)
	}
	return { sent: true as const, email, fieldErrors: {} as FieldErrors }
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"

	if (actionData?.sent) {
		return (
			<AuthCard title={t("resetPassword.sentTitle")}>
				<p className="text-sm text-muted-fg">
					{t("resetPassword.sentDescription", {
						email: actionData.email,
						minutes: RESET_PASSWORD_MINUTES,
					})}
				</p>
				<Link to="/login" className="mt-6 inline-block text-sm text-link hover:underline">
					{t("magicLink.backToLogin")}
				</Link>
			</AuthCard>
		)
	}

	return (
		<AuthCard title={t("resetPassword.requestTitle")}>
			<p className="mb-4 text-sm text-muted-fg">{t("resetPassword.requestDescription")}</p>
			<Form method="post" className="flex flex-col gap-4">
				<Field
					label={t("email")}
					name="email"
					type="email"
					autoComplete="email"
					required
					defaultValue={actionData?.email}
					error={actionData?.fieldErrors?.email}
				/>
				<Button type="submit" disabled={busy}>
					{t("resetPassword.requestSubmit")}
				</Button>
			</Form>
			<Link to="/login" className="mt-6 inline-block text-sm text-link hover:underline">
				{t("magicLink.backToLogin")}
			</Link>
		</AuthCard>
	)
}
