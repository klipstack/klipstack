import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { PublicPage } from "~/components/public-page"
import { buttonVariants } from "~/components/ui/button"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { getSession } from "~/lib/session.server"
import {
	findStarterText,
	guidePath,
	STARTER_LANGUAGES,
	type StarterLanguage,
} from "~/lib/starter-texts.server"
import { savedStarterTexts } from "~/services/starter-texts.server"
import type { Route } from "./+types/guide"

const isStarterLanguage = (value: string | undefined): value is StarterLanguage =>
	(STARTER_LANGUAGES as readonly string[]).includes(value ?? "")

/**
 * The guide to Klipstack, open to anyone: the page a library's copy of the guide is saved from,
 * one address per language. `/guide` goes to the reader's language.
 */
export async function loader({ context, params }: Route.LoaderArgs) {
	const { language } = params
	if (!isStarterLanguage(language)) {
		const preferred = getInstance(context).language
		throw redirect(guidePath(isStarterLanguage(preferred) ? preferred : "en"))
	}
	const guide = findStarterText(`guide-${language}`)!
	const session = getSession(context)
	// A reader who has it opens their copy instead.
	const articleId = session
		? ((await savedStarterTexts(session.user.id, [guide])).get(guide.slug) ?? null)
		: null
	return {
		loggedIn: Boolean(session),
		articleId,
		slug: guide.slug,
		language,
		title: guide.title,
		description: guide.description,
		body: guide.article,
		url: `${env.APP_URL}${guidePath(language)}`,
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	return [
		{ title: `${loaderData.title} · Klipstack` },
		...(loaderData.description ? [{ name: "description", content: loaderData.description }] : []),
		{ name: "author", content: "Klipstack" },
		{ tagName: "link", rel: "canonical", href: loaderData.url },
	]
}

export default function Guide({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10" lang={loaderData.language}>
				{loaderData.articleId ? (
					<div className="mb-6 flex justify-end">
						<Link
							to={`/read/${loaderData.articleId}`}
							className={buttonVariants({ variant: "secondary", size: "sm" })}
						>
							{t("starter.openSaved")}
						</Link>
					</div>
				) : loaderData.loggedIn ? (
					<Form method="post" action="/add" className="mb-6 flex justify-end">
						<input type="hidden" name="starter" value={loaderData.slug} />
						<button type="submit" className={buttonVariants({ variant: "secondary", size: "sm" })}>
							{t("starter.add")}
						</button>
					</Form>
				) : null}
				<div
					className="reader-content prose max-w-none"
					// oxlint-disable-next-line react/no-danger -- the guide ships with the app (app/starter/guide)
					dangerouslySetInnerHTML={{ __html: loaderData.body }}
				/>
			</main>
		</PublicPage>
	)
}
