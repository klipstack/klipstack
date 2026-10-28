import { generateText, Output } from "ai"
import type { z } from "zod"
import type { AiConfig } from "./models"
import { languageModel } from "./models"
import {
	articleState,
	growRequest,
	holdsEnough,
	proposeRequest,
	QUESTIONS_PER_REQUEST,
	type ReviewInput,
	reviewRequest,
	rewordRequest,
	sortQuestions,
	TOPIC_RULES,
	type TopicArticle,
	type TopicRequest,
	type TopicRules,
	type TopicSpec,
} from "./topics"
import { AiError, type AiLanguage } from "./types"
import { DecisionError, decide } from "./typesafe"

/** An article as the app gives it: `id` is its own, never shown to a model. */
export interface TopicArticleIn {
	id: string
	title: string
	siteName: string | null
	description: string | null
	text: string
}

/** A topic as the app gives it: `description` for the reader, `boundary` for sorting only. */
export interface TopicIn {
	id: string
	name: string
	description: string
	boundary: string
}

/** How long Jev may take for one article: it answers in a tenth of a second. */
const DECIDE_TIMEOUT_MS = 30_000

/** One paid request, for the account's spend: `model` is `provider:model`. */
export interface TopicSpend {
	model: string
	inputTokens: number
	outputTokens: number
	cacheReadTokens: number
}

export interface Spent<T> {
	value: T
	spend: TopicSpend[]
}

export interface ReviewChange {
	op: "merge" | "split" | "rename" | "retire"
	/** The app's ids of the topics changed. */
	topicIds: string[]
	into: TopicSpec[]
	reason: string
}

/**
 * The models behind automatic topics: Haiku proposes, grows, reviews and rewords topics; Jev sorts articles
 * into them. Models see short refs (`a1`, `t1`), never the app's ids; answers come back in ids,
 * with refs the request did not hold dropped.
 */
export function createTopicModels(config: AiConfig, rules: TopicRules = TOPIC_RULES) {
	const options = (language: AiLanguage) => ({
		style: rules.style,
		language,
		refHint: "The ids in brackets",
	})
	const articleRefs = (articles: TopicArticleIn[]) => {
		const toRef = new Map(articles.map((a, i) => [a.id, `a${i + 1}`]))
		const toId = new Map(articles.map((a, i) => [`a${i + 1}`, a.id]))
		const view = (a: TopicArticleIn): TopicArticle => ({ ...a, ref: toRef.get(a.id)! })
		return { view, toId }
	}
	const topicRefs = <T extends TopicIn>(topics: T[]) => {
		const toId = new Map(topics.map((t, i) => [`t${i + 1}`, t.id]))
		const view = topics.map((t, i) => ({ ...t, ref: `t${i + 1}` }))
		return { view, toId }
	}

	return {
		/** Both providers have a key, or the fake answers. */
		available: !!config.fake || (!!config.anthropicApiKey && !!config.typesafeApiKey),

		async propose(input: {
			articles: TopicArticleIn[]
			language: AiLanguage
		}): Promise<Spent<(TopicSpec & { reason: string })[]>> {
			if (config.fake) return { value: fakeTopics(input.articles, input.language), spend: [] }
			const refs = articleRefs(input.articles)
			const answer = await structured(
				config,
				proposeRequest(input.articles.map(refs.view), options(input.language)),
			)
			return { value: answer.value.topics, spend: [answer.spend] }
		},

		async grow(input: { topics: TopicIn[]; pool: TopicArticleIn[]; language: AiLanguage }) {
			if (config.fake)
				return {
					value: {
						widen: [],
						topics: fakeTopics(input.pool, input.language, input.topics),
						note: "",
					},
					spend: [],
				}
			const articles = articleRefs(input.pool)
			const topics = topicRefs(input.topics)
			const answer = await structured(
				config,
				growRequest(topics.view, input.pool.map(articles.view), {
					...options(input.language),
					widen: rules.widen,
					minNewTopicArticles: rules.minNewTopicArticles,
				}),
			)
			const poolRefs = new Set(articles.toId.keys())
			const ids = (refs: string[]) =>
				[...new Set(refs)].flatMap((ref) => articles.toId.get(ref) ?? [])
			const value = {
				widen: (answer.value.widen ?? []).flatMap((w) => {
					const topicId = topics.toId.get(w.topicId)
					const articleIds = ids(w.articleIds)
					return topicId && articleIds.length
						? [
								{
									topicId,
									description: w.description,
									boundary: w.boundary,
									articleIds,
									reason: w.reason,
								},
							]
						: []
				}),
				topics: answer.value.topics
					.filter((t) => holdsEnough(t.articleIds, poolRefs, rules.minNewTopicArticles))
					.map((t) => ({ ...t, articleIds: ids(t.articleIds) })),
				note: answer.value.note,
			}
			return { value, spend: [answer.spend] }
		},

		async review(
			input: Omit<ReviewInput, "topics" | "pairs"> & {
				topics: (TopicIn & { articles: number; lastAt: number; titles: string[] })[]
				pairs: { a: string; b: string; count: number }[]
				language: AiLanguage
			},
		): Promise<Spent<{ changes: ReviewChange[]; note: string }>> {
			if (config.fake) return { value: { changes: [], note: "" }, spend: [] }
			const topics = topicRefs(input.topics)
			const name = new Map(input.topics.map((t) => [t.id, t.name]))
			const answer = await structured(
				config,
				reviewRequest(
					{
						...input,
						topics: topics.view,
						pairs: input.pairs.map((p) => ({
							a: name.get(p.a) ?? p.a,
							b: name.get(p.b) ?? p.b,
							count: p.count,
						})),
					},
					options(input.language),
				),
			)
			const changes = answer.value.changes.slice(0, 3).flatMap((c) => {
				const topicIds = [...new Set(c.topicIds)].flatMap((ref) => topics.toId.get(ref) ?? [])
				return topicIds.length ? [{ ...c, topicIds }] : []
			})
			return { value: { changes, note: answer.value.note }, spend: [answer.spend] }
		},

		/** A description and boundary for each topic the reader renamed, by topic id. */
		async reword(input: {
			topics: TopicIn[]
			others: TopicIn[]
			language: AiLanguage
		}): Promise<Spent<{ topicId: string; description: string; boundary: string }[]>> {
			if (config.fake)
				return {
					value: input.topics.map((t) => ({
						topicId: t.id,
						description: FAKE_TEXT[input.language].about(t.name),
						boundary: FAKE_TEXT[input.language].boundary,
					})),
					spend: [],
				}
			const renamed = topicRefs(input.topics)
			const answer = await structured(
				config,
				rewordRequest(renamed.view, input.others, options(input.language)),
			)
			const value = answer.value.topics.flatMap((t) => {
				const topicId = renamed.toId.get(t.topicId)
				return topicId ? [{ topicId, description: t.description, boundary: t.boundary }] : []
			})
			return { value, spend: [answer.spend] }
		},

		/** The probability that the article belongs in each topic, by topic id. */
		async sort(input: {
			article: TopicArticleIn
			topics: TopicIn[]
		}): Promise<Spent<Record<string, number>>> {
			if (input.topics.length === 0) return { value: {}, spend: [] }
			if (config.fake) return { value: fakeScores(input.article, input.topics), spend: [] }
			if (!config.typesafeApiKey) throw new AiError("provider", "TYPESAFE_API_KEY is not set")
			const state = articleState({ ...input.article, ref: "" }, rules.textChars)
			const scores: Record<string, number> = {}
			const spend: TopicSpend[] = []
			for (let i = 0; i < input.topics.length; i += QUESTIONS_PER_REQUEST) {
				const chunk = topicRefs(input.topics.slice(i, i + QUESTIONS_PER_REQUEST))
				try {
					const result = await decide(
						{ apiKey: config.typesafeApiKey, fetch: config.fetch },
						state,
						sortQuestions(chunk.view, rules.question),
						// A hung request would hold the reader's run until the job expires.
						AbortSignal.timeout(DECIDE_TIMEOUT_MS),
					)
					for (const [ref, p] of Object.entries(result.answers)) {
						const id = chunk.toId.get(ref)
						if (id) scores[id] = p
					}
					spend.push({ model: result.model, ...result.usage, cacheReadTokens: 0 })
				} catch (error) {
					throw new AiError("provider", "Jev could not sort the article.", { cause: error })
				}
			}
			return { value: scores, spend }
		},
	}
}

export type TopicModels = ReturnType<typeof createTopicModels>

/** Whether a failed topics request may work when tried again. */
export function retryable(error: unknown): boolean {
	const cause = error instanceof AiError ? error.cause : error
	return !(cause instanceof DecisionError) || cause.retryable
}

/** A structured answer from Haiku. */
async function structured<S extends z.ZodType>(
	config: AiConfig,
	request: TopicRequest<S>,
): Promise<{ value: z.infer<S>; spend: TopicSpend }> {
	const { model, name } = languageModel(config, "quick", () => {
		throw new Error("the fake answers topics without a model")
	})
	try {
		const result = await generateText({
			model,
			maxOutputTokens: 16000,
			system: request.system,
			prompt: request.prompt,
			output: Output.object({ schema: request.schema }),
		})
		return {
			value: result.output as z.infer<S>,
			spend: {
				model: name,
				inputTokens: result.usage.inputTokens ?? 0,
				outputTokens: result.usage.outputTokens ?? 0,
				cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
			},
		}
	} catch (error) {
		throw new AiError("provider", "Haiku could not answer about topics.", { cause: error })
	}
}

/** What the fake writes about a site's topic, in the reader's language. */
const FAKE_TEXT: Record<
	AiLanguage,
	{ description: (site: string) => string; about: (name: string) => string; boundary: string }
> = {
	en: {
		description: (site) => `Articles from ${site}.`,
		about: (name) => `Articles about ${name}.`,
		boundary: "Articles from other sites belong in their own topics.",
	},
	es: {
		description: (site) => `Artículos de ${site}.`,
		about: (name) => `Artículos sobre ${name}.`,
		boundary: "Los artículos de otros sitios van en sus propios temas.",
	},
}

/**
 * The fake proposes one topic for each site that saved articles share, and sorts an article into a
 * topic when the topic's name appears in it: enough for tests to see topics come and go.
 */
function fakeTopics(articles: TopicArticleIn[], language: AiLanguage, existing: TopicIn[] = []) {
	const text = FAKE_TEXT[language]
	const sites = new Map<string, string[]>()
	for (const a of articles) {
		if (!a.siteName) continue
		sites.set(a.siteName, [...(sites.get(a.siteName) ?? []), a.id])
	}
	const taken = new Set(existing.map((t) => t.name))
	return [...sites]
		.filter(([site, ids]) => ids.length >= 2 && !taken.has(site))
		.map(([site, ids]) => ({
			name: site,
			description: text.description(site),
			boundary: text.boundary,
			reason: "They share a site.",
			articleIds: ids,
		}))
}

function fakeScores(article: TopicArticleIn, topics: TopicIn[]): Record<string, number> {
	const text = `${article.title} ${article.siteName ?? ""} ${article.text}`.toLowerCase()
	return Object.fromEntries(
		topics.map((t) => [t.id, text.includes(t.name.toLowerCase()) ? 0.9 : 0.05]),
	)
}
