import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsPage } from "~/components/settings-page"
import { SignInMethods } from "~/components/sign-in-methods"
import { allowFormTargets } from "~/lib/csp.server"
import { emailEnabled } from "~/lib/email.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { enabledProviders, PROVIDER_ORIGINS } from "~/lib/provider-sign-in.server"
import { requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import type { Route } from "./+types/settings.account.sign-in"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:signIn.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:signIn.title" } }

/** Settings → Account → Ways to log in: the password, and the providers that open the account. */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	// Connecting a provider posts to /settings/sign-in, which sends the browser on to it.
	allowFormTargets(
		context,
		enabledProviders.map((provider) => PROVIDER_ORIGINS[provider]),
	)
	return {
		signIn: { ...(await signInMethods(user.id)), providers: enabledProviders },
		verified: user.emailVerified,
		emailEnabled,
	}
}

export default function SignInSettings({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	return (
		<SettingsPage
			title={t("signIn.title")}
			back={{ to: "/settings/account", label: t("account.title") }}
		>
			<SettingsCard>
				<SignInMethods
					{...loaderData.signIn}
					verified={loaderData.verified}
					emailEnabled={loaderData.emailEnabled}
				/>
			</SettingsCard>
		</SettingsPage>
	)
}
