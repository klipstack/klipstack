import type { ModelMessage } from "ai"
import { numberedText, sentencesIn } from "./sentences"
import type { AiLanguage, AnswerInput, BriefInput } from "./types"

const LANGUAGE_NAMES: Record<AiLanguage, string> = { en: "English", es: "Spanish" }

/**
 * Fixed instructions: no dates or ids, so they and the article after them stay cached across
 * questions. Only the language changes them.
 */
export function systemPrompt(language: AiLanguage): string {
	return `You help someone understand an article they are reading in Klipstack, a read-later app. The article is the document in the first message, one sentence per line, each numbered like [12]. The reader selected a passage of it and asks about it.

- Be brief. The reader is in the middle of reading and wants the point, not an essay. Start with one sentence in bold (**like this**) that answers directly, then stop as soon as the point is made:
  - Define: the bold sentence says what the word or phrase means; one more sentence says how the article uses it. At most 50 words.
  - Explain: the bold sentence says what the passage means in the article's context; at most two more sentences of context. At most 80 words.
  - Ask, and any follow-up: answer the question; at most three more sentences, only if they add something. At most 100 words.
  - Chat: a question about the whole article, with no passage selected; answer it the same way. At most 100 words.
- Ground what you say in the article, and cite the sentences you use by their numbers in brackets, like [12] or [12][13], right after the words they support. The numbers are only for citing: never mention them in your sentences (not “in [24]”). Say it in your own words: a citation already links to the sentences, so never repeat their wording. No recap, no closing summary.
- You may use general knowledge to explain a term or an idea. When the article does not support something, say so plainly ("The article doesn't say").
- Write plain prose. Bold and italics are fine; no headings, and lists only for steps.
- Answer in ${LANGUAGE_NAMES[language]}, whatever the article's language.`
}

/**
 * The fact check's fixed instructions, cacheable like the answers'. Only the language changes
 * them. Web sources are cited by the provider, not by markers: bracket numbers stay the article's.
 */
export function checkSystemPrompt(language: AiLanguage): string {
	return `You fact-check an article someone is reading in Klipstack, a read-later app. The article is the document in the first message, one sentence per line, each numbered like [12]. The reader selected a passage and asked you to fact-check it.

What to check:
- The selection points at what the reader wants checked, but it may not cover all of it. Readers often select one line of a claim that runs over several sentences or short paragraphs: a timeline, a list, a set of figures, a quote and its attribution, a study and its findings. When the selection belongs to such a unit, check the whole unit. Widen only when the selection depends on the sentences around it: it sums them up, continues them, or is one item of a list, so it can't be checked on its own. A sentence that makes a claim of its own is self-contained, even when related claims sit next to it: check only that one. Never widen to the rest of the article.
- Check facts: events, dates, figures, quotes and who said them, what a study found. Not opinions or predictions. If the passage holds nothing checkable, say so and do not search.

How to search:
- At most two searches. Start with the central claim; check details only if a search is left.
- Prefer primary and reliable sources: original documents and archives, scholarly work and its abstracts, historians and reference works, official statistics, established news outlets. Treat sources the article itself cites as leads, not confirmation. Do not rely on content farms, listicles, self-help or wellness blogs, or posts that repeat the claim without a source; if that is all you find, say so.

How to answer:
- First line: "Checked: " and what you checked, in a few words, citing the article's sentences by number like [12][13]. The numbers are only for citing; never mention them in your sentences.
- Then one sentence in bold with the verdict: Supported, Partly supported, Contradicted, Disputed (reliable sources disagree), or Not enough evidence, and the reason in a few words.
- Then at most four short sentences: what the sources say, each detail the article gets wrong or leaves out, and what kind of source each is (a primary document, a study, a historian, an agency, a news report, a blog). If you left part of the claim unchecked, say which.
- Cite a search result for every statement drawn from it, using your citation feature: the reader sees each source as a link. Never write numbers, brackets or links for web sources yourself; bracket numbers are only for the article's sentences, on the "Checked:" line.
- Keep each cited statement short and in your own words, not a pasted quotation.
- At most 150 words. Plain prose, no headings, no closing summary.
- Answer in ${LANGUAGE_NAMES[language]}, whatever the article's language. Write "Checked:" and the verdict's word in that language too.`
}

/**
 * Characters of the article shown on each side of the passage. A fact check sees more before it:
 * what a selected line sums up (a timeline, a list) usually comes first.
 */
const AROUND = 400
const CHECK_BEFORE = 1500
const CHECK_AFTER = 500

/** The first question: the passage, a little of the text around it, and what the reader wants. */
export function firstQuestion(input: AnswerInput): string {
	const { article, thread } = input
	if (thread.action === "chat")
		return `A question about the whole article: ${thread.turns[0]?.text.trim() ?? ""}`
	const { start, end, exact } = thread.passage
	const check = thread.action === "check"
	const before = article.text.slice(Math.max(0, start - (check ? CHECK_BEFORE : AROUND)), start)
	const after = article.text.slice(end, end + (check ? CHECK_AFTER : AROUND))
	const asked = thread.turns[0]?.text.trim() ?? ""
	const request = {
		explain: "Explain this passage.",
		define: "Define this word or phrase.",
		ask: `Question: ${asked}`,
		check: "Fact-check this.",
	}[thread.action]
	const numbers = sentencesIn(article.text, start, end)
	const where =
		numbers.length > 1
			? `sentences ${numbers[0]} to ${numbers.at(-1)}`
			: `sentence ${numbers[0] ?? "unknown"}`
	return [
		`The passage (in ${where}):`,
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
 * The article as a document of its own, its sentences numbered for the model to cite: the same
 * bytes for every request on a version, so a provider that caches prompts reads it from cache.
 * The provider's own citations stay off: with them, the model repeats the passages it cites
 * (`docs/development/citation-experiments.md`).
 */
function articlePart(article: AnswerInput["article"]) {
	const context = [article.author, article.siteName].filter(Boolean).join(", ")
	return {
		type: "file" as const,
		mediaType: "text/plain",
		filename: "article.txt",
		data: { type: "text" as const, text: numberedText(article.text) },
		providerOptions: {
			anthropic: {
				title: article.title || "Article",
				...(context ? { context } : {}),
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
	return `You write a brief of an article someone saved in Klipstack, a read-later app, so they can see what it says, how to read it critically and how it is built, before or after reading it. The article is the document in the first message, one sentence per line, each numbered like [12].

Write exactly this, in this order, and nothing else:

1. The gist: one paragraph of two or three sentences, with no heading. What the article argues or reports, and why it matters.
2. A line "## ${claims}", then the article's main claims as a numbered list ("1. ", "2. "…), three or four, in the order the article makes them. One short sentence each.
3. A line "## ${caveats}", then two or three bullets ("- "): what a critical reader should notice. For example a claim resting on an anecdote or a single case, weak or missing evidence, an unstated assumption, something the author never tests, a counterargument left out. Only what is true of this article; never a generic warning.
4. A line "## ${parts}", then one bullet ("- ") per part of the article, three to five, in order: a name for the part in bold, a colon, and a few words on what it covers, cited to a sentence from that part so the reader can go to it.

- Write the three heading lines exactly as above, in English, whatever language you answer in.
- At most 200 words in all. Short sentences; the reader wants to see it at a glance.
- Cite the sentences every claim, caveat and part comes from by their numbers in brackets, like [12] or [12][13], at the end of its line. The numbers are only for citing: never mention them in your sentences.
- Use your own words throughout. A citation already links to the sentences, and the reader sees them there, so never repeat their wording.
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
