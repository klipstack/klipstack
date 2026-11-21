import { readFileSync } from "node:fs"
import { ExtractError, extractCapture } from "@klipstack/extract"
import { afterAll, describe, expect, it } from "vitest"
import { closeParsePool, parseCapture } from "./parse"

afterAll(closeParsePool)

const fixture = readFileSync(
	new URL("../../../packages/extract/test/fixtures/pages/theguardian-cancer.html", import.meta.url),
	"utf8",
)
const url = "https://www.theguardian.com/article"
const input = (body: string) => ({ body, servedHtml: null, url, contentType: "text/html" })

/** A page that keeps the parser busy far longer than any article: thousands of linked blocks. */
const block =
	'<div class="c"><p>A paragraph with <a href="/x">a link</a> and <em>some</em> words, repeated.</p><img src="/i.png"></div>'
const heavy = (bytes: number) =>
	`<!doctype html><html><head><title>Heavy</title></head><body><article>${block.repeat(Math.floor(bytes / block.length))}</article></body></html>`

describe("parseCapture", () => {
	it("parses on a thread as it would in process", async () => {
		const { article, used } = await parseCapture(input(fixture))
		const inProcess = await extractCapture({ html: fixture, url })
		expect(used).toBe("rendered")
		expect(article).toEqual(inProcess.article)
	})

	it("passes the extractor's refusal back as an ExtractError", async () => {
		const error = await parseCapture(input("<html><body><p>Sign in.</p></body></html>")).catch(
			(e: unknown) => e,
		)
		expect(error).toBeInstanceOf(ExtractError)
		expect(error).toMatchObject({ code: "no_content" })
	})

	it("stops a parse at its time limit as too_large, with the event loop free meanwhile", async () => {
		let ticks = 0
		const ticker = setInterval(() => ticks++, 50)
		const started = Date.now()
		const error = await parseCapture(input(heavy(256 * 1024)), { timeoutMs: 1_000 }).catch(
			(e: unknown) => e,
		)
		clearInterval(ticker)
		expect(error).toBeInstanceOf(ExtractError)
		expect(error).toMatchObject({ code: "too_large" })
		expect(Date.now() - started).toBeLessThan(5_000)
		expect(ticks).toBeGreaterThanOrEqual(10)
		// The next page gets a new thread.
		expect((await parseCapture(input(fixture))).article.title).toBeTruthy()
	})

	it("fails a page that needs more memory than a thread has as too_large, and carries on", async () => {
		const error = await parseCapture(input(heavy(1024 * 1024))).catch((e: unknown) => e)
		expect(error).toMatchObject({ code: "too_large", message: expect.stringContaining("memory") })
		expect((await parseCapture(input(fixture))).article.title).toBeTruthy()
	}, 60_000)

	it("stops when the job's signal aborts", async () => {
		const signal = AbortSignal.timeout(300)
		await expect(parseCapture(input(heavy(256 * 1024)), { signal })).rejects.toMatchObject({
			name: "TimeoutError",
		})
	})
})
