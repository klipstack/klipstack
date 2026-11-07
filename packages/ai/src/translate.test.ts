import { describe, expect, it } from "vitest"
import { AiError, createAi, tagShape } from "./index"

/** Anthropic's (non-streamed) answer with this text. */
function message(text: string) {
	return new Response(
		JSON.stringify({
			id: "m",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-5-5",
			content: [{ type: "text", text }],
			stop_reason: "end_turn",
			usage: { input_tokens: 40, output_tokens: 30 },
		}),
		{ headers: { "content-type": "application/json" } },
	)
}

/** A provider answering each request with the next of `answers` for parts, and a fixed head. */
function provider(answers: string[]) {
	const asked: { model: string; system?: unknown; text: string }[] = []
	const fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body))
		const text = body.messages
			.at(-1)
			.content.map((c: { text: string }) => c.text)
			.join("")
		asked.push({ model: body.model, system: body.system, text })
		if (text.startsWith("Translate this article's title"))
			return message('{"title": "Two questions", "description": null}')
		return message(answers.shift() ?? "")
	}) as typeof globalThis.fetch
	return { ai: createAi({ anthropicApiKey: "test", fetch }), asked }
}

const part = '<p>泡沫可以<a href="https://example.com/a" title="说明">破裂</a>。</p>'
const input = { parts: [part], title: "两个问题", description: null, from: "zh", to: "en" as const }

describe("tagShape", () => {
	it("keeps tags, their order and their attributes, but not the title and alt text", () => {
		expect(tagShape(part)).toEqual(
			tagShape('<p>A bubble can <a href="https://example.com/a" title="Note">burst</a>.</p>'),
		)
		expect(tagShape(part)).not.toEqual(
			tagShape('<p>A bubble can <a href="https://example.com/b" title="说明">burst</a>.</p>'),
		)
		expect(tagShape(part)).not.toEqual(tagShape("<p>A bubble can burst.</p>"))
	})

	it("reads a > inside a quoted value as part of its tag, so no attribute hides after it", () => {
		const original = '<p>See <a id="cite-1">note 1</a> and <img src="/cat.png" alt="Un gato">.</p>'
		expect(
			tagShape(
				'<p>See <a id="cite-1" title=">" href="https://attacker.example/">note 1</a> and <img src="/cat.png" alt=">" srcset="https://attacker.example/p.png 1x">.</p>',
			),
		).not.toEqual(tagShape(original))
		expect(
			tagShape(
				'<p>See <a id="cite-1" title="a > b">note 1</a> and <img src="/cat.png" alt="A cat">.</p>',
			),
		).toEqual(tagShape(original))
	})

	it("lets plain inline formatting go, as a translation of French ordinals does", () => {
		const french =
			'<p>Au <abbr title="13ᵉ siècle" id="mw1"><span>XIII</span><sup id="mw2">e</sup></abbr> siècle, <a href="/k">le kipferl</a>.</p>'
		expect(tagShape(french)).toEqual(
			tagShape(
				'<p>In the <abbr title="13th century" id="mw1">13th</abbr> century, <a href="/k">the kipferl</a>.</p>',
			),
		)
		// What it points to, and its place, still matter.
		expect(tagShape(french)).not.toEqual(
			tagShape(
				'<p>In the <abbr title="13th century" id="mw1">13th</abbr> century, the kipferl.</p>',
			),
		)
		expect(tagShape(`${french}<img src="/k.jpg" alt="Un croissant">`)).toEqual(
			tagShape(
				'<p>In the 13th century, <a href="/k">the kipferl</a>.</p><img src="/k.jpg" alt="A croissant">',
			),
		)
		expect(tagShape(`${french}<img src="/k.jpg">`)).not.toEqual(tagShape(french))
	})
})

describe("translating an article", () => {
	it("asks Sonnet, naming both languages in the request, and gives back the parts and title", async () => {
		const translated = '<p>A bubble can <a href="https://example.com/a" title="Note">burst</a>.</p>'
		const { ai, asked } = provider([translated])
		const result = await ai.translate(input)
		expect(result.parts).toEqual([translated])
		expect(result.title).toBe("Two questions")
		expect(result.model).toBe("anthropic:claude-sonnet-5-5")
		expect(result.usage.outputTokens).toBe(60)
		const request = asked.find((a) => !a.text.startsWith("Translate this article's title"))!
		expect(request.model).toBe("claude-sonnet-5-5")
		// Haiku left Spanish untranslated when only the system prompt named it.
		expect(request.text).toMatch(/^Translate this part of an article from Chinese into English\./)
	})

	it("asks again for a part that came back with other tags, and fails when it keeps doing so", async () => {
		const good = '<p>A bubble can <a href="https://example.com/a" title="Note">burst</a>.</p>'
		const once = await provider(["<p>A bubble can burst.</p>", good]).ai.translate(input)
		expect(once.parts).toEqual([good])

		const never = provider(["<p>A bubble can burst.</p>", "<p>A bubble can burst.</p>", good])
		await expect(never.ai.translate(input)).rejects.toBeInstanceOf(AiError)
	})

	it("fakes a translation in the target language, with the same tags", async () => {
		const result = await createAi({ fake: true }).translate({ ...input, to: "es" })
		expect(tagShape(result.parts[0]!)).toEqual(tagShape(part))
		expect(result.parts[0]).toContain("este es")
		expect(result.title).toMatch(/^este/)
	})
})
