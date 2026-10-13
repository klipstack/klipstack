import type { ArticleSummary, KlipstackClient, Topic } from "@klipstack/sdk"

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
function hash(text: string) {
	let h = 7
	for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
	return h
}

// The web's book colors (app.css): --k-book-l and --k-book-c, in light and dark.
const BOOK = { light: { l: 0.8, c: 0.055 }, dark: { l: 0.46, c: 0.06 } }

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
		label: article.title ?? article.site ?? "Untitled",
		width: Math.round(14 + k * 6),
		height: 92 + (hash(article.id) % 30),
		color: oklchHex(l, c, (hash(article.site ?? article.id) % 12) * 30),
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
	return n === 1 ? "1 article" : `${n} articles`
}

/**
 * What the screen says above the shelves, or in their place: where the reader's topics are, and,
 * for what only the web does (turning topics on, confirming the first ones), that it is there.
 * Null when there is nothing to say.
 */
export function topicsNotice(
	answer: TopicsAnswer,
	locale?: string,
): { title?: string; body: string; web: boolean } | null {
	switch (answer.stage) {
		case "unavailable":
			return null
		case "off":
			return {
				title: "Set up topics on the web",
				body: "Topics sort what you save into shelves on their own, like a bookstore's sections. Turn them on in Klipstack on the web; they show here once they are set up.",
				web: true,
			}
		case "waiting": {
			const { count, needed } = answer.progress ?? { count: 0, needed: 0 }
			return {
				title: "Keep reading",
				body: `Your first topics come when you have saved ${needed} articles: ${count} of ${needed} so far.`,
				web: false,
			}
		}
		case "proposing":
			return {
				title: "Proposing your first topics…",
				body: "This takes a minute or so.",
				web: false,
			}
		case "proposed": {
			const names = (answer.proposed ?? []).map((t) => t.name)
			return {
				title: "Your first topics are ready",
				body: `${names.length ? `${names.join(", ")}. ` : ""}Look them over and confirm them in Klipstack on the web; they show here after that.`,
				web: true,
			}
		}
		case "active": {
			const sorting = answer.sorting ?? 0
			const waiting = sorting === 1 ? "1 article is waiting" : `${sorting} articles are waiting`
			if (answer.sortingPaused && sorting > 0) {
				const resumesAt = answer.sortingPaused.resumesAt
				if (!resumesAt)
					return { body: `This server sorts no articles into topics: ${waiting}.`, web: false }
				const date = new Intl.DateTimeFormat(locale, {
					month: "long",
					day: "numeric",
					timeZone: "UTC",
				}).format(new Date(resumesAt))
				return {
					body: `Sorting stopped for this month: ${waiting}, and sorting starts again on ${date}. Nothing is lost.`,
					web: false,
				}
			}
			if (sorting > 0)
				return {
					body: `Sorting your library into its topics: ${sorting === 1 ? "1 article" : `${sorting} articles`} to go.`,
					web: false,
				}
			if (answer.items.length === 0)
				return {
					body: "No topics right now. New ones appear as you save more articles.",
					web: false,
				}
			return null
		}
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
