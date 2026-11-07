import { describe, expect, it, vi } from "vitest"
import type { Extractor } from "../src/extractors/types"
import { extractArticle, extractCapture } from "../src/pipeline"

const prose = Array.from(
	{ length: 12 },
	(_, i) =>
		`<p>Paragraph ${i} with enough words to look like real article prose for the tests.</p>`,
).join("")

describe("extractArticle", () => {
	it("logs a failed extractor by host, name and frames, and uses the next one", async () => {
		const broken: Extractor = {
			name: "broken",
			version: "1",
			async extract() {
				throw new TypeError("cannot read secret page text")
			},
		}
		const plain: Extractor = {
			name: "plain",
			version: "1",
			async extract(doc) {
				return { contentHtml: doc.body.innerHTML }
			},
		}
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
		const article = await extractArticle({
			html: `<!doctype html><title>Post</title><body>${prose}</body>`,
			url: "https://example.com/secret/path?token=secret",
			extractors: [broken, plain],
		})
		const lines = spy.mock.calls.map((args) => args.join(" "))
		spy.mockRestore()
		expect(article.extractor.name).toBe("plain")
		expect(lines).toHaveLength(1)
		expect(lines[0]).toMatch(/^\[extract\] broken failed on example\.com: TypeError\n {4}at /)
		expect(lines[0]).not.toContain("secret")
	})
})

describe("extractCapture", () => {
	const url = "https://example.com/story"
	const page = (paragraphs: number, extra = "") =>
		`<!doctype html><title>Story</title><body><article><h1>Story</h1>${Array.from(
			{ length: paragraphs },
			(_, i) =>
				`<p>Paragraph ${i} of the story, with enough words to look like real article prose.</p>`,
		).join("")}${extra}</article></body>`

	it("keeps the page as served when the rendered one was cut short", async () => {
		const { article, used } = await extractCapture({ html: page(4), servedHtml: page(40), url })
		expect(used).toBe("served")
		expect(article.text).toContain("Paragraph 39 of the story")
	})

	it("keeps the served page from a quarter more words, and the rendered page below", async () => {
		// Each paragraph is the same number of words: 25 against 20 is exactly a quarter more.
		expect((await extractCapture({ html: page(20), servedHtml: page(25), url })).used).toBe(
			"served",
		)
		expect((await extractCapture({ html: page(20), servedHtml: page(24), url })).used).toBe(
			"rendered",
		)
	})

	it("keeps the rendered page when the served one is not clearly longer", async () => {
		// The served page has a few more words (a block scripts later removed, say): not a paywall.
		const extra = "<p>One more paragraph that the scripts removed from the page later on.</p>"
		const { article, used } = await extractCapture({
			html: page(20),
			servedHtml: page(22, extra),
			url,
		})
		expect(used).toBe("rendered")
		expect(article.text).not.toContain("scripts removed")
	})

	it("keeps the rendered page when the served one has more but is an empty shell", async () => {
		const shell = `<!doctype html><title>App</title><body><div id="root"></div></body>`
		const { used } = await extractCapture({ html: page(20), servedHtml: shell, url })
		expect(used).toBe("rendered")
	})

	it("keeps the served page when nothing could be read from the rendered one", async () => {
		const blank = `<!doctype html><title>Story</title><body><p>Subscribe to read.</p></body>`
		const { used } = await extractCapture({ html: blank, servedHtml: page(20), url })
		expect(used).toBe("served")
	})

	it("fails as the rendered page fails when neither has an article", async () => {
		const blank = `<!doctype html><body><p>Nothing here.</p></body>`
		await expect(extractCapture({ html: blank, servedHtml: blank, url })).rejects.toMatchObject({
			code: "no_content",
		})
	})

	it("reads the rendered page alone without a served one", async () => {
		const { used } = await extractCapture({ html: page(20), url })
		expect(used).toBe("rendered")
	})
})

describe("the article's language", () => {
	const url = "https://example.com/story"
	const page = (lang: string | null, paragraphs: string[]) =>
		`<!doctype html><html${lang ? ` lang="${lang}"` : ""}><title>Story</title><body><article><h1>Story</h1>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</article></body></html>`
	const spanish = [
		"Cada vez me parece más claro que en la industria de la inteligencia artificial está ocurriendo algo muy absurdo.",
		"Por un lado, el mundo tecnológico debate a diario cuándo estallará la burbuja y si las inversiones se podrán recuperar.",
		"Por otro lado, muchísimas empresas tradicionales todavía no tienen claro qué problemas concretos puede resolverles.",
	]
	const french = [
		"Je pense de plus en plus que quelque chose de vraiment absurde se passe dans l'industrie de l'intelligence artificielle.",
		"D'un côté, le monde de la technologie se demande chaque jour quand la bulle va éclater et si les investissements seront rentables.",
		"De l'autre, beaucoup d'entreprises traditionnelles ne savent toujours pas quels problèmes elle pourrait résoudre pour elles.",
	]

	it("comes from the text when the page's tag says otherwise", async () => {
		expect((await extractArticle({ html: page("en", spanish), url })).language).toBe("es")
	})

	it("comes from the text when the page has no tag", async () => {
		expect((await extractArticle({ html: page(null, french), url })).language).toBe("fr")
	})

	it("is the page's tag when the text is in a language detection doesn't know", async () => {
		// Esperanto: franc knows it, the languages detection answers don't include it.
		const esperanto = [
			"Mi pli kaj pli sentas, ke io vere absurda okazas en la industrio de artefarita inteligenteco nuntempe.",
			"Unuflanke, la teknologia mondo ĉiutage diskutas, kiam la veziko krevos kaj ĉu la investoj iam revenos.",
			"Aliflanke, multaj tradiciaj entreprenoj ankoraŭ ne komprenas, kiujn problemojn ĝi povus solvi por ili.",
		]
		expect((await extractArticle({ html: page("eo", esperanto), url })).language).toBe("eo")
	})
})
