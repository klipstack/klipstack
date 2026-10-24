import { useTranslation } from "react-i18next"
import { PublicPage } from "~/components/public-page"
import { getSession } from "~/lib/session.server"
import type { Route } from "./+types/extension.connected"

/**
 * GET /extension/connected — where the Safari extension's sign-in ends (`extensionRedirectUri`),
 * with `code` or `error` in the address. The extension reads the code from the tab and closes it;
 * the page is for a tab it didn't close. It shows neither: the code is useless without the
 * extension's PKCE verifier, and the page loads nothing from another site.
 */
export function loader({ context, request }: Route.LoaderArgs) {
	return {
		loggedIn: Boolean(getSession(context)),
		connected: new URL(request.url).searchParams.has("code"),
	}
}

export function meta() {
	return [{ title: "Klipstack" }, { name: "robots", content: "noindex" }]
}

export default function ExtensionConnected({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { connected } = loaderData
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10">
				<h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
					{t(connected ? "extensionPage.connected.title" : "extensionPage.connected.failedTitle")}
				</h1>
				<p className="mt-6 text-lg leading-relaxed">
					{t(connected ? "extensionPage.connected.body" : "extensionPage.connected.failedBody")}
				</p>
			</main>
		</PublicPage>
	)
}
