import { useTranslation } from "react-i18next"
import { redirect } from "react-router"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { TwoFactorSettings } from "~/components/two-factor-settings"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import { twoFactorOffered } from "~/lib/two-factor.server"
import type { Route } from "./+types/settings.account.two-factor"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:twoFactor.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:twoFactor.title" } }

/**
 * Settings → Account → Two-factor authentication, where `twoFactorOffered` says. The changes are `/settings/two-factor`'s.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	if (!(await twoFactorOffered(user))) throw redirect("/settings/account")
	return {
		enabled: Boolean(user.twoFactorEnabled),
		hasPassword: (await signInMethods(user.id)).hasPassword,
		verified: user.emailVerified,
		email: user.email,
	}
}

export default function TwoFactorPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage
			title={t("twoFactor.title")}
			back={{ to: "/settings/account", label: t("account.title") }}
		>
			<SettingsCard>
				<TwoFactorSettings {...loaderData} />
			</SettingsCard>
		</SettingsPage>
	)
}
