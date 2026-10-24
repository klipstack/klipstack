import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { SettingsCard, SettingsPage, SignInAgain } from "~/components/settings-page"
import { Button, buttonVariants } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import { signInMethods } from "~/lib/sign-in-methods.server"
import type { WebResult } from "~/lib/web-result"
import type { Route } from "./+types/settings.account.delete"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "settings:danger.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "settings:danger.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	return { hasPassword: (await signInMethods(user.id)).hasPassword }
}

/**
 * Settings → Account → Delete account: a page of its own, reached from a button. What goes, then
 * the email typed by hand (no password manager offers it: typing it is the point). The deletion
 * is `/settings/delete`'s.
 */
export default function DeleteAccountPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("settings")
	const fetcher = useFetcher<WebResult>()
	const refusal = fetcher.data?.ok === false ? fetcher.data.error.code : null
	return (
		<SettingsPage
			title={t("danger.title")}
			back={{ to: "/settings/account", label: t("account.title") }}
		>
			<SettingsCard>
				<div className="text-sm">
					<p className="font-medium">{t("danger.warning")}</p>
					<ul className="mt-2 list-disc pl-5 text-muted-fg">
						<li>{t("danger.goesLibrary")}</li>
						<li>{t("danger.goesConnections")}</li>
						<li>{t("danger.goesAccount")}</li>
					</ul>
					<p className="mt-3 text-muted-fg">
						{t("danger.exportFirst")}{" "}
						<Link to="/settings/data" className="text-link hover:underline">
							{t("danger.exportLink")}
						</Link>
					</p>
				</div>
				<fetcher.Form
					method="post"
					action="/settings/delete"
					autoComplete="off"
					className="mt-6 flex flex-col gap-4"
				>
					<div className="sm:w-80">
						<Field
							label={t("danger.confirmLabel")}
							name="confirmEmail"
							type="text"
							inputMode="email"
							autoComplete="off"
							autoCapitalize="off"
							spellCheck={false}
							required
							data-1p-ignore=""
							data-lpignore="true"
							data-bwignore=""
							data-form-type="other"
							error={refusal === "invalid_request" ? t("danger.mismatch") : undefined}
						/>
					</div>
					<div className="flex flex-wrap gap-3">
						<Button type="submit" variant="danger" disabled={fetcher.state !== "idle"}>
							{t("danger.submit")}
						</Button>
						<Link to="/settings/account" className={buttonVariants({ variant: "ghost" })}>
							{t("danger.cancel")}
						</Link>
					</div>
				</fetcher.Form>
				{refusal === "reauthentication_required" ? (
					<SignInAgain hasPassword={loaderData.hasPassword} />
				) : null}
			</SettingsCard>
		</SettingsPage>
	)
}
