import { useTranslation } from "react-i18next"
import { Form, useLocation } from "react-router"
import { Button } from "~/components/ui/button"

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
 * What an action refused for an old sign-in shows: why, and the way back in, which returns to this
 * section.
 */
export function SignInAgain() {
	const { t } = useTranslation("settings")
	const { pathname } = useLocation()
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
}
