import { APIError } from "better-auth/api"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { MIN_PASSWORD_LENGTH as MIN_PASSWORD } from "~/lib/auth-constants"
import { auth } from "~/lib/auth.server"
import { parseForm } from "~/lib/forms"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import type { Route } from "./+types/reset-password"

const schema = z.object({
	token: z.string().min(1).max(200),
	password: z.string().min(MIN_PASSWORD, "auth:signup.passwordTooShort"),
})

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:resetPassword.title") }]
}

// Signed-in visitors may use the link too: the reset signs every session out.
export function loader({ request }: Route.LoaderArgs) {
	// better-auth checks the emailed link, then redirects here with `token`, or with `error`.
	return { token: new URL(request.url).searchParams.get("token") }
}

export async function action({ request }: Route.ActionArgs) {
	const parsed = parseForm(await readForm(request), schema)
	if (!parsed.ok)
		return data(
			{
				expired: !!parsed.fieldErrors.token,
				tooShort: !!parsed.fieldErrors.password,
				formError: null,
			},
			{ status: 400 },
		)
	try {
		await auth.api.resetPassword({
			body: { token: parsed.data.token, newPassword: parsed.data.password },
			headers: request.headers,
		})
	} catch (error) {
		if (!(error instanceof APIError)) throw error
		const code = error.body?.code
		// The link was used, has expired, or its account is gone: all need a new link.
		const expired = code === "INVALID_TOKEN" || code === "USER_NOT_FOUND"
		const tooShort = code === "PASSWORD_TOO_SHORT"
		return data(
			{ expired, tooShort, formError: expired || tooShort ? null : error.message },
			{ status: 400 },
		)
	}
	throw redirect("/login?reset=1")
}

export default function ResetPassword({ actionData, loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"

	if (!loaderData.token || actionData?.expired) {
		return (
			<AuthCard title={t("resetPassword.expiredTitle")}>
				<p className="text-sm text-muted-fg" role="alert">
					{t("resetPassword.expired")}
				</p>
				<Link to="/forgot-password" className="mt-6 inline-block text-sm text-link hover:underline">
					{t("resetPassword.requestAgain")}
				</Link>
			</AuthCard>
		)
	}

	return (
		<AuthCard title={t("resetPassword.title")}>
			<p className="mb-4 text-sm text-muted-fg">{t("resetPassword.description")}</p>
			<Form method="post" className="flex flex-col gap-4">
				<input type="hidden" name="token" value={loaderData.token} />
				<Field
					label={t("resetPassword.newPassword")}
					name="password"
					type="password"
					autoComplete="new-password"
					required
					minLength={MIN_PASSWORD}
					error={
						actionData?.tooShort ? t("signup.passwordTooShort", { min: MIN_PASSWORD }) : undefined
					}
				/>
				{actionData?.formError ? (
					<p className="text-sm text-danger" role="alert">
						{actionData.formError}
					</p>
				) : null}
				<Button type="submit" disabled={busy}>
					{t("resetPassword.submit")}
				</Button>
			</Form>
		</AuthCard>
	)
}
