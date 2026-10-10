import { errorLabel } from "@klipstack/log"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { z } from "zod"
import { AuthCard } from "~/components/auth-card"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { MAGIC_LINK_MINUTES } from "~/lib/auth-constants"
import { authLimitResponse } from "~/lib/auth-limits.server"
import { emailEnabled } from "~/lib/email.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { requestMagicLink } from "~/lib/magic-link.server"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireAnonymous, safeRedirect } from "~/lib/session.server"
import type { Route } from "./+types/magic-link"

const schema = z.object({
	email: z.email("auth:validation.emailInvalid"),
	redirectTo: z.string().max(500).optional(),
})

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "auth:magicLink.title") }]
}

export async function loader({ context, request }: Route.LoaderArgs) {
	requireAnonymous(context)
	if (!emailEnabled) throw redirect("/login")
	// Where the emailed link lands, like the password form's `redirectTo`: a same-origin path only.
	const redirectTo = new URL(request.url).searchParams.get("redirectTo")
	return { redirectTo: redirectTo ? safeRedirect(redirectTo) : null }
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
	const { email, redirectTo } = parsed.data
	try {
		await requestMagicLink(email, request.headers, safeRedirect(redirectTo))
	} catch (error) {
		const limited = authLimitResponse(error)
		if (limited) throw limited
		// Do not reveal whether the account exists. The error may name the address: log its kind only.
		console.warn(`[magic-link] request failed: ${errorLabel(error)}`)
	}
	return { sent: true as const, email, fieldErrors: {} as FieldErrors }
}

export default function MagicLink({ actionData, loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("auth")
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"

	if (actionData?.sent) {
		return (
			<AuthCard title={t("magicLink.sentTitle")}>
				<p className="text-sm text-muted-fg">
					{t("magicLink.sentDescription", { email: actionData.email, minutes: MAGIC_LINK_MINUTES })}
				</p>
				<Link to="/login" className="mt-6 inline-block text-sm text-link hover:underline">
					{t("magicLink.backToLogin")}
				</Link>
			</AuthCard>
		)
	}

	return (
		<AuthCard title={t("magicLink.title")}>
			<p className="mb-4 text-sm text-muted-fg">{t("magicLink.description")}</p>
			<Form method="post" className="flex flex-col gap-4">
				{loaderData?.redirectTo ? (
					<input type="hidden" name="redirectTo" value={loaderData.redirectTo} />
				) : null}
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
					{t("magicLink.submit")}
				</Button>
			</Form>
			<Link to="/login" className="mt-6 inline-block text-sm text-link hover:underline">
				{t("magicLink.backToLogin")}
			</Link>
		</AuthCard>
	)
}
