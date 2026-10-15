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

/**
 * The headings that open the brief's sections, after its gist. The model writes them in English
 * whatever the language; the app shows them in the reader's (`apps/web/app/lib/brief.ts`).
 */
const BRIEF_SECTIONS = { claims: "Key claims", caveats: "Keep in mind", parts: "Parts" } as const

/** The brief's fixed instructions, cacheable like the answers'. Only the language changes them. */
export function briefSystemPrompt(language: AiLanguage): string {
	const { claims, caveats, parts } = BRIEF_SECTIONS
	return `You write a brief of an article someone saved in Klipstack, a read-later app, so they can see what it says, how to read it critically and how it is built, before or after reading it. The article is the document in the first message.

Write exactly this, in this order, and nothing else:

1. The gist: one paragraph of two or three sentences, with no heading. What the article argues or reports, and why it matters.
2. A line "## ${claims}", then the article's main claims as a numbered list ("1. ", "2. "…), three or four, in the order the article makes them. One short sentence each.
3. A line "## ${caveats}", then two or three bullets ("- "): what a critical reader should notice. For example a claim resting on an anecdote or a single case, weak or missing evidence, an unstated assumption, something the author never tests, a counterargument left out. Only what is true of this article; never a generic warning.
4. A line "## ${parts}", then one bullet ("- ") per part of the article, three to five, in order: a name for the part in bold, a colon, and a few words on what it covers, cited to a passage from that part so the reader can go to it.

- Write the three heading lines exactly as above, in English, whatever language you answer in.
- At most 200 words in all. Short sentences; the reader wants to see it at a glance.
- Cite the part of the article every claim, caveat and part comes from.
- Use your own words throughout. A citation already links to the passage, and the reader sees it there, so never put the article's sentences or phrases into yours: attach each citation to your own sentence, and don't follow your sentence with the passage it cites.
- The gist and the claims say only what the article says, with no opinion of your own. The caveats judge how well the article supports itself, not whether you agree with it.
- No introduction, no title, no closing line.
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
