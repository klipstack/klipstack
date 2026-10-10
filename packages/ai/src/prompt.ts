import type { ModelMessage } from "ai"
import type { AiLanguage, AnswerInput, BriefInput } from "./types"

const LANGUAGE_NAMES: Record<AiLanguage, string> = { en: "English", es: "Spanish" }

/**
 * Fixed instructions: no dates or ids, so they and the article after them stay cached across
 * questions. Only the language changes them.
 */
export function systemPrompt(language: AiLanguage): string {
	return `You help someone understand an article they are reading in Klipstack, a read-later app. The article is the document in the first message. The reader selected a passage of it and asks about it.

- Be brief. The reader is in the middle of reading and wants the point, not an essay. Start with one sentence in bold (**like this**) that answers directly, then stop as soon as the point is made:
  - Define: the bold sentence says what the word or phrase means; one more sentence says how the article uses it. At most 50 words.
  - Explain: the bold sentence says what the passage means in the article's context; at most two more sentences of context. At most 80 words.
  - Ask, and any follow-up: answer the question; at most three more sentences, only if they add something. At most 100 words.
  - Chat: a question about the whole article, with no passage selected; answer it the same way. At most 100 words.
- Ground what you say in the article, and cite the parts you use. Say it in your own words: a citation already links to the passage, so don't copy the article's sentences into the answer. No recap, no closing summary.
- You may use general knowledge to explain a term or an idea. When the article does not support something, say so plainly ("The article doesn't say").
- Write plain prose. Bold and italics are fine; no headings, and lists only for steps.
- Answer in ${LANGUAGE_NAMES[language]}, whatever the article's language.`
}

/** Characters of the article shown on each side of the passage. */
const AROUND = 400

/** The first question: the passage, a little of the text around it, and what the reader wants. */
export function firstQuestion(input: AnswerInput): string {
	const { article, thread } = input
	if (thread.action === "chat")
		return `A question about the whole article: ${thread.turns[0]?.text.trim() ?? ""}`
	const { start, end, exact } = thread.passage
	const before = article.text.slice(Math.max(0, start - AROUND), start)
	const after = article.text.slice(end, end + AROUND)
	const asked = thread.turns[0]?.text.trim() ?? ""
	const request = {
		explain: "Explain this passage.",
		define: "Define this word or phrase.",
		ask: `Question: ${asked}`,
	}[thread.action]
	return [
		`The passage (characters ${start} to ${end} of the document):`,
		`"${exact}"`,
		"",
		"Where it is in the article:",
		`"…${before}[[${exact}]]${after}…"`,
		"",
		request,
		...(thread.action !== "ask" && asked ? ["", `The reader adds: ${asked}`] : []),
	].join("\n")
}

/**
 * The messages for one answer. The article comes first as a document of its own, the same bytes
 * for every question on the same version, so a provider that caches prompts reads it from cache.
 * Provider options for other providers are ignored by them.
 */
export function buildMessages(input: AnswerInput): ModelMessage[] {
	const { article, thread } = input
	const [first, ...rest] = thread.turns
	if (!first || first.role !== "user") throw new Error("a thread starts with the reader's turn")
	return [
		{
			role: "user",
			content: [articlePart(article), { type: "text", text: firstQuestion(input) }],
		},
		...rest.map((turn): ModelMessage =>
			turn.role === "user"
				? { role: "user", content: turn.text }
				: { role: "assistant", content: turn.text },
		),
	]
}

/**
 * The article as a document of its own, with citations on: the same bytes for every request on a
 * version, so a provider that caches prompts reads it from cache.
 */
function articlePart(article: AnswerInput["article"]) {
	const context = [article.author, article.siteName].filter(Boolean).join(", ")
	return {
		type: "file" as const,
		mediaType: "text/plain",
		filename: "article.txt",
		data: { type: "text" as const, text: article.text },
		providerOptions: {
			anthropic: {
				title: article.title || "Article",
				...(context ? { context } : {}),
				citations: { enabled: true },
				cacheControl: { type: "ephemeral" as const },
			},
		},
	}
}

/** The brief's fixed instructions, cacheable like the answers'. Only the language changes them. */
export function briefSystemPrompt(language: AiLanguage): string {
	return `You write a brief of an article someone saved in Klipstack, a read-later app, so they can see what it says before or after reading it. The article is the document in the first message.

- Exactly three bullets, each a line starting with "- ". Each bullet is one short sentence with one of the article's main points, in the order the article makes them. At most 70 words in all.
- Cite the part of the article each bullet comes from. Say it in your own words: a citation already links to the passage, so don't copy the article's sentences.
- Only what the article says. No introduction, no heading, no closing line, no opinion of your own.
- Answer in ${LANGUAGE_NAMES[language]}, whatever the article's language.`
}

/** The brief's one message: the article, then the request. */
export function briefMessages(input: BriefInput): ModelMessage[] {
	return [
		{
			role: "user",
			content: [articlePart(input.article), { type: "text", text: "Write the brief." }],
		},
	]
}
