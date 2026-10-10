import { readFileSync } from "node:fs"
import { join } from "node:path"
import { canonicalText } from "@klipstack/anchor"
import { JSDOM } from "jsdom"
import { describe, expect, it } from "vitest"
import { extractArticle } from "../src/pipeline"
import { fixtures } from "./fixtures/manifest"

const norm = (s: string) =>
	s
		.replace(/\s+/g, " ")
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.trim()
		.toLowerCase()

const results = new Map<string, Awaited<ReturnType<typeof extractArticle>>>()
async function run(file: string, url: string) {
	const cached = results.get(file)
	if (cached) return cached
	const html = readFileSync(join(import.meta.dirname, "fixtures/pages", file), "utf8")
	const article = await extractArticle({ html, url })
	results.set(file, article)
	return article
}

describe("extraction corpus", () => {
	for (const fx of fixtures) {
		describe(fx.file, () => {
			it("extracts an article with sane metadata", async () => {
				const a = await run(fx.file, fx.url)
				expect(a.title.length).toBeGreaterThan(3)
				if (fx.title) expect(a.title.toLowerCase()).toContain(fx.title.toLowerCase())
				expect(a.wordCount).toBeGreaterThanOrEqual(fx.minWords)
				expect(a.readingMinutes).toBeGreaterThanOrEqual(1)
				expect(["defuddle", "readability"]).toContain(a.extractor.name)
			})

			it("keeps the expected passages in the canonical text", async () => {
				const a = await run(fx.file, fx.url)
				const text = norm(a.text)
				for (const q of fx.quotes) expect(text, `missing quote: ${q}`).toContain(norm(q))
				for (const junk of fx.mustNotContain ?? [])
					expect(text, `page chrome leaked: ${junk}`).not.toContain(norm(junk))
			})

			it("is mostly prose, not navigation", async () => {
				const a = await run(fx.file, fx.url)
				const body = new JSDOM(`<!doctype html><body>${a.html}</body>`).window.document.body
				const total = (body.textContent ?? "").replace(/\s+/g, " ").trim().length
				let linkText = 0
				for (const link of Array.from(body.querySelectorAll("a")))
					linkText += (link.textContent ?? "").replace(/\s+/g, " ").trim().length
				expect(linkText / Math.max(1, total), "link density").toBeLessThan(0.35)
				expect(body.querySelector("nav, header, footer")).toBeNull()
			})

			it("produces safe, self-contained HTML", async () => {
				const a = await run(fx.file, fx.url)
				const body = new JSDOM(`<!doctype html><body>${a.html}</body>`).window.document.body
				expect(
					body.querySelector("script, iframe, style, object, embed, form, svg, h1, link, meta"),
				).toBeNull()
				for (const el of Array.from(body.querySelectorAll("*"))) {
					for (const attr of Array.from(el.attributes)) {
						expect(attr.name, `${el.tagName} has ${attr.name}`).not.toMatch(/^(on|style$)/i)
						if (attr.name === "href" || attr.name === "src") {
							expect(attr.value, `${el.tagName} ${attr.name}=${attr.value}`).toMatch(
								/^(https?:\/\/|#|mailto:)/,
							)
						}
					}
				}
				// Canonical text must round-trip through innerHTML unchanged (offset stability).
				expect(canonicalText(body)).toBe(a.text)
			})
		})
	}

	it("summary snapshot", async () => {
		const summary: Record<string, unknown> = {}
		for (const fx of fixtures) {
			const a = await run(fx.file, fx.url)
			summary[fx.file] = {
				title: a.title,
				author: a.author,
				siteName: a.siteName,
				language: a.language,
				publishedAt: a.publishedAt?.toISOString().slice(0, 10) ?? null,
				leadImage: Boolean(a.leadImageUrl),
				wordCount: Math.round(a.wordCount / 100) * 100,
				extractor: a.extractor.name,
				candidates: a.candidates,
			}
		}
		await expect(JSON.stringify(summary, null, 2)).toMatchFileSnapshot(
			"./__snapshots__/summary.json",
		)
	})
})
