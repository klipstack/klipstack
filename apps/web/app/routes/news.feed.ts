import { getInstance } from "~/lib/i18n.server"
import { allNews, newsLocale, newsUrl } from "~/lib/news.server"
import type { Route } from "./+types/news.feed"

const escape = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const cdata = (html: string) => `<![CDATA[${html.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`

/**
 * GET /news/feed.xml — the news as RSS, each entry in full, in the language of `lng` (English
 * without it): to follow in Klipstack's Feeds, or any reader.
 */
export function loader({ context }: Route.LoaderArgs) {
	const locale = newsLocale(getInstance(context).language)
	const t = getInstance(context).getFixedT(locale)
	const items = allNews().map((news) => {
		const { title, description, article } = news.text[locale]
		const link = newsUrl(`/${news.slug}`, locale)
		return `<item><title>${escape(title)}</title><link>${escape(link)}</link><guid isPermaLink="true">${escape(link)}</guid><pubDate>${news.date.toUTCString()}</pubDate><description>${escape(description)}</description><content:encoded>${cdata(article)}</content:encoded></item>`
	})
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(t("news.cardKicker"))}</title><link>${escape(newsUrl("", locale))}</link><atom:link href="${escape(newsUrl("/feed.xml", locale))}" rel="self" type="application/rss+xml"/><description>${escape(t("news.intro"))}</description><language>${locale}</language>${items.join("")}</channel></rss>
`
	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	})
}
