import { PolicyDocument } from "~/components/policy-document"
import { PublicPage } from "~/components/public-page"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { privacyPolicy } from "~/lib/privacy-policy.server"
import { getSession } from "~/lib/session.server"
import type { Route } from "./+types/privacy"

// The policy is long and read rarely: it comes with the page, not in the translations every page loads.
export async function loader({ context }: Route.LoaderArgs) {
	return {
		loggedIn: Boolean(getSession(context)),
		policy: privacyPolicy(getInstance(context).language),
		url: `${env.APP_URL}/privacy`,
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	return [
		{ title: `${loaderData.policy.title} · Klipstack` },
		{ name: "description", content: loaderData.policy.summary },
		{ tagName: "link", rel: "canonical", href: loaderData.url },
	]
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<PolicyDocument policy={loaderData.policy} />
		</PublicPage>
	)
}
