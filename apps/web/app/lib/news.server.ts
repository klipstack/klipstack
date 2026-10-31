import { fallbackLanguage, isLocale, type Locale, supportedLanguages } from "@klipstack/i18n"
import { JSDOM } from "jsdom"
import { NEWS, NEWS_PAGES, type NewsAudience, type NewsEntry } from "../news"
import { env } from "./env.server"
import type { DesktopBrowser } from "./extension-url"

/** An entry of `app/news/`, with its text in every language. */
export interface News {
	slug: string
	/** The day it was published, at midnight UTC. */
	date: Date
	audience: NewsAudience
	text: Record<Locale, NewsText>
}

export interface NewsText {
	title: string
	/** One or two sentences: the sidebar card's line, the share image's, the feed's summary. */
	description: string
	/** The `<article>`'s markup, as `/news/<slug>` shows it. */
	article: string
}

const DATE = /^\d{4}-\d\d-\d\d$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function text(pages: Record<string, string>, slug: string, language: Locale): NewsText {
	const html = pages[`./${slug}/${language}.html`]
	if (!html) throw new Error(`The news ${slug} has no app/news/${slug}/${language}.html`)
	const doc = new JSDOM(html).window.document
	const title = doc.title.trim()
	const description =
		doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? ""
	const article = doc.querySelector("article")
	if (!title || !description || !article)
		throw new Error(`app/news/${slug}/${language}.html needs a title, a description and an article`)
	return { title, description, article: article.innerHTML }
}

/**
 * Every entry of `entries`, with its text from `pages` (`NEWS_PAGES`), newest first. Throws on an
 * entry without all its parts, so a deploy without them fails its tests.
 */
export function loadNews(entries: readonly NewsEntry[], pages: Record<string, string>): News[] {
	const slugs = new Set<string>()
	return entries
		.map((entry) => {
			if (!SLUG.test(entry.slug) || slugs.has(entry.slug))
				throw new Error(`The news slug ${entry.slug} is not a new kebab-case name`)
			slugs.add(entry.slug)
			const date = new Date(`${entry.date}T00:00:00Z`)
			if (!DATE.test(entry.date) || Number.isNaN(date.getTime()))
				throw new Error(`The news ${entry.slug} has no YYYY-MM-DD date`)
			return {
				slug: entry.slug,
				date,
				audience: entry.audience ?? {},
				text: Object.fromEntries(
					supportedLanguages.map((language) => [language, text(pages, entry.slug, language)]),
				) as Record<Locale, NewsText>,
			}
		})
		.sort((a, b) => b.date.getTime() - a.date.getTime() || a.slug.localeCompare(b.slug))
}

/**
 * An entry's article for feed readers, which have no stylesheet: without the screenshots for the
 * dark theme (`theme-dark-only`), and with images and links at full addresses on `origin`.
 */
export function feedArticle(article: string, origin: string): string {
	const doc = new JSDOM(`<article>${article}</article>`).window.document
	const root = doc.querySelector("article")!
	for (const el of root.querySelectorAll(".theme-dark-only")) el.remove()
	for (const [selector, attribute] of [
		["img[src]", "src"],
		["a[href]", "href"],
	] as const)
		for (const el of root.querySelectorAll(selector))
			el.setAttribute(attribute, new URL(el.getAttribute(attribute)!, origin).href)
	return root.innerHTML
}

let loaded: News[] | null = null
/** Klipstack's news (`app/news/`), newest first. */
export function allNews(): News[] {
	loaded ??= loadNews(NEWS, NEWS_PAGES)
	return loaded
}

export function findNews(slug: string): News | null {
	return allNews().find((news) => news.slug === slug) ?? null
}

/** An entry's text in `locale`, or in English. */
export function newsText(news: News, locale: unknown): NewsText {
	return news.text[isLocale(locale) ? locale : fallbackLanguage]
}

/** How long the sidebar shows an entry after it is published. */
export const NEWS_SIDEBAR_DAYS = 60
const DAY = 24 * 60 * 60 * 1000
/** Midnight UTC of `date`'s day: entries are dated by day. */
const dayOf = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

/** Who is reading: what the sidebar's choice of news depends on. */
export interface NewsReader {
	/** When the account was made: news from before then is not news to it. */
	createdAt: Date
	/** The entries closed or opened from the sidebar (`newsClosed`). */
	closed: readonly string[]
	/** The browser on a computer this page was asked for in; null on a phone or in another one. */
	browser: DesktopBrowser | null
	/** Whether the account has signed in to the iPhone app; asked only when an entry depends on it. */
	usesIphoneApp: () => Promise<boolean>
	now: Date
}

/**
 * The news the sidebar shows `reader`, newest first: published on or after the day the account
 * was made, in the last `NEWS_SIDEBAR_DAYS`, not closed, and for them (`audience`).
 */
export async function sidebarNews(news: readonly News[], reader: NewsReader): Promise<News[]> {
	const joined = dayOf(reader.createdAt)
	const since = dayOf(reader.now) - NEWS_SIDEBAR_DAYS * DAY
	const candidates = news.filter(
		(entry) =>
			entry.date.getTime() >= joined &&
			entry.date.getTime() >= since &&
			!reader.closed.includes(entry.slug) &&
			(!entry.audience.browser || entry.audience.browser === reader.browser),
	)
	const usesApp = candidates.some((entry) => entry.audience.unless === "iphone-app")
		? await reader.usesIphoneApp()
		: false
	return candidates.filter((entry) => !(entry.audience.unless === "iphone-app" && usesApp))
}

/**
 * An address on `/news` in `locale`: English's has no `lng`, so a link shared in Spanish opens,
 * and previews, in Spanish.
 */
export function newsUrl(path: string, locale: Locale, query: Record<string, string> = {}): string {
	const params = new URLSearchParams({
		...(locale === fallbackLanguage ? {} : { lng: locale }),
		...query,
	}).toString()
	return `${env.APP_URL}/news${path}${params ? `?${params}` : ""}`
}

/** "October 22, 2026": the day an entry was published, in `locale`. */
export function newsDate(news: News, locale: Locale): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(news.date)
}

/** The language a `/news` page is in: the reader's, or English. */
export function newsLocale(language: string | undefined): Locale {
	return isLocale(language) ? language : fallbackLanguage
}
