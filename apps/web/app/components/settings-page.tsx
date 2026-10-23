import { useTranslation } from "react-i18next"
import { Form, useFetcher, useLocation } from "react-router"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"

/** A section of Settings: its title (in the phone bar instead, below `md`), and what it holds. */
export function SettingsPage({
	title,
	description,
	children,
}: {
	title: string
	description?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-8">
			<h1 className="hidden page-title md:block md:leading-10">{title}</h1>
			{description ? <p className="text-sm text-muted-fg md:mt-1">{description}</p> : null}
			{children}
		</main>
	)
}

/** A card of settings within a section. */
export function SettingsCard({
	title,
	description,
	children,
}: {
	title?: string
	description?: string
	children: React.ReactNode
}) {
	return (
		<section className="mt-6 rounded-2xl border border-border bg-card p-6">
			{title ? <h2 className="text-lg font-medium">{title}</h2> : null}
			{description ? <p className="mt-1 text-sm text-muted-fg">{description}</p> : null}
			{children}
		</section>
	)
}

/**
 * What an action refused for an old sign-in shows: why, and the way back. An account with a
 * password confirms it here and stays signed in; one without logs in again, back to this section.
 */
export function SignInAgain({ hasPassword }: { hasPassword: boolean }) {
	const { t } = useTranslation("settings")
	const { pathname } = useLocation()
	const fetcher = useFetcher<typeof import("~/routes/settings.reauthenticate").action>()
	const result = fetcher.data
	if (result?.ok)
		return (
			<p className="mt-3 text-sm" role="status">
				{t("reauth.confirmed")}
			</p>
		)
	if (!hasPassword)
		return (
			<div className="mt-3 flex flex-col items-start gap-2" role="alert">
				<p className="text-sm">{t("reauth.message")}</p>
				<Form method="post" action="/settings/reauthenticate">
					<input type="hidden" name="returnTo" value={pathname} />
					<Button type="submit" variant="secondary">
						{t("reauth.button")}
					</Button>
				</Form>
			</div>
		)
	return (
		<fetcher.Form
			method="post"
			action="/settings/reauthenticate"
			className="mt-3 flex flex-col items-start gap-3"
		>
			<p className="text-sm" role="alert">
				{t("reauth.passwordMessage")}
			</p>
			<div className="w-full sm:w-72">
				<Field
					label={t("reauth.password")}
					name="password"
					type="password"
					autoComplete="current-password"
					required
					error={
						result
							? t(result.error === "limited" ? "reauth.limited" : "reauth.wrongPassword")
							: undefined
					}
				/>
			</div>
			<Button type="submit" variant="secondary" disabled={fetcher.state !== "idle"}>
				{t("reauth.confirm")}
			</Button>
		</fetcher.Form>
	)
}
