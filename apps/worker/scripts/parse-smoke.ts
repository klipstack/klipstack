import { closeParsePool, parseCapture } from "../src/parse"

/**
 * Parses a small page on a parse thread and exits 0: the image smoke test (scripts/image-smoke)
 * runs it, so a thread that cannot load its code in the production image fails before a release.
 */
const paragraph = "<p>A paragraph with enough words to read as an article body, repeated.</p>"
const { article } = await parseCapture({
	body: `<!doctype html><html><head><title>Smoke</title></head><body><article><h1>Smoke</h1>${paragraph.repeat(12)}</article></body></html>`,
	servedHtml: null,
	url: "https://example.com/smoke",
	contentType: "text/html",
})
await closeParsePool()
if (article.title !== "Smoke") throw new Error(`parsed the wrong title: ${article.title}`)
console.log(`parse thread ok: ${article.wordCount} words`)
