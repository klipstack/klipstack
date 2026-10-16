import { normalizeUrl, urlHash } from "@klipstack/extract"
import { JSDOM } from "jsdom"
import { env } from "./env.server"
import {
	STARTER_LANGUAGES,
	STARTER_TOPICS,
	type StarterLanguage,
	type StarterTopic,
} from "./starter-shelves"

export {
	isStarterLanguage,
	STARTER_LANGUAGES,
	STARTER_TOPICS,
	type StarterLanguage,
	type StarterTopic,
} from "./starter-shelves"

/**
 * Texts a reader can add to their library without finding one first: the guide to Klipstack, ours,
 * and short public-domain texts (essays, stories, speeches) in a few topics. Each ships with the app
 * as a page (`app/starter/`), saved as a capture, so adding one fetches nothing and works on any
 * server.
 *
 * A text keeps the address of the Wikisource page it comes from (the page's canonical link). The
 * guide's address is its public page on this server (`/guide/<language>`): a reader who has it
 * keeps their copy when the guide changes, and adding it again opens that copy.
 */

const GUIDE = "guide"
/** Per language and topic, in the order they are offered: shortest first. */
const TEXTS: Record<StarterLanguage, Record<StarterTopic, readonly string[]>> = {
	en: {
		reading: [
			"bacon-of-studies",
			"seneca-on-reading",
			"stevenson-books-influenced",
			"hazlitt-familiar-style",
			"thoreau-reading",
			"twain-cooper",
		],
		stories: [
			"chopin-story-of-an-hour",
			"ohenry-gift-of-the-magi",
			"poe-tell-tale-heart",
			"chekhov-rothschilds-fiddle",
		],
		living: ["marcus-aurelius-book-two", "stevenson-apology-for-idlers", "emerson-self-reliance"],
		science: [
			"darwin-earthworms",
			"huxley-method-of-zadig",
			"faraday-candle-lecture-one",
			"thoreau-walking",
		],
		society: [
			"lincoln-second-inaugural",
			"wollstonecraft-vindication-introduction",
			"douglass-fourth-of-july",
			"swift-modest-proposal",
		],
	},
	es: {
		reading: [
			"becquer-cartas-literarias",
			"feijoo-prologo-al-lector",
			"cervantes-prologo-quijote",
			"larra-quien-es-el-publico",
		],
		stories: [
			"dario-el-rey-burgues",
			"quiroga-la-gallina-degollada",
			"pardo-bazan-el-indulto",
			"clarin-adios-cordera",
		],
		living: ["balmes-la-atencion", "unamuno-mi-religion", "gracian-oraculo-manual", "rodo-ariel"],
		science: [
			"sastre-la-avispa-solitaria",
			"darwin-origen-de-las-especies",
			"holmberg-excursion-rio-lujan",
			"feijoo-astrologia-judiciaria",
		],
		society: [
			"arenal-la-mujer-del-porvenir",
			"bolivar-manifiesto-de-cartagena",
			"larra-vuelva-usted-manana",
			"marti-nuestra-america",
		],
	},
}

const pages = import.meta.glob<string>("../starter/**/*.html", {
	query: "?raw",
	import: "default",
	eager: true,
})

function page(path: string): string {
	const html = pages[`../starter/${path}.html`]
	if (!html) throw new Error(`No starter page at app/starter/${path}.html`)
	return html
}

export type StarterText = {
	/** `guide-en`, or the text's file name. */
	slug: string
	kind: "guide" | "text"
	language: StarterLanguage
	/** The shelf it is on; none for the guide. */
	topic: StarterTopic | null
	title: string
	author: string | null
	description: string | null
	minutes: number
	/** The address it is saved under. */
	url: string
	/** The whole page, as saved. */
	html: string
	/** Its article's markup, as the public page shows it. */
	article: string
}

const WORDS_PER_MINUTE = 230

/** The guide's public page; its address in libraries. */
export function guidePath(language: StarterLanguage) {
	return `/guide/${language}`
}

function starterText(
	slug: string,
	language: StarterLanguage,
	topic: StarterTopic | null,
	html: string,
): StarterText {
	const kind = topic ? "text" : "guide"
	const doc = new JSDOM(html).window.document
	const meta = (name: string) =>
		doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || null
	const title = doc.title.trim()
	if (!title) throw new Error(`The starter page ${slug} has no title`)
	const url =
		kind === "guide"
			? `${env.APP_URL}${guidePath(language)}`
			: doc.querySelector('link[rel="canonical"]')?.getAttribute("href")
	if (!url) throw new Error(`The starter page ${slug} has no canonical link`)
	const article = doc.querySelector("article")
	if (!article) throw new Error(`The starter page ${slug} has no article`)
	const words = (article.textContent ?? "").split(/\s+/).filter(Boolean).length
	return {
		slug,
		kind,
		language,
		topic,
		title,
		// The guide has no author of its own: the reader would show "Klipstack · Klipstack".
		author: meta("author") ?? (kind === "guide" ? "Klipstack" : null),
		description: meta("description"),
		minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
		url,
		html,
		article: article.innerHTML,
	}
}

let catalog: StarterText[] | null = null

/** Every starter text: per language, the guide and then the texts, topic by topic. */
export function starterTexts(): StarterText[] {
	catalog ??= STARTER_LANGUAGES.flatMap((language) => [
		starterText(`${GUIDE}-${language}`, language, null, page(`${GUIDE}/${language}`)),
		...STARTER_TOPICS.flatMap((topic) =>
			TEXTS[language][topic].map((slug) =>
				starterText(slug, language, topic, page(`texts/${slug}`)),
			),
		),
	])
	return catalog
}

export function findStarterText(slug: string): StarterText | null {
	return starterTexts().find((text) => text.slug === slug) ?? null
}

/** The guide in `language`. */
export function starterGuide(language: StarterLanguage): StarterText {
	return findStarterText(`${GUIDE}-${language}`)!
}

/** The texts in `language`, without the guide, topic by topic. */
export function starterTextsIn(language: StarterLanguage): StarterText[] {
	return starterTexts().filter((text) => text.language === language && text.kind === "text")
}

/** The hash a library finds the text by (`documents.url_hash`). */
export function starterUrlHash(text: StarterText): string {
	return urlHash(normalizeUrl(text.url))
}
