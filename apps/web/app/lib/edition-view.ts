/**
 * An edition snapshot as the public page shows it: every string already in the edition's language,
 * so the page needs no translations in the browser and reads the same whoever visits.
 */
import type { TFunction } from "i18next"
import type { EditionSnapshot } from "~/services/editions.server"
import { plainEditionText } from "./edition-text"
import { countWords, dayIn, formatEditionDate, markdownUrl } from "./editions"

type Translate = TFunction<"editions">

/**
 * How the page draws an item. It follows what the item holds, so the page varies as the reading
 * did; only the first goes by its place.
 * - `lead`: the first item, large, its image wider than the text.
 * - `feature`: the author's own words, a note or quotes; any image beside the title.
 * - `brief`: only the article's own words; one compact row, any image a thumbnail.
 */
export type ItemLayout = "lead" | "feature" | "brief"

/**
 * With no note, a first quote up to this long stands out, large. A longer one would fill the
 * screen.
 */
export const PULL_QUOTE_WORDS_MAX = 40

export function itemLayout(
	item: { note: string | null; highlights: readonly unknown[] },
	index: number,
): ItemLayout {
	if (index === 0) return "lead"
	return item.note || item.highlights.length > 0 ? "feature" : "brief"
}

export interface EditionItemView {
	/** `item-<position>`, from 1: where note links to this item go. */
	anchor: string
	layout: ItemLayout
	/** The first quote stands out, large: short enough, and no note before it. */
	pullQuote: boolean
	url: string
	/** Above the title, where each item starts: the site's name, else the address's host. */
	kicker: string | null
	title: string
	/** Author, reading time: those it has. */
	meta: string[]
	description: string | null
	leadImageUrl: string | null
	note: string | null
	highlights: Array<{ exact: string; note: string | null }>
}

/** A link to another edition of the author: "Previous edition", and its title. */
export interface EditionLink {
	label: string
	title: string
	href: string
}

export interface EditionView {
	locale: string
	/** The title, else the date. */
	title: string
	authorName: string
	/** Beside the author: the date, unless it is the title already. */
	date: string | null
	/** "Updated <date>", after an Update on a later day than the first publish. */
	updated: string | null
	intro: string | null
	items: EditionItemView[]
	/** Anchors by item address: a note link to another item of the edition goes to its anchor. */
	anchors: Record<string, string>
	madeWith: string
	/** The author's editions before and after this one, when the author links them. */
	previous: EditionLink | null
	next: EditionLink | null
	/** The footer's links, in the edition's language. */
	report: string
	terms: string
	privacy: string
}

/**
 * `publishedAt` is the first publish, the edition's date. The preview of a draft passes today. Call
 * it on the server: dates are formatted here.
 */
export function editionView(
	snapshot: EditionSnapshot,
	published: { publishedAt: Date; republishedAt: Date | null; timeZone: string },
	t: Translate,
	neighbors: {
		previous: { title: string; path: string } | null
		next: { title: string; path: string } | null
	} = { previous: null, next: null },
): EditionView {
	const { locale } = snapshot
	const { publishedAt, republishedAt, timeZone } = published
	const day = formatEditionDate(publishedAt, locale, timeZone)
	// Updated the day it came out, the edition's date says enough.
	const updated =
		republishedAt && dayIn(republishedAt, timeZone) !== dayIn(publishedAt, timeZone)
			? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(republishedAt)
			: null
	const anchors: Record<string, string> = {}
	snapshot.items.forEach((item, i) => {
		// Note links hold addresses with their parentheses escaped (`markdownUrl`).
		for (const url of [item.url, markdownUrl(item.url)]) anchors[url] ??= `item-${i + 1}`
	})
	return {
		locale,
		title: snapshot.title ?? day,
		authorName: snapshot.authorName,
		date: snapshot.title === null ? null : day,
		updated: updated ? t("public.updated", { date: updated }) : null,
		intro: snapshot.intro,
		items: snapshot.items.map((item, i) => {
			const kicker = siteOf(item)
			const meta = [
				// A site that is its own author says so once, above.
				item.author?.trim() === kicker ? null : item.author,
				item.readingMinutes ? t("public.minutes", { count: item.readingMinutes }) : null,
				// Not the day it was read: the snapshot keeps it (`readOn`), the page does not show it.
			].filter((part): part is string => Boolean(part?.trim()))
			const first = item.highlights[0]
			return {
				anchor: `item-${i + 1}`,
				layout: itemLayout(item, i),
				// With a note, the note speaks first and the quotes back it; without one, a quote does.
				pullQuote:
					!item.note && first !== undefined && countWords(first.exact) <= PULL_QUOTE_WORDS_MAX,
				url: item.url,
				kicker,
				title: item.title,
				meta,
				description: item.description,
				leadImageUrl: item.leadImageUrl,
				note: item.note,
				highlights: item.highlights,
			}
		}),
		anchors,
		previous: neighbors.previous
			? {
					label: t("public.previous"),
					title: neighbors.previous.title,
					href: neighbors.previous.path,
				}
			: null,
		next: neighbors.next
			? { label: t("public.next"), title: neighbors.next.title, href: neighbors.next.path }
			: null,
		madeWith: t("public.madeWith"),
		report: t("public.report"),
		terms: t("public.terms"),
		privacy: t("public.privacy"),
	}
}

/** Where an item comes from, as the page and the card name it: its site, else its address's host. */
export function siteOf(item: { siteName: string | null; url: string }): string | null {
	return item.siteName?.trim() || hostOf(item.url)
}

/** `https://www.example.com/a` is `example.com`. */
function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, "") || null
	} catch {
		return null
	}
}

const DESCRIPTION_MAX = 200

/** For link previews: the intro's first 200 characters, cut at a word, else the article count. */
export function editionDescription(snapshot: EditionSnapshot, t: Translate): string {
	const intro = snapshot.intro ? plainEditionText(snapshot.intro) : ""
	if (!intro) return t("public.articles", { count: snapshot.items.length })
	if (intro.length <= DESCRIPTION_MAX) return intro
	const cut = intro.slice(0, DESCRIPTION_MAX - 1)
	const space = cut.lastIndexOf(" ")
	return `${space > DESCRIPTION_MAX / 2 ? cut.slice(0, space) : cut}…`
}
