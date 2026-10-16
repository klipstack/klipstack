import { fallbackLanguage, isLocale } from "@klipstack/i18n/languages"
import { useTranslation } from "react-i18next"
import { redirect } from "react-router"
import { saveStarterText } from "~/commands/saving.server"
import { StarterTexts } from "~/components/starter-texts"
import { AppError } from "~/lib/app-error"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { starterTextsFor } from "~/lib/starter-texts.server"
import { refused } from "~/lib/web-action.server"
import { starterItems } from "~/services/starter-texts.server"
import type { Route } from "./+types/texts"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "library:starter.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "library:starter.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const language = isLocale(user.locale) ? user.locale : fallbackLanguage
	return { language, starter: await starterItems(user.id, starterTextsFor(language)) }
}

/** Adds a starter text (from these shelves, Home's, the library's or the guide's page) and opens it. */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	let articleId: string
	try {
		articleId = (await saveStarterText(user.id, String(form.get("starter") ?? ""))).articleId
	} catch (error) {
		if (error instanceof AppError) return refused(error)
		throw error
	}
	throw redirect(`/read/${articleId}`)
}

/**
 * Every starter text, one shelf per language, the reader's first: the place to come back to for
 * them once Home and the library have other things to show. Not in the sidebar; the empty states,
 * the command menu and the guide link here.
 */
export default function Texts({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-16 md:px-8">
			{/* Phones name the page in the top bar. */}
			<h1 id="starter-title" className="hidden page-title md:block md:leading-10">
				{t("starter.title")}
			</h1>
			<StarterTexts
				items={loaderData.starter}
				language={loaderData.language}
				wide
				heading={false}
				className="md:mt-2"
			/>
		</main>
	)
}
