import { normalizeUrl, urlHash } from "@klipstack/extract"
import { JSDOM } from "jsdom"
import { env } from "./env.server"

/**
 * Texts a reader can add to their library without finding one first: the guide to Klipstack, ours,
 * and short public-domain essays on reading and writing. Each ships with the app as a page
 * (`app/starter/`), saved as a capture, so adding one fetches nothing and works on any server.
 *
 * An essay keeps the address of the Wikisource page it comes from (the page's canonical link). The
 * guide's address is its public page on this server (`/guide/<language>`): a reader who has it
 * keeps their copy when the guide changes, and adding it again opens that copy.
 */

export const STARTER_LANGUAGES = ["en", "es"] as const
export type StarterLanguage = (typeof STARTER_LANGUAGES)[number]

/** In the order they are offered: the guide, then the essays, shortest first. */
const GUIDE = "guide"
const ESSAYS: Record<StarterLanguage, readonly string[]> = {
	en: [
		"bacon-of-studies",
		"seneca-on-reading",
		"stevenson-books-influenced",
		"hazlitt-familiar-style",
		"thoreau-reading",
		"twain-cooper",
	],
	es: [
		"becquer-cartas-literarias",
		"feijoo-prologo-al-lector",
		"cervantes-prologo-quijote",
		"larra-quien-es-el-publico",
	],
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
	/** `guide-en`, or the essay's file name. */
	slug: string
	kind: "guide" | "essay"
	language: StarterLanguage
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
	kind: StarterText["kind"],
	language: StarterLanguage,
	html: string,
): StarterText {
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

/** Every starter text: per language, the guide and then the essays. */
export function starterTexts(): StarterText[] {
	catalog ??= STARTER_LANGUAGES.flatMap((language) => [
		starterText(`${GUIDE}-${language}`, "guide", language, page(`${GUIDE}/${language}`)),
		...ESSAYS[language].map((slug) => starterText(slug, "essay", language, page(`texts/${slug}`))),
	])
	return catalog
}

export function findStarterText(slug: string): StarterText | null {
	return starterTexts().find((text) => text.slug === slug) ?? null
}

/** The texts in the reader's language first, then the rest. */
export function starterTextsFor(language: string): StarterText[] {
	const texts = starterTexts()
	return [
		...texts.filter((text) => text.language === language),
		...texts.filter((text) => text.language !== language),
	]
}

/** The hash a library finds the text by (`documents.url_hash`). */
export function starterUrlHash(text: StarterText): string {
	return urlHash(normalizeUrl(text.url))
}
