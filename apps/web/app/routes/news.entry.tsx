import { useTranslation } from "react-i18next"
import { data, Link } from "react-router"
import { PublicPage } from "~/components/public-page"
import { getInstance } from "~/lib/i18n.server"
import { NEWS_CARD_DESIGN } from "~/lib/news-card.server"
import { findNews, newsDate, newsLocale, newsUrl } from "~/lib/news.server"
import { getSession } from "~/lib/session.server"
import type { Route } from "./+types/news.entry"

/**
 * GET /news/:slug — a news entry (`app/news/`), open to anyone, in the reader's language: the page
 * the sidebar's card opens, and the one shared, with its own picture for link previews.
 */
export function loader({ context, params }: Route.LoaderArgs) {
	const news = findNews(params.slug)
	if (!news) throw data(null, { status: 404 })
	const locale = newsLocale(getInstance(context).language)
	const { title, description, article } = news.text[locale]
	return {
		loggedIn: Boolean(getSession(context)),
		locale,
		date: newsDate(news, locale),
		isoDate: news.date.toISOString(),
		title,
		description,
		article,
		url: newsUrl(`/${news.slug}`, locale),
		image: newsUrl(`/${news.slug}/og.png`, locale, { v: String(NEWS_CARD_DESIGN) }),
	}
}

export function meta({ loaderData }: Route.MetaArgs) {
	if (!loaderData) return [{ title: "Klipstack" }]
	const { title, description, url, image, isoDate } = loaderData
	return [
		{ title: `${title} · Klipstack` },
		{ name: "description", content: description },
		{ tagName: "link", rel: "canonical", href: url },
		{ property: "og:type", content: "article" },
		{ property: "og:site_name", content: "Klipstack" },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:image", content: image },
		{ property: "og:image:width", content: "1200" },
		{ property: "og:image:height", content: "630" },
		{ property: "og:image:alt", content: title },
		{ property: "article:published_time", content: isoDate },
		{ name: "twitter:card", content: "summary_large_image" },
	]
}

export default function NewsEntry({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<PublicPage loggedIn={loaderData.loggedIn}>
			<main className="mx-auto w-full max-w-2xl pt-6 pb-20 sm:pt-10" lang={loaderData.locale}>
				<p className="text-sm text-muted-fg">
					<Link to="/news" className="hover:text-fg hover:underline">
						{t("news.title")}
					</Link>
					{" · "}
					<time dateTime={loaderData.isoDate}>{loaderData.date}</time>
				</p>
				<h1 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">{loaderData.title}</h1>
				<div
					className="reader-content prose mt-8 max-w-none"
					// oxlint-disable-next-line react/no-danger -- the news ships with the app (app/news)
					dangerouslySetInnerHTML={{ __html: loaderData.article }}
				/>
				<p className="mt-10 border-t border-border pt-6">
					<Link to="/news" className="text-link underline-offset-4 hover:underline">
						{t("news.all")}
					</Link>
				</p>
			</main>
		</PublicPage>
	)
}
