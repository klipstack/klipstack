import type { DesktopBrowser } from "../lib/extension-url"

/**
 * Klipstack's news: what is new in the app, newest first. Each entry's text is a page per
 * language beside this file, `<slug>/en.html` and `<slug>/es.html`: its `<title>`, a
 * `<meta name="description">` (the sidebar card's line and the share image's) and an `<article>`.
 * A deploy publishes it: on `/news`, its feed and share image, and in the sidebar of the accounts
 * it is for (`lib/news.server.ts`).
 */
export const NEWS: readonly NewsEntry[] = [
	{ slug: "iphone-app-beta", date: "2026-10-24", audience: { unless: "iphone-app" } },
	{ slug: "link-articles-from-notes", date: "2026-10-21" },
	{ slug: "ask-your-own-assistant", date: "2026-10-21" },
]

/** Each entry's pages, by path: `./<slug>/<language>.html`. */
export const NEWS_PAGES: Record<string, string> = import.meta.glob<string>("./*/*.html", {
	query: "?raw",
	import: "default",
	eager: true,
})

export interface NewsEntry {
	/** Its address, `/news/<slug>`, and its name in the accounts that closed it: never change it. */
	slug: string
	/** The day it was published, `YYYY-MM-DD`. */
	date: string
	/** Who the sidebar shows it to; everyone when absent. `/news` lists every entry. */
	audience?: NewsAudience
}

export interface NewsAudience {
	/** Only in this browser on a computer: an extension for it, say. */
	browser?: DesktopBrowser
	/** Not to accounts that already did what it announces: `iphone-app`, signed in to the app. */
	unless?: "iphone-app"
}
