import { PolicyDocument } from "~/components/policy-document"
import { PublicPage } from "~/components/public-page"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { appSignInQuery } from "~/lib/oauth.server"
import { getSession } from "~/lib/session.server"
import { termsOfUse } from "~/lib/terms.server"
import type { Route } from "./+types/terms"

// Long and read rarely, as the privacy policy: it comes with the page, not in the translations.
export async function loader({ context, request }: Route.LoaderArgs) {
	return {
		loggedIn: Boolean(getSession(context)),
		appQuery: await appSignInQuery(new URL(request.url)),
		terms: termsOfUse(getInstance(context).language),
		url: `${env.APP_URL}/terms`,
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	return [
		{ title: `${loaderData.terms.title} · Klipstack` },
		{ name: "description", content: loaderData.terms.summary },
		{ tagName: "link", rel: "canonical", href: loaderData.url },
	]
}

export default function Terms({ loaderData }: Route.ComponentProps) {
	return (
		<PublicPage loggedIn={loaderData.loggedIn} appQuery={loaderData.appQuery}>
			<PolicyDocument policy={loaderData.terms} />
		</PublicPage>
	)
}
