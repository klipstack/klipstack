import { topicsNamedIn } from "@klipstack/api-contract/search-query"
import {
	type ArticleSummary,
	type KlipstackClient,
	KlipstackApiError,
	type Topic,
} from "@klipstack/sdk"
import { dateLocale, errorMessage, t } from "./i18n"

/**
 * The Topics screen's pure parts, as the web's Topics page draws them (apps/web/app/routes/
 * topics.tsx): each topic a shelf of book spines, one per article, and what the reader's topics
 * are waiting for. The screen is `app/(tabs)/library/topics/index.tsx`.
 */

/** `GET /topics`. */
export type TopicsAnswer = Awaited<ReturnType<KlipstackClient["topics"]["list"]>>

/** A phone's shelf holds this many books, as the web's on a phone: the last says how many more. */
export const PHONE_SHELF = 12

/** The books on a topic's shelf, newest first, and how many more it holds than fit. */
export function phoneShelf(topic: Topic): { books: ArticleSummary[]; more: number } {
	const latest = topic.latest ?? []
	const full = topic.articles > PHONE_SHELF
	const books = full ? latest.slice(0, PHONE_SHELF - 1) : latest.slice(0, PHONE_SHELF)
	return { books, more: Math.max(0, topic.articles - books.length) }
}

/** A small, stable number for a text: a book keeps its height and color from one visit to the next. */
export function hash(text: string) {
	let h = 7
	for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
	return h
}

// The web's book colors (app.css): --k-book-l and --k-book-c, in light and dark.
const BOOK = { light: { l: 0.8, c: 0.055 }, dark: { l: 0.46, c: 0.06 } }

/** A site's hue, one of twelve: its books on the shelves and its articles' covers share it. */
export function siteHue(site: string): number {
	return (hash(site) % 12) * 30
}

/** A book's paint at this hue, light or dark: the shelves' spines, the covers and the drawings. */
export function bookColor(hue: number, scheme: "light" | "dark"): string {
	const { l, c } = BOOK[scheme]
	return oklchHex(l, c, hue)
}

const WORDS_PER_MINUTE = 230
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface Spine {
	label: string
	/** In points: thicker for a longer read. */
	width: number
	height: number
	color: string
	/** Saved in the last seven days: a blue top. */
	recent: boolean
}

/**
 * An article as a book's spine, as the web's phone shelf draws it: thicker for a longer read,
 * colored by its site, a little taller or shorter by its id.
 */
export function spine(article: ArticleSummary, scheme: "light" | "dark", now: Date): Spine {
	const words = Math.max(200, (article.readingMinutes ?? 4) * WORDS_PER_MINUTE)
	const k = Math.min(1, Math.max(0, (Math.log10(words) - 2.5) / 1.6))
	const { l, c } = BOOK[scheme]
	return {
		label: article.title ?? article.site ?? t("home.topicShelves.untitled"),
		width: Math.round(14 + k * 6),
		height: 92 + (hash(article.id) % 30),
		color: oklchHex(l, c, siteHue(article.site ?? article.id)),
		recent: now.getTime() - new Date(article.savedAt).getTime() < WEEK_MS,
	}
}

/** An oklch color (CSS Color 4) as sRGB hex, clipped to the gamut: React Native has no oklch. */
export function oklchHex(l: number, c: number, h: number): string {
	const a = c * Math.cos((h * Math.PI) / 180)
	const b = c * Math.sin((h * Math.PI) / 180)
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	const linear = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	]
	return `#${linear
		.map((v) => {
			const x = Math.min(1, Math.max(0, v))
			const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
			return Math.round(srgb * 255)
				.toString(16)
				.padStart(2, "0")
		})
		.join("")}`
}

export function articles(n: number): string {
	return t("home.topicShelves.articles", { count: n })
}

/**
 * What the screen says while the reader waits for topics, or above the shelves: how far the first
 * topics are, and whether the library is being sorted. Null when there is nothing to say, and for
 * the stages the screen shows in full (off, proposed).
 */
export function topicsNotice(
	answer: TopicsAnswer,
	locale = dateLocale,
): { title?: string; body: string } | null {
	switch (answer.stage) {
		case "unavailable":
		case "off":
		case "proposed":
			return null
		case "waiting": {
			const { count, needed } = answer.progress ?? { count: 0, needed: 0 }
			return {
				title: t("home.topicShelves.waiting.title"),
				body: t("home.topicShelves.waiting.body", { needed, count }),
			}
		}
		case "proposing":
			return {
				title: t("home.topicShelves.proposing.title"),
				body: t("home.topicShelves.proposing.body"),
			}
		case "active": {
			const sorting = answer.sorting ?? 0
			const waiting = t("home.topicShelves.articlesWaiting", { count: sorting })
			if (answer.sortingPaused && sorting > 0) {
				const { resumesAt, max } = answer.sortingPaused
				if (!resumesAt) return { body: t("home.topicShelves.sortsOff", { waiting }) }
				const date = new Intl.DateTimeFormat(locale, {
					month: "long",
					day: "numeric",
					timeZone: "UTC",
				}).format(new Date(resumesAt))
				const sorted =
					max === undefined
						? ""
						: t("home.topicShelves.sorted", { max: new Intl.NumberFormat(locale).format(max) })
				return { body: t("home.topicShelves.paused", { sorted, waiting, date }) }
			}
			if (sorting > 0)
				return {
					body: t("home.topicShelves.sorting", { count: sorting }),
				}
			if (answer.items.length === 0) return { body: t("home.topicShelves.empty") }
			return null
		}
	}
}

/** The first topics as the reader leaves them: kept or not, and the name in each one's field. */
export type ProposalEdits = Record<string, { kept: boolean; name: string }>

/**
 * What confirming sends, as the web's form does: the kept topics only, each with the name in its
 * field; an empty field keeps the proposed name.
 */
export function confirmation(
	proposed: { id: string }[],
	edits: ProposalEdits,
): { id: string; name?: string }[] {
	return proposed.flatMap(({ id }) => {
		const edit = edits[id]
		if (edit && !edit.kept) return []
		const name = edit?.name.trim()
		return [name ? { id, name } : { id }]
	})
}

/**
 * Turning topics off deletes them, so the app asks first, as the web asks for a second tap; and
 * says which saved searches name topics, which would find nothing in them.
 */
export function turnOffQuestion(savedSearches: { name: string; query: string }[]): string {
	const naming = savedSearches.filter((s) => topicsNamedIn(s.query).length > 0).map((s) => s.name)
	const base = t("home.topicShelves.turnOff")
	if (!naming.length) return base
	const names = naming.map((name) => t("home.topicShelves.quoted", { name })).join(", ")
	return `${base} ${t("home.topicShelves.turnOffSaved", { count: naming.length, names })}`
}

/** A refused topic change in the reader's words, as the web's toasts say them. */
export function topicRefusal(e: unknown): string {
	const code = e instanceof KlipstackApiError ? e.code : null
	switch (code) {
		case "name_taken":
			return t("home.topicShelves.refusal.nameTaken")
		case "invalid_request":
			return t("home.topicShelves.refusal.invalidName")
		case "not_found":
			return t("home.topicShelves.refusal.notFound")
		case "already_done":
			return t("home.topicShelves.refusal.alreadyDone")
		case "forbidden":
			return t("home.topicShelves.refusal.forbidden")
		case "unavailable":
			return t("home.topicShelves.refusal.unavailable")
		default:
			return errorMessage(e)
	}
}

/**
 * Whether the server is on it, so the screen asks again now and then, as the web's page does:
 * the first topics being proposed, or the library being sorted (not paused for the month).
 */
export function topicsBusy(answer: TopicsAnswer): boolean {
	if (answer.stage === "proposing") return true
	return answer.stage === "active" && (answer.sorting ?? 0) > 0 && !answer.sortingPaused
}
