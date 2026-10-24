import { useTranslation } from "react-i18next"
import { PublicPage } from "~/components/public-page"
import { buttonVariants } from "~/components/ui/button"
import { env } from "~/lib/env.server"
import {
	CHROME_STORE,
	chromiumDesktop,
	EXTENSION_SOURCE,
	extensionInStore,
	SAFARI_STORE,
	safariMac,
} from "~/lib/extension-url"
import { getInstance } from "~/lib/i18n.server"
import { getSession } from "~/lib/session.server"
import type { Route } from "./+types/extension"

/**
 * GET /extension — public: where every "Get the extension" leads, in the app and in emails. It
 * offers each browser its store, the visitor's first. The stores' extensions save to klipstack.com
 * only: another server's page leads to the source instead.
 */
export function loader({ context, request }: Route.LoaderArgs) {
	const t = getInstance(context).getFixedT(null, "common")
	const browser = chromiumDesktop(request.headers)
		? "chrome"
		: safariMac(request.headers)
			? "safari"
			: null
	return {
		loggedIn: Boolean(getSession(context)),
		stores: extensionInStore(env.APP_URL),
		chromeStore: CHROME_STORE,
		safariStore: SAFARI_STORE,
		source: EXTENSION_SOURCE,
		browser,
		title: t("extensionPage.title"),
		description: t("extensionPage.description"),
		url: `${env.APP_URL}/extension`,
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

export default function Extension({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { browser } = loaderData
	const cards = [
		{ id: "chrome" as const, store: loaderData.chromeStore },
		{ id: "safari" as const, store: loaderData.safariStore },
	].sort((a, b) => Number(b.id === browser) - Number(a.id === browser))
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10">
				<h1 className="font-serif text-4xl tracking-tight sm:text-5xl">
					{t("extensionPage.title")}
				</h1>
				<p className="mt-8 text-lg leading-relaxed">{t("extensionPage.description")}</p>

				{loaderData.stores ? (
					<>
						<ul className="mt-10 grid gap-4 sm:grid-cols-2">
							{cards.map(({ id, store }) => (
								<li
									key={id}
									data-testid={`extension-${id}`}
									className={`rounded-xl border p-5 ${id === browser ? "border-accent" : "border-border"}`}
								>
									<div className="flex items-baseline justify-between gap-3">
										<h2 className="font-serif text-2xl tracking-tight">
											{t(`extensionPage.${id}.name`)}
										</h2>
										{id === browser ? (
											<span className="text-xs font-medium text-muted-fg">
												{t("extensionPage.yourBrowser")}
											</span>
										) : null}
									</div>
									<p className="mt-2 text-sm leading-relaxed text-muted-fg">
										{t(`extensionPage.${id}.body`)}
									</p>
									{store ? (
										<a href={store} className={`mt-5 ${buttonVariants()}`}>
											{t(`extensionPage.${id}.get`)}
										</a>
									) : (
										<p className="mt-5 text-sm font-medium">{t("extensionPage.safari.soon")}</p>
									)}
								</li>
							))}
						</ul>

						<section className="mt-12">
							<h2 className="font-serif text-2xl tracking-tight">{t("extensionPage.use.title")}</h2>
							<ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed marker:text-muted-fg">
								<li>{t("extensionPage.use.button")}</li>
								<li>{t("extensionPage.use.menu")}</li>
								<li>{t("extensionPage.use.signIn")}</li>
								{loaderData.safariStore ? <li>{t("extensionPage.use.safari")}</li> : null}
							</ul>
						</section>
					</>
				) : (
					<section className="mt-12">
						<h2 className="font-serif text-2xl tracking-tight">
							{t("extensionPage.elsewhere.title")}
						</h2>
						<p className="mt-4 leading-relaxed">{t("extensionPage.elsewhere.body")}</p>
						<p className="mt-4">
							<a href={loaderData.source} className={link}>
								{t("extensionPage.elsewhere.source")}
							</a>
						</p>
					</section>
				)}
			</main>
		</PublicPage>
	)
}
