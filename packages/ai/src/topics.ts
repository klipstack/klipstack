import { z } from "zod"
import type { AiLanguage } from "./types"

/**
 * Automatic topics: what Haiku is asked to propose, grow and review a reader's topics, and what
 * Jev is asked to sort an article into them. The topics simulator (`apps/web/scripts/topics`)
 * builds its requests here too, so it measures what production runs.
 */

/** How topics are named: broad fields, or specific shelves (what production asks for). */
export type TopicStyle = "broad" | "specific" | "sections"
/** What Jev is asked of each topic: a main subject of the article, or a shelf it belongs on. */
export type TopicQuestion = "main" | "shelf"

export interface TopicRules {
	style: TopicStyle
	question: TopicQuestion
	/** Whether unsorted articles may widen an existing topic's description. */
	widen: boolean
	/** At or above: the topic is applied to the article. */
	applyThreshold: number
	/** At or above, below `applyThreshold`: the topic is suggested, not applied. */
	suggestThreshold: number
	maxTopicsPerArticle: number
	/** Articles in the library before the first topics are proposed. */
	bootstrapSize: number
	/** Unsorted articles needed before asking for a new topic, and again after each attempt. */
	poolSize: number
	/** Unsorted articles a new topic must hold. */
	minNewTopicArticles: number
	/** A review of the topics after every this many sorted articles. */
	reviewEvery: number
	/** Characters of an article's text a classifier reads. */
	textChars: number
}

/** What production runs: the owner's decisions after the simulator's runs (October 2026). */
export const TOPIC_RULES: TopicRules = {
	style: "specific",
	question: "shelf",
	widen: true,
	applyThreshold: 0.6,
	suggestThreshold: 0.4,
	maxTopicsPerArticle: 3,
	bootstrapSize: 25,
	poolSize: 5,
	minNewTopicArticles: 3,
	reviewEvery: 20,
	textChars: 6000,
}

/** An article as the models see it. `ref` names it in a request: the model lists articles by it. */
export interface TopicArticle {
	ref: string
	title: string
	siteName: string | null
	description: string | null
	text: string
}

/** A topic as the models see it. `ref` names it in a request. */
export interface TopicRef {
	ref: string
	name: string
	description: string
}

/** What to ask Haiku: a system prompt, a prompt, and the shape of the answer. */
export interface TopicRequest<S extends z.ZodType> {
	system: string
	prompt: string
	schema: S
}

export interface RequestOptions {
	style: TopicStyle
	/** The language of topic names and descriptions; none says nothing about it. */
	language?: AiLanguage
	/** How the answer's article lists name articles. */
	refHint?: string
}

const REF_HINT = "The 8-character ids in brackets"

const NAME: Record<TopicStyle, string> = {
	broad:
		"The label of a shelf: one subject in 1-3 words, such as Management or Psychology, never two subjects joined with And",
	specific:
		"The label of a specific shelf: one subject in 1-4 words, such as Engineering Management, Online Writing or Behavioral Economics, never a whole field like Work or Psychology, never two subjects joined with And",
	sections:
		"The label of a section of the library, as a bookstore names its sections: 1-3 words, such as Artificial Intelligence, Software Engineering, Startups, Writing or Health. Never a single debate, product, company or event",
}

const DESCRIPTION: Record<TopicStyle, string> = {
	broad: "One sentence: what belongs here, written to sort new articles into it",
	specific:
		"Two sentences: what belongs here, then what does not (naming the neighbouring topics it could be confused with), written to sort new articles into it",
	sections:
		"Two sentences: what belongs in this section, broadly, then what does not (naming the neighbouring sections), written to sort new articles into it",
}

export function topicSpec(style: TopicStyle) {
	return z.object({
		name: z.string().describe(NAME[style]),
		description: z.string().describe(DESCRIPTION[style]),
	})
}

export type TopicSpec = z.infer<ReturnType<typeof topicSpec>>

const SYSTEM: Record<TopicStyle, string> = {
	sections: `You organize one person's reading library into topics, the way a bookstore is organized into sections. A topic is a section this reader browses on purpose, wide enough to keep filling over months: "Artificial Intelligence", "Software Engineering", "Management", "Writing", "Health". A topic is never a single debate, product, company, event or opinion: those are articles inside a section. When two topics would be browsed together, they are one. Aim for about one topic for every six to ten articles, and never more than twelve. Topics describe what articles are about (subject matter), not their format, tone or source, and must not overlap.`,
	broad: `You organize one person's reading library into topics, the way a thoughtful librarian would. Topics are broad enough to hold many articles over time and narrow enough to be useful for finding things again. They describe what articles are about (subject matter), not their format, tone or source. Avoid overlapping topics.`,
	specific: `You organize one person's reading library into topics, the way a thoughtful librarian would. A topic is a specific subject this reader keeps coming back to, the kind of shelf they would browse on purpose: "Engineering Management", "Online Writing", "Behavioral Economics", "Death and Mortality". Never propose a whole field such as Work, Life, Psychology, Technology or Science: a field swallows everything near it and helps no one find anything. Prefer two specific topics to one broad one, and prefer waiting for more articles to inventing a vague topic. Topics describe what articles are about (subject matter), not their format, tone or source, and must not overlap.`,
}

const LANGUAGE: Record<AiLanguage, string> = {
	en: "Write topic names and descriptions in English, whatever language the articles are in.",
	es: "Write topic names and descriptions in Spanish, whatever language the articles are in, with Spanish capitalization: only the first word and proper names capitalized (Gestión de equipos, not Gestión De Equipos).",
}

export function topicSystem(options: Pick<RequestOptions, "style" | "language">): string {
	const system = SYSTEM[options.style]
	return options.language ? `${system} ${LANGUAGE[options.language]}` : system
}

/** What a classifier reads of an article. */
export function articleState(article: TopicArticle, textChars: number): string {
	return [
		`Title: ${article.title}`,
		article.siteName ? `Site: ${article.siteName}` : "",
		article.description ? `Description: ${article.description}` : "",
		"",
		article.text.slice(0, textChars),
	]
		.filter((line, i) => line !== "" || i === 3)
		.join("\n")
}

/** One line about an article, for the proposer. */
export function articleLine(article: TopicArticle): string {
	const about = article.description || article.text.slice(0, 280).replace(/\s+/g, " ")
	return `[${article.ref}] ${article.title}${article.siteName ? ` (${article.siteName})` : ""}: ${about}`
}

const PROPOSE: Record<TopicStyle, (count: number) => string> = {
	broad: () =>
		"Propose the first set of topics for their library: between 4 and 10, each one fitting at least two of these articles, and broad enough to keep receiving new articles.",
	specific: () =>
		"Propose the first set of topics for their library: specific subjects, each one fitting at least two of these articles. Leave an article without a topic rather than stretch a topic to cover it.",
	sections: (count) =>
		`Propose the first sections of their library: about ${Math.max(3, Math.min(12, Math.round(count / 8)))}, each holding at least four of these articles. An article may stay outside every section rather than make a section for it alone.`,
}

/** The first topics of a library, from its articles. */
export function proposeRequest(articles: TopicArticle[], options: RequestOptions) {
	return {
		system: topicSystem(options),
		prompt: `This person has saved their first ${articles.length} articles. ${PROPOSE[options.style](articles.length)}\n\n${articles.map(articleLine).join("\n")}`,
		schema: z.object({
			topics: z.array(
				topicSpec(options.style).extend({ reason: z.string().describe("Which articles, why") }),
			),
		}),
	} satisfies TopicRequest<z.ZodType>
}

/**
 * New topics, or wider descriptions of existing ones (`widen`), for articles that fit no topic.
 * Topics are listed by `ref` only when they may be widened.
 */
export function growRequest(
	topics: TopicRef[],
	pool: TopicArticle[],
	options: RequestOptions & { widen: boolean; minNewTopicArticles: number },
) {
	const { widen } = options
	const spec = topicSpec(options.style)
	const refs = z.array(z.string()).describe(options.refHint ?? REF_HINT)
	return {
		system: topicSystem(options),
		prompt: `The library's topics:\n${topics
			.map((t) => `- ${widen ? `${t.ref}: ` : ""}${t.name}: ${t.description}`)
			.join(
				"\n",
			)}\n\nThese recently saved articles fit none of them:\n${pool.map(articleLine).join("\n")}\n\n${
			widen
				? `First, an article may belong on an existing shelf whose description is too narrow to say so. For such a shelf, write a wider description that takes those articles in (list their ids) while keeping the shelf specific and its name unchanged. Then, for the articles left, p`
				: "P"
		}ropose up to 2 new topics, each holding at least ${options.minNewTopicArticles} of these articles (list their ids), that do not overlap the existing topics. If they do not share a theme strong enough for a topic, propose none: an article may stay unsorted.`,
		schema: growSchema(spec, refs, widen),
	} satisfies TopicRequest<z.ZodType>
}

/**
 * The answer to `growRequest`. Its `widen` list is asked for only when topics may be widened; the
 * type says it may be missing either way.
 */
function growSchema(spec: ReturnType<typeof topicSpec>, refs: z.ZodType<string[]>, widen: boolean) {
	const widened = z.array(
		z.object({
			topicId: z.string(),
			description: spec.shape.description,
			articleIds: refs,
			reason: z.string(),
		}),
	)
	const rest = {
		topics: z.array(spec.extend({ articleIds: refs, reason: z.string() })),
		note: z.string().describe("One sentence on what you saw in these articles"),
	}
	// The same keys, in the same order, as when only `widen` decided them.
	return (widen ? z.object({ widen: widened, ...rest }) : z.object(rest)) as z.ZodObject<
		{
			widen: z.ZodOptional<typeof widened>
		} & typeof rest
	>
}

/** A topic as the review sees it: its size, when it last received an article, some titles. */
export interface ReviewTopic extends TopicRef {
	articles: number
	/** The library's article number of its newest article, or when it was created. */
	lastAt: number
	titles: string[]
}

export interface ReviewInput {
	libraryCount: number
	sortedCount: number
	unsortedCount: number
	topics: ReviewTopic[]
	/** Pairs of topics that share at least two articles, with how many. */
	pairs: { a: string; b: string; count: number }[]
}

const SPLIT: Record<TopicStyle, string> = {
	broad:
		"split a topic holding far more than its share (about a third of the library or more) into clearer ones",
	specific:
		"split a topic that holds more than about a sixth of the library, or that mixes subjects a reader would look for separately, into specific ones",
	sections:
		"split a section holding about a third of the library or more into two or three sections a reader would browse separately",
}

/** Whether to merge, split, rename or retire topics. */
export function reviewRequest(input: ReviewInput, options: RequestOptions) {
	const spec = topicSpec(options.style)
	return {
		system: topicSystem(options),
		prompt: `The library has ${input.libraryCount} articles; ${input.sortedCount} are in a topic and ${input.unsortedCount} are unsorted. Its topics, with how many articles each holds, when it last received one (the library's article number, now ${input.libraryCount}) and some of their titles:\n\n${input.topics
			.map(
				(t) =>
					`${t.ref}: ${t.name} (${t.articles} articles, last at ${t.lastAt}): ${t.description}\n${t.titles
						.map((title) => `    - ${title}`)
						.join("\n")}`,
			)
			.join(
				"\n\n",
			)}\n\nTopics that often share articles:\n${input.pairs.map((p) => `${p.a} + ${p.b}: ${p.count} articles`).join("\n") || "(none)"}\n\nReview the topics. Change them only when the change clearly helps someone find their articles: merge topics that overlap, ${SPLIT[options.style]}, rename a topic whose name no longer fits what it holds, retire a topic that is empty or holds a single article long after it was created. Most reviews change nothing or one thing. Never more than three changes.`,
		schema: z.object({
			changes: z.array(
				z.object({
					op: z.enum(["merge", "split", "rename", "retire"]),
					topicIds: z.array(z.string()).describe("The topics changed, by id"),
					into: z.array(spec).describe("merge: one; split: two or three; rename: one"),
					reason: z.string(),
				}),
			),
			note: z.string().describe("One sentence on the state of the topics"),
		}),
	} satisfies TopicRequest<z.ZodType>
}

/** Haiku as a classifier: the probability of each topic for one article. */
export function sortRequest(
	article: TopicArticle,
	topics: TopicRef[],
	options: RequestOptions & { textChars: number },
) {
	return {
		system: topicSystem(options),
		prompt: `Topics:\n${topics.map((t) => `- ${t.ref}: ${t.name}: ${t.description}`).join("\n")}\n\nFor each topic, give the probability (0 to 1) that it is one of the main subjects of the article below. Most topics should be near 0; an article usually has one to three main subjects, and may have none of these.\n\n<article>\n${articleState(article, options.textChars)}\n</article>`,
		schema: z.object({
			scores: z.array(z.object({ topicId: z.string(), probability: z.number() })),
		}),
	} satisfies TopicRequest<z.ZodType>
}

/** A yes/no question to Jev about one article. */
export interface DecisionQuestion {
	instructions: string
	yes: string
	no: string
}

/** Jev's questions about one article, one per topic, keyed by the topic's `ref`. */
export function sortQuestions(
	topics: TopicRef[],
	question: TopicQuestion,
): Record<string, DecisionQuestion> {
	return Object.fromEntries(
		topics.map((t) => [
			t.ref,
			question === "main"
				? {
						instructions: `Is "${t.name}" one of the main subjects of this article? ${t.name}: ${t.description}`,
						yes: `The article is substantially about ${t.name}`,
						no: `${t.name} is absent or only mentioned in passing`,
					}
				: {
						instructions: `A reader keeps a shelf called "${t.name}" in their library: ${t.description} Would they expect to find this article on that shelf?`,
						yes: `Someone browsing "${t.name}" would be glad to find this article there`,
						no: `The article would look out of place on "${t.name}", or only touches it in passing`,
					},
		]),
	)
}

/** Jev answers at most this many questions in one request. */
export const QUESTIONS_PER_REQUEST = 20

/** One topic's place on an article. */
export interface Placement {
	topicId: string
	p: number
	level: "applied" | "suggested"
}

/**
 * An article's topics after it is scored against `scored` topics (each topic it was scored
 * against, with its probability): what it had from other topics
 * stays, the new scores above the suggestion threshold join, and the strongest
 * `maxTopicsPerArticle` are applied, the rest suggested. A topic the reader took the article out of
 * (`refused`) never comes back.
 */
export function place(
	kept: Placement[],
	scored: Record<string, number>,
	rules: Pick<TopicRules, "applyThreshold" | "suggestThreshold" | "maxTopicsPerArticle">,
	refused: ReadonlySet<string> = new Set(),
): Placement[] {
	const fresh = Object.entries(scored)
		.filter(([topicId, p]) => p >= rules.suggestThreshold && !refused.has(topicId))
		.map(([topicId, p]): Placement => ({
			topicId,
			p,
			level: p >= rules.applyThreshold ? "applied" : "suggested",
		}))
	const others = kept.filter((a) => !(a.topicId in scored))
	const all = [...others, ...fresh].sort((a, b) => b.p - a.p)
	let applied = 0
	return all.map((a) => {
		if (a.level !== "applied") return a
		if (applied >= rules.maxTopicsPerArticle) return { ...a, level: "suggested" }
		applied++
		return a
	})
}

/** Whether a proposed topic holds enough of the pool's articles, each counted once. */
export function holdsEnough(articleRefs: string[], poolRefs: ReadonlySet<string>, min: number) {
	return new Set(articleRefs.filter((ref) => poolRefs.has(ref))).size >= min
}
