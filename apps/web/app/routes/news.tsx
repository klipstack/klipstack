import { Rss } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { PublicPage } from "~/components/public-page"
import { getInstance } from "~/lib/i18n.server"
import { allNews, newsDate, newsLocale, newsUrl } from "~/lib/news.server"
import { getSession } from "~/lib/session.server"
import type { Route } from "./+types/news"

/** GET /news — every news entry, newest first, in the reader's language, and their feed. */
export function loader({ context }: Route.LoaderArgs) {
	const locale = newsLocale(getInstance(context).language)
	return {
		title: getInstance(context).getFixedT(locale)("news.title"),
		loggedIn: Boolean(getSession(context)),
		locale,
		url: newsUrl("", locale),
		feed: newsUrl("/feed.xml", locale),
		entries: allNews().map((news) => ({
			slug: news.slug,
			date: newsDate(news, locale),
			isoDate: news.date.toISOString(),
			title: news.text[locale].title,
			description: news.text[locale].description,
		})),
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	return [
		{ title: `${loaderData.title} · Klipstack` },
		{ tagName: "link", rel: "canonical", href: loaderData.url },
		{
			tagName: "link",
			rel: "alternate",
			type: "application/rss+xml",
			title: "Klipstack",
			href: loaderData.feed,
		},
	]
}

export default function News({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10" lang={loaderData.locale}>
				<div className="flex items-end justify-between gap-4">
					<h1 className="font-serif text-4xl tracking-tight sm:text-5xl">{t("news.title")}</h1>
					<a
						href={loaderData.feed}
						className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-fg hover:bg-hover hover:text-fg"
					>
						<Rss className="size-4" aria-hidden />
						{t("news.feed")}
					</a>
				</div>
				<p className="mt-3 text-lg text-muted-fg">{t("news.intro")}</p>
				{loaderData.entries.length === 0 ? (
					<p className="mt-12 text-muted-fg">{t("news.empty")}</p>
				) : (
					<ol className="mt-10 divide-y divide-border border-y border-border">
						{loaderData.entries.map((entry) => (
							<li key={entry.slug} className="relative py-6">
								<time dateTime={entry.isoDate} className="text-sm text-muted-fg">
									{entry.date}
								</time>
								<h2 className="mt-1 font-serif text-2xl tracking-tight">
									<Link
										to={`/news/${entry.slug}`}
										className="after:absolute after:inset-0 hover:underline"
									>
										{entry.title}
									</Link>
								</h2>
								<p className="mt-2 leading-relaxed text-muted-fg">{entry.description}</p>
							</li>
						))}
					</ol>
				)}
			</main>
		</PublicPage>
	)
}
