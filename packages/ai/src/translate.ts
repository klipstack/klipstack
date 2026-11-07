import type { LanguageModelV4CallOptions } from "@ai-sdk/provider"
import { generateText, type LanguageModel } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import type { TokenCounts } from "./cost"
import { FAKE_FAIL } from "./fake"
import { type AiConfig, languageModel, TIERS } from "./models"
import { AiError, type AiLanguage } from "./types"

export interface TranslateInput {
	/**
	 * The article's HTML in parts that each stand alone (whole paragraphs, lists, figures), in
	 * order: each part is one request, and comes back with the same tags.
	 */
	parts: string[]
	title: string
	description: string | null
	/** The original's language (ISO 639-1), when known. */
	from: string | null
	to: AiLanguage
	signal?: AbortSignal
}

export interface Translation {
	parts: string[]
	title: string
	description: string | null
	usage: TokenCounts
	/** `provider:model`. */
	model: string
}

/** Parts translated at once: a long article is a few dozen requests. */
const CONCURRENCY = 4
/** A part whose tags came back changed is asked once more. */
const ATTEMPTS = 2

const languageName = (code: string) =>
	new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code

function systemPrompt(to: AiLanguage) {
	const target = languageName(to)
	return `You translate articles saved in a read-it-later app into ${target}.
You receive part of an article as HTML. Translate all of its human-readable text faithfully and completely, in natural ${target} as a skilled human translator would write it.
Keep the author's tone and register. Do not add, drop, summarize or explain anything.
Keep numbers and amounts exact: work out what each one is worth before writing it, since languages group large numbers differently. Keep product names, brand names and the contents of <code> and <pre> as they are.
Keep every HTML tag exactly as given, with the same attributes, values, order and nesting; move inline tags with the words they wrap. Translate the values of title and alt attributes, and no other attribute.
Answer with only the translated HTML.`
}

/** The opening line of a request: the model is told the languages there too, or may not translate. */
const partPrompt = (input: TranslateInput, part: string) =>
	`Translate this part of an article ${input.from ? `from ${languageName(input.from)} ` : ""}into ${languageName(input.to)}.\n\n${part}`

const headPrompt = (input: TranslateInput) =>
	`Translate this article's title and description ${input.from ? `from ${languageName(input.from)} ` : ""}into ${languageName(input.to)}. Answer with only JSON: {"title": "...", "description": "..."}, with description null when it is null here.\n\n${JSON.stringify({ title: input.title, description: input.description })}`

/**
 * Inline formatting a translation may drop or add as the other language writes it: "XIII<sup>e</sup>
 * siècle" is "13th century". Only when it carries nothing but `NAMING` attributes, and their
 * closing tags.
 */
const FORMATTING = new Set([
	"abbr",
	"b",
	"em",
	"i",
	"s",
	"small",
	"span",
	"strong",
	"sub",
	"sup",
	"u",
])
/** What names or styles a tag without pointing anywhere: Wikipedia gives every tag an `id`. */
const NAMING = /^(id|class|lang|dir)$/

/**
 * One element's part of an article's shape: its name and attributes but `title` and `alt`, which
 * are translated; null for plain formatting (`FORMATTING`), which a translation may drop or add.
 * The AI's check (`tagShape`) and the worker's, on the parsed HTML, both use it.
 */
export function elementShape(name: string, attrs: [string, string][]): string | null {
	const kept = attrs
		.filter(([attr]) => !/^(title|alt)$/i.test(attr))
		.map(([attr, value]) => [attr.toLowerCase(), value])
	if (FORMATTING.has(name.toLowerCase()) && kept.every(([attr]) => NAMING.test(attr!))) return null
	// As JSON: a value can't pass for another attribute or element, whatever it holds.
	return JSON.stringify([name.toLowerCase(), kept])
}

/**
 * The tags of an HTML fragment, in order (`elementShape`, and closing tags but plain formatting's):
 * a translation must give back the same list. A quick check of each part, to ask again; the
 * worker checks the whole article, parsed, before it keeps it. A `>` inside a quoted value does
 * not end its tag.
 */
export function tagShape(html: string): string[] {
	const tags: string[] = []
	for (const [, close, tag, attrs] of html.matchAll(
		/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g,
	)) {
		const name = tag!.toLowerCase()
		if (close) {
			if (!FORMATTING.has(name)) tags.push(`/${name}`)
			continue
		}
		const shape = elementShape(
			name,
			Array.from(
				(attrs ?? "").matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g),
				([, attr, a, b, c]) => [attr!, a ?? b ?? c ?? ""] as [string, string],
			),
		)
		if (shape) tags.push(shape)
	}
	return tags
}

const withoutFence = (text: string) => {
	const trimmed = text.trim()
	const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(trimmed)
	return fenced ? fenced[1]!.trim() : trimmed
}

/**
 * Translates an article with the `translate` tier: its parts, then its title and description.
 * Throws `AiError` when the provider fails or a part keeps coming back with other tags.
 */
export async function translateArticle(
	config: AiConfig,
	input: TranslateInput,
): Promise<Translation> {
	const { model, name } = languageModel(config, "translate", () => fakeTranslator(input.to))
	const usage: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
	const ask = async (prompt: string, system?: string) => {
		try {
			const result = await generateText({
				model,
				system,
				prompt,
				maxOutputTokens: TIERS.translate.maxOutputTokens,
				abortSignal: input.signal,
				maxRetries: 2,
			})
			usage.inputTokens += result.usage.inputTokens ?? 0
			usage.outputTokens += result.usage.outputTokens ?? 0
			usage.cacheReadTokens += result.usage.inputTokenDetails?.cacheReadTokens ?? 0
			if (result.finishReason === "length")
				throw new AiError("provider", "The translation was cut off.")
			return withoutFence(result.text)
		} catch (error) {
			if (error instanceof AiError) throw error
			if (input.signal?.aborted)
				throw new AiError("aborted", "The translation was cancelled.", { cause: error })
			throw new AiError("provider", "The provider could not translate.", { cause: error })
		}
	}

	const system = systemPrompt(input.to)
	const translatePart = async (part: string) => {
		const shape = tagShape(part).join("\n")
		for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
			const out = await ask(partPrompt(input, part), system)
			if (tagShape(out).join("\n") === shape) return out
		}
		throw new AiError("provider", "The translation changed the article's markup.")
	}

	const parts: string[] = Array.from({ length: input.parts.length }, () => "")
	let next = 0
	const head = ask(headPrompt(input)).then((text) => {
		const parsed = JSON.parse(
			withoutFence(text)
				.replace(/^[^{]*/, "")
				.replace(/[^}]*$/, ""),
		)
		if (typeof parsed?.title !== "string" || !parsed.title.trim())
			throw new AiError("provider", "The translation came back without a title.")
		return {
			title: parsed.title.trim() as string,
			description:
				input.description && typeof parsed.description === "string"
					? (parsed.description.trim() as string) || null
					: null,
		}
	})
	head.catch(() => {})
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, input.parts.length) }, async () => {
			while (next < input.parts.length) {
				const index = next++
				parts[index] = await translatePart(input.parts[index]!)
			}
		}),
	)
	const { title, description } = await head
	return { parts, title, description, usage, model: name }
}

/** Words a fake translation writes, in each app language. */
const FAKE_WORDS: Record<AiLanguage, string[]> = {
	en: "this is the translated text that the tests read in place of the article".split(" "),
	es: "este es el texto traducido que las pruebas leen en lugar del artículo".split(" "),
}

/** The same number of words, in the target language, from the fixed list. */
function fakeWords(text: string, to: AiLanguage) {
	const segments = new Intl.Segmenter("und", { granularity: "word" }).segment(text)
	const count = Math.max(1, Array.from(segments).filter((s) => s.isWordLike).length)
	const words = FAKE_WORDS[to]
	return Array.from({ length: count }, (_, i) => words[i % words.length]).join(" ")
}

/**
 * A model that "translates" by keeping the tags and writing fixed words of the target language
 * in place of the text. An article titled with `[fake:fail]` fails, as a provider can.
 */
export function fakeTranslator(to: AiLanguage): LanguageModel {
	return new MockLanguageModelV4({
		provider: "fake",
		modelId: "translator",
		doGenerate: async (options: LanguageModelV4CallOptions) => {
			const user = options.prompt.findLast((m) => m.role === "user")
			const prompt =
				user && Array.isArray(user.content)
					? user.content.map((c) => (c.type === "text" ? c.text : "")).join("")
					: ""
			if (prompt.includes(FAKE_FAIL)) throw new Error("fake provider failure")
			const body = prompt.slice(prompt.indexOf("\n\n") + 2)
			let text: string
			if (prompt.startsWith("Translate this article's title")) {
				const head = JSON.parse(body) as { title: string; description: string | null }
				text = JSON.stringify({
					title: fakeWords(head.title, to),
					description: head.description ? fakeWords(head.description, to) : null,
				})
			} else {
				// Spaces around the text stay, so inline tags keep theirs.
				text = body.replace(/(^|>)(\s*)([^<]*?)(\s*)(?=<|$)/g, (match, open, lead, words, trail) =>
					words ? `${open}${lead}${fakeWords(words, to)}${trail}` : match,
				)
			}
			return {
				content: [{ type: "text", text }],
				finishReason: { unified: "stop", raw: "end_turn" },
				usage: {
					inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 100, text: 100, reasoning: 0 },
				},
				warnings: [],
			}
		},
	})
}
