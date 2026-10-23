import { isLocale, supportedLanguages } from "@klipstack/i18n/languages"
import { useTranslation } from "react-i18next"
import { data, Form, useFetcher, useNavigation } from "react-router"
import { z } from "zod"
import { updateProfile } from "~/commands/account.server"
import { EmailVerification } from "~/components/email-verification"
import { SettingsCard, SettingsPage, SignInAgain } from "~/components/settings-page"
import { SignInMethods } from "~/components/sign-in-methods"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import { emailEnabled } from "~/lib/email.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { localeCookie } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { enabledProviders } from "~/lib/provider-sign-in.server"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import type { WebResult } from "~/lib/web-result"
import type { Route } from "./+types/settings.account"

const schema = z.object({
	name: z.string().trim().min(1, "auth:validation.required").max(100),
	locale: z.enum(supportedLanguages),
})

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:account.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:account.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	return {
		user: {
			name: user.name,
			locale: isLocale(user.locale) ? user.locale : "en",
			email: user.email,
			emailVerified: user.emailVerified,
		},
		signIn: { ...(await signInMethods(user.id)), providers: enabledProviders },
		emailEnabled,
	}
}

/** The profile form: name and language. */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const parsed = parseForm(await readForm(request), schema)
	if (!parsed.ok)
		return data({ ok: false as const, fieldErrors: parsed.fieldErrors }, { status: 400 })
	await updateProfile(user.id, parsed.data)
	return data(
		{ ok: true as const, fieldErrors: {} as FieldErrors },
		{ headers: { "set-cookie": await localeCookie.serialize(parsed.data.locale) } },
	)
}

export default function AccountSettings({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage title={t("account.title")}>
			<Profile user={loaderData.user} actionData={actionData} />
			<SettingsCard title={t("account.signInTitle")}>
				<p className="mt-1 text-sm text-muted-fg">
					{t("account.email", { email: loaderData.user.email })}
				</p>
				<div className="mt-4">
					<EmailVerification
						email={loaderData.user.email}
						verified={loaderData.user.emailVerified}
						emailEnabled={loaderData.emailEnabled}
					/>
				</div>
				<SignInMethods
					{...loaderData.signIn}
					verified={loaderData.user.emailVerified}
					emailEnabled={loaderData.emailEnabled}
				/>
			</SettingsCard>
			<DeleteAccount hasPassword={loaderData.signIn.hasPassword} />
		</SettingsPage>
	)
}

function Profile({
	user,
	actionData,
}: {
	user: Route.ComponentProps["loaderData"]["user"]
	actionData: Route.ComponentProps["actionData"]
}) {
	const { t } = useTranslation("settings")
	const { t: tc } = useTranslation()
	const { t: ta } = useTranslation("auth")
	const busy = useNavigation().state !== "idle"
	return (
		<SettingsCard title={t("profile.title")} description={t("profile.description")}>
			<Form method="post" className="mt-4 flex flex-col gap-4" key={user.locale + user.name}>
				<Field
					label={ta("name")}
					name="name"
					required
					defaultValue={user.name}
					error={actionData?.fieldErrors?.name}
				/>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="locale">{tc("language.label")}</Label>
					<select
						id="locale"
						name="locale"
						defaultValue={user.locale}
						className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{supportedLanguages.map((lng) => (
							<option key={lng} value={lng}>
								{tc(`language.${lng}`)}
							</option>
						))}
					</select>
				</div>
				<div className="flex items-center gap-3">
					<Button type="submit" disabled={busy}>
						{tc("actions.save")}
					</Button>
					{actionData?.ok ? (
						<p className="text-sm text-muted-fg" role="status">
							{t("profile.saved")}
						</p>
					) : null}
				</div>
			</Form>
		</SettingsCard>
	)
}

/** At the foot of Account rather than in the sidebar: rare, and not to be stumbled on. */
function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
	const { t } = useTranslation("settings")
	const fetcher = useFetcher<WebResult>()
	const refusal = fetcher.data?.ok === false ? fetcher.data.error.code : null
	return (
		<SettingsCard title={t("danger.title")} description={t("danger.description")}>
			<fetcher.Form
				method="post"
				action="/settings/delete"
				className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
			>
				<div className="flex-1">
					<Field
						label={t("danger.confirmLabel")}
						name="confirmEmail"
						type="email"
						autoComplete="off"
						required
						error={refusal === "invalid_request" ? t("danger.mismatch") : undefined}
					/>
				</div>
				<Button type="submit" variant="danger" disabled={fetcher.state !== "idle"}>
					{t("danger.submit")}
				</Button>
			</fetcher.Form>
			{refusal === "reauthentication_required" ? <SignInAgain hasPassword={hasPassword} /> : null}
		</SettingsCard>
	)
}
