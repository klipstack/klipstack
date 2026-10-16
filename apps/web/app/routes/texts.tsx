import { SAVE_LINKS_MAX } from "@klipstack/api-contract/names"
import { fallbackLanguage, isLocale } from "@klipstack/i18n/languages"
import { useTranslation } from "react-i18next"
import { Link, redirect } from "react-router"
import { saveStarterText } from "~/commands/saving.server"
import { StarterGuide, StarterShelf } from "~/components/starter-texts"
import { AppError } from "~/lib/app-error"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { saveErrorKey } from "~/lib/save-errors"
import { requireUser } from "~/lib/session.server"
import { isStarterLanguage, STARTER_LANGUAGES, STARTER_TOPICS } from "~/lib/starter-shelves"
import { starterGuide, starterTextsIn } from "~/lib/starter-texts.server"
import { cn } from "~/lib/utils"
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
	// The texts' language, `?lang=`: the reader's own unless they ask for another.
	const asked = new URL(request.url).searchParams.get("lang")
	const shown = isStarterLanguage(asked) ? asked : language
	// The guide is about the app, so it is in the app's language whichever texts are shown.
	const [guide, ...texts] = await starterItems(user.id, [
		starterGuide(language),
		...starterTextsIn(shown),
	])
	return {
		language,
		shown,
		guide: guide!,
		shelves: STARTER_TOPICS.map((topic) => ({
			topic,
			items: texts.filter((text) => text.topic === topic),
		})).filter((shelf) => shelf.items.length),
	}
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
 * Every starter text: the guide, then one shelf per topic, in one language at a time, the reader's
 * unless they switch. The sidebar, the empty states, the command menu and the guide link here.
 */
export default function Texts({ loaderData, actionData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { language, shown, guide, shelves } = loaderData
	// A book from here, Home, the library or the guide that could not be added: why.
	const error = actionData?.ok === false ? actionData.error : null
	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-16 md:px-8">
			<div className="flex flex-wrap items-center justify-between gap-3">
				{/* Phones name the page in the top bar. */}
				<h1 id="starter-title" className="hidden page-title md:block md:leading-10">
					{t("starter.title")}
				</h1>
				<LanguageSwitch shown={shown} />
			</div>
			{error ? (
				<p role="alert" className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm text-danger">
					{t(saveErrorKey(error), { max: SAVE_LINKS_MAX })}
				</p>
			) : null}
			{guide.articleId ? null : <StarterGuide item={guide} className="mt-4 max-w-xl" />}
			<p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted-fg">
				{t("starter.description")}
			</p>
			{shelves.map(({ topic, items }) => (
				<section key={topic} aria-labelledby={`starter-${topic}`} className="mt-10">
					<h2 id={`starter-${topic}`} className="font-serif text-xl leading-tight font-semibold">
						{t(`starter.topics.${topic}.title`)}
					</h2>
					<p className="text-sm text-muted-fg">{t(`starter.topics.${topic}.description`)}</p>
					<StarterShelf
						items={items}
						language={language}
						label={t(`starter.topics.${topic}.title`)}
						wide
						className="mt-2"
					/>
				</section>
			))}
			{guide.articleId ? <StarterGuide item={guide} className="mt-12 max-w-xl" /> : null}
		</main>
	)
}

/** Which language's texts the page shows: links, so the choice is in the address. */
function LanguageSwitch({ shown }: { shown: string }) {
	const { t } = useTranslation("library")
	return (
		<nav
			aria-label={t("starter.languageSwitch")}
			className="flex rounded-lg bg-muted p-0.5 text-sm"
		>
			{STARTER_LANGUAGES.map((lang) => (
				<Link
					key={lang}
					to={`?lang=${lang}`}
					replace
					preventScrollReset
					lang={lang}
					aria-current={lang === shown ? "page" : undefined}
					className={cn(
						"rounded-md px-3 py-1",
						lang === shown ? "bg-bg font-medium shadow-sm" : "text-muted-fg hover:text-fg",
					)}
				>
					{LANGUAGE_NAMES[lang]}
				</Link>
			))}
		</nav>
	)
}

/** Each language by its own name: a reader looks for the one they read. */
const LANGUAGE_NAMES: Record<(typeof STARTER_LANGUAGES)[number], string> = {
	en: "English",
	es: "Español",
}
