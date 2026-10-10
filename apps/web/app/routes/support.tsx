import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { PublicPage } from "~/components/public-page"
import { LEGAL_NAME, PRIVACY_CONTACT, SUPPORT_CONTACT } from "~/lib/company"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { getSession } from "~/lib/session.server"
import type { Route } from "./+types/support"

/** GET /support — public, like the policies: the App Store's support link points here. */
export async function loader({ context }: Route.LoaderArgs) {
	const t = getInstance(context).getFixedT(null, "common")
	return {
		loggedIn: Boolean(getSession(context)),
		title: t("support.title"),
		description: t("support.description"),
		url: `${env.APP_URL}/support`,
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	return [
		{ title: `${loaderData.title} · Klipstack` },
		{ name: "description", content: loaderData.description },
		{ tagName: "link", rel: "canonical", href: loaderData.url },
	]
}

const link = "text-link underline underline-offset-2"

export default function Support({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10">
				<h1 className="font-serif text-4xl tracking-tight sm:text-5xl">{t("support.title")}</h1>
				<p className="mt-8 text-lg leading-relaxed">{t("support.description")}</p>

				<section className="mt-12">
					<h2 className="font-serif text-2xl tracking-tight">{t("support.contact.title")}</h2>
					<div className="mt-4 space-y-4 leading-relaxed">
						<p>
							{t("support.contact.body")}{" "}
							<a href={`mailto:${SUPPORT_CONTACT}`} className={link}>
								{SUPPORT_CONTACT}
							</a>
							.
						</p>
						<p>{t("support.contact.tips")}</p>
					</div>
				</section>

				<section className="mt-12">
					<h2 className="font-serif text-2xl tracking-tight">{t("support.account.title")}</h2>
					<ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed marker:text-muted-fg">
						<li>{t("support.account.export")}</li>
						<li>{t("support.account.delete")}</li>
						<li>
							<Link to="/privacy" className={link}>
								{t("support.account.privacy")}
							</Link>{" "}
							{t("support.account.privacyRequest")}{" "}
							<a href={`mailto:${PRIVACY_CONTACT}`} className={link}>
								{PRIVACY_CONTACT}
							</a>
							.
						</li>
					</ul>
				</section>

				<section className="mt-12">
					<h2 className="font-serif text-2xl tracking-tight">{t("support.report.title")}</h2>
					<p className="mt-4 leading-relaxed">{t("support.report.body")}</p>
				</section>

				<p className="mt-12 text-sm text-muted-fg">
					{t("support.company", { company: LEGAL_NAME })}
				</p>
			</main>
		</PublicPage>
	)
}
