import { data } from "react-router"
import { env } from "~/lib/env.server"
import { getInstance } from "~/lib/i18n.server"
import { newsCardPng } from "~/lib/news-card.server"
import { findNews, newsDate, newsLocale } from "~/lib/news.server"
import type { Route } from "./+types/news.og"

/**
 * GET /news/:slug/og.png — a news entry's picture for link previews (`lib/news-card.server.ts`),
 * in the language of `lng`, English without it.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
	const news = findNews(params.slug)
	if (!news) throw data(null, { status: 404 })
	const locale = newsLocale(getInstance(context).language)
	const t = getInstance(context).getFixedT(locale)
	const { title, description } = news.text[locale]
	const png = await newsCardPng(`${news.slug}:${locale}`, () => ({
		kicker: t("news.cardKicker"),
		title,
		description,
		date: newsDate(news, locale),
		address: `${new URL(env.APP_URL).host}/news`,
	}))
	return new Response(new Uint8Array(png), {
		headers: {
			"Content-Type": "image/png",
			"Content-Length": String(png.length),
			"Cache-Control": "public, max-age=86400",
		},
	})
}
