import { isLocale, supportedLanguages } from "@klipstack/i18n/languages"
import { useTranslation } from "react-i18next"
import { data, Form, Link, useNavigation } from "react-router"
import { z } from "zod"
import { updateProfile } from "~/commands/account.server"
import { EmailVerification } from "~/components/email-verification"
import { PROVIDER_NAMES, type ProviderId } from "~/components/provider-buttons"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { Button, buttonVariants } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import { emailEnabled } from "~/lib/email.server"
import { hasFeature } from "~/lib/features.server"
import { type FieldErrors, parseForm } from "~/lib/forms"
import { localeCookie } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
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
		signIn: await signInMethods(user.id),
		// Offered with the flag; an account that has it on keeps the way to turn it off.
		twoFactor:
			user.twoFactorEnabled || (await hasFeature(user.id, "two-factor"))
				? { enabled: Boolean(user.twoFactorEnabled) }
				: null,
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
	const { signIn, twoFactor, user } = loaderData
	const ways = [
		...(signIn.hasPassword ? [t("account.password")] : []),
		...signIn.linked
			.filter((id) => id in PROVIDER_NAMES)
			.map((id) => PROVIDER_NAMES[id as ProviderId]),
	]
	return (
		<SettingsPage title={t("account.title")}>
			<Profile user={user} actionData={actionData} />
			<SettingsCard title={t("account.signInTitle")}>
				<ul className="mt-2 divide-y divide-border text-sm">
					<li className="py-4">
						<p className="font-medium">{t("account.emailLabel")}</p>
						<p className="mt-0.5 break-words text-muted-fg">{user.email}</p>
						<div className="mt-3">
							<EmailVerification
								email={user.email}
								verified={user.emailVerified}
								emailEnabled={loaderData.emailEnabled}
							/>
						</div>
					</li>
					<Row
						title={t("signIn.title")}
						value={ways.length ? ways.join(", ") : t("account.linksOnly")}
						to="/settings/account/sign-in"
						action={t("account.manage")}
						actionLabel={t("account.manageNamed", { name: t("signIn.title") })}
					/>
					{twoFactor ? (
						<Row
							title={t("twoFactor.title")}
							value={t(twoFactor.enabled ? "account.on" : "account.off")}
							to="/settings/account/two-factor"
							action={t(twoFactor.enabled ? "account.manage" : "twoFactor.start")}
							actionLabel={t(twoFactor.enabled ? "account.manageNamed" : "account.setUpNamed", {
								name: t("twoFactor.title"),
							})}
						/>
					) : null}
				</ul>
			</SettingsCard>
			<SettingsCard title={t("danger.title")} description={t("danger.description")}>
				<Link
					to="/settings/account/delete"
					className={`mt-4 border border-danger/40 text-danger hover:bg-danger/10 ${buttonVariants({ variant: "ghost", size: "sm" })}`}
				>
					{t("danger.start")}
				</Link>
			</SettingsCard>
		</SettingsPage>
	)
}

/** A line of the summary: what it is, where it stands, and the page that changes it. */
function Row({
	title,
	value,
	to,
	action,
	actionLabel,
}: {
	title: string
	value: string
	to: string
	action: string
	actionLabel: string
}) {
	return (
		<li className="flex items-center justify-between gap-4 py-4">
			<div className="min-w-0">
				<p className="font-medium">{title}</p>
				<p className="mt-0.5 text-muted-fg">{value}</p>
			</div>
			<Link
				to={to}
				prefetch="intent"
				aria-label={actionLabel}
				className={`shrink-0 ${buttonVariants({ variant: "secondary", size: "sm" })}`}
			>
				{action}
			</Link>
		</li>
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
