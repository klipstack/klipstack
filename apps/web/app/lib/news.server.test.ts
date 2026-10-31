import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import type { NewsEntry } from "../news"
import { allNews, feedArticle, loadNews, type NewsReader, sidebarNews } from "./news.server"

const page = (title: string, description = `${title}, in short.`) =>
	`<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}"></head><body><article><p>${title} in full.</p></article></body></html>`

function fixture(entries: NewsEntry[]) {
	const pages = Object.fromEntries(
		entries.flatMap(({ slug }) => [
			[`./${slug}/en.html`, page(`EN ${slug}`)],
			[`./${slug}/es.html`, page(`ES ${slug}`)],
		]),
	)
	return loadNews(entries, pages)
}

const reader = (over: Partial<NewsReader> = {}): NewsReader => ({
	createdAt: new Date("2026-01-01T00:00:00Z"),
	closed: [],
	browser: null,
	usesIphoneApp: async () => false,
	now: new Date("2026-10-24T12:00:00Z"),
	...over,
})
const slugs = async (entries: NewsEntry[], over: Partial<NewsReader> = {}) =>
	(await sidebarNews(fixture(entries), reader(over))).map((news) => news.slug)

describe("app/news", () => {
	it("has every entry's pages, in every language", () => {
		expect(() => allNews()).not.toThrow()
	})

	// The pages go into /news and the feed unsanitized: only text markup, links out by http(s), and
	// screenshots of the app's own, from `public/news-images/`, described.
	const TAGS = new Set([
		"P",
		"H2",
		"H3",
		"OL",
		"UL",
		"LI",
		"STRONG",
		"EM",
		"CODE",
		"A",
		"BR",
		"FIGURE",
		"IMG",
	])
	const IMG = ["alt", "class", "height", "loading", "src", "width"]
	it.each(
		allNews().flatMap((news) =>
			Object.entries(news.text).map(([lang, text]) => [`${news.slug}/${lang}`, text.article]),
		),
	)(
		"%s holds only text markup, links without scripts, and its own screenshots",
		(_page, article) => {
			for (const element of new JSDOM(article).window.document.body.querySelectorAll("*")) {
				expect(TAGS.has(element.tagName), element.tagName).toBe(true)
				const names = [...element.attributes].map((attribute) => attribute.name)
				const where = element.outerHTML.slice(0, 80)
				if (element.tagName === "IMG") {
					expect(
						names.every((name) => IMG.includes(name)),
						where,
					).toBe(true)
					const src = element.getAttribute("src") ?? ""
					expect(src).toMatch(/^\/news-images\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/)
					expect(
						existsSync(fileURLToPath(new URL(`../../public${src}`, import.meta.url))),
						src,
					).toBe(true)
					expect(element.getAttribute("alt")?.trim(), where).toBeTruthy()
					expect(["theme-light-only", "theme-dark-only", null]).toContain(
						element.getAttribute("class"),
					)
					expect(["lazy", null]).toContain(element.getAttribute("loading"))
					continue
				}
				expect(names, where).toEqual(element.tagName === "A" ? ["href"] : [])
				if (element.tagName === "A")
					expect(element.getAttribute("href")).toMatch(/^(https:\/\/|\/(?!\/))/)
			}
		},
	)
})

describe("loadNews", () => {
	it("reads each language's title, description and article, newest first", () => {
		const [newer, older] = fixture([
			{ slug: "older", date: "2026-09-01" },
			{ slug: "newer", date: "2026-10-01" },
		])
		expect(older!.slug).toBe("older")
		expect(newer!.date.toISOString()).toBe("2026-10-01T00:00:00.000Z")
		expect(newer!.text.es).toEqual({
			title: "ES newer",
			description: "ES newer, in short.",
			article: "<p>ES newer in full.</p>",
		})
	})

	it("refuses an entry missing a language, a description, or a real date, and a slug used twice", () => {
		const entry = { slug: "two-factor", date: "2026-10-01" }
		expect(() => loadNews([entry], { "./two-factor/en.html": page("Two") })).toThrow(/es\.html/)
		const noDescription = `<html><head><title>T</title></head><body><article>x</article></body></html>`
		expect(() =>
			loadNews([entry], {
				"./two-factor/en.html": noDescription,
				"./two-factor/es.html": noDescription,
			}),
		).toThrow(/description/)
		expect(() => fixture([{ slug: "two-factor", date: "2026-13-01" }])).toThrow(/date/)
		expect(() => fixture([entry, entry])).toThrow(/two-factor/)
	})
})

describe("sidebarNews", () => {
	it("shows the last 60 days' news, newest first", async () => {
		expect(
			await slugs([
				{ slug: "day-61", date: "2026-08-24" },
				{ slug: "day-60", date: "2026-08-25" },
				{ slug: "yesterday", date: "2026-10-23" },
			]),
		).toEqual(["yesterday", "day-60"])
	})

	it("leaves out news from before the account was made, and keeps the day it was made", async () => {
		const createdAt = new Date("2026-10-10T18:30:00Z")
		expect(
			await slugs(
				[
					{ slug: "day-before", date: "2026-10-09" },
					{ slug: "same-day", date: "2026-10-10" },
				],
				{ createdAt },
			),
		).toEqual(["same-day"])
	})

	it("leaves out what the reader closed", async () => {
		const entries = [
			{ slug: "kept", date: "2026-10-01" },
			{ slug: "closed", date: "2026-10-02" },
		]
		expect(await slugs(entries, { closed: ["closed"] })).toEqual(["kept"])
	})

	it("shows news for one browser in that browser only", async () => {
		const entries: NewsEntry[] = [
			{ slug: "safari", date: "2026-10-01", audience: { browser: "safari" } },
		]
		expect(await slugs(entries, { browser: "safari" })).toEqual(["safari"])
		expect(await slugs(entries, { browser: "firefox" })).toEqual([])
		expect(await slugs(entries, { browser: null })).toEqual([])
	})

	it("leaves out the iPhone app's news for an account that signed in to it, asking only when needed", async () => {
		const entries: NewsEntry[] = [
			{ slug: "iphone", date: "2026-10-01", audience: { unless: "iphone-app" } },
			{ slug: "other", date: "2026-10-02" },
		]
		expect(await slugs(entries, { usesIphoneApp: async () => true })).toEqual(["other"])
		expect(await slugs(entries, { usesIphoneApp: async () => false })).toEqual(["other", "iphone"])
		let asked = false
		const usesIphoneApp = async () => (asked = true)
		await slugs([{ slug: "other", date: "2026-10-02" }], { usesIphoneApp })
		expect(asked).toBe(false)
	})
})

describe("feedArticle", () => {
	it("keeps one screenshot, the light theme's, and gives images and links full addresses", () => {
		const article = `<p>Read <a href="/reading">it</a> or <a href="https://example.org/x">elsewhere</a>.</p><figure><img src="/news-images/a/en-light.webp" class="theme-light-only" alt="A"><img src="/news-images/a/en-dark.webp" class="theme-dark-only" alt="A"></figure>`
		const doc = new JSDOM(feedArticle(article, "https://klipstack.example")).window.document
		expect([...doc.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
			"https://klipstack.example/news-images/a/en-light.webp",
		])
		expect([...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
			"https://klipstack.example/reading",
			"https://example.org/x",
		])
	})
})
