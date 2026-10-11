import { z } from "zod"
import type { Models } from "./models"

/** An article of the corpus, as it arrives. */
export interface Article {
	id: string
	title: string
	siteName: string | null
	description: string | null
	savedAt: string
	text: string
	/** Tags the account's owner gave it by hand: a reference, never shown to the models. */
	manualTags: string[]
}

export interface Config {
	/** Who sorts articles into topics. Topics are always proposed by Haiku. */
	classifier: "jev" | "haiku"
	/** Articles in the library before the first topics are proposed. */
	bootstrapSize: number
	/** At or above: the topic is applied. */
	applyThreshold: number
	/** At or above, below `applyThreshold`: the topic is suggested. */
	suggestThreshold: number
	maxTopicsPerArticle: number
	/** Unsorted articles needed before asking for a new topic, and again after each attempt. */
	poolSize: number
	/** Unsorted articles a new topic must cover. */
	minNewTopicArticles: number
	/** A maintenance pass after every this many arrivals. */
	maintainEvery: number
	/** Characters of the article's text a classifier reads. */
	textChars: number
	/** How the proposer is asked to name topics: broad fields, or specific shelves. */
	style: "broad" | "specific"
	/** What Jev is asked: whether the topic is a main subject, or whether the article belongs on its shelf. */
	question: "main" | "shelf"
	/** Whether unsorted articles may widen an existing topic's description instead of a new topic. */
	widen: boolean
	/** Another sample of the same run: Haiku is asked again instead of answering from the cache. */
	sample: number
}

export const DEFAULT_CONFIG: Config = {
	classifier: "jev",
	bootstrapSize: 15,
	applyThreshold: 0.7,
	suggestThreshold: 0.4,
	maxTopicsPerArticle: 3,
	poolSize: 5,
	minNewTopicArticles: 3,
	maintainEvery: 20,
	textChars: 6000,
	style: "broad",
	question: "main",
	widen: false,
	sample: 0,
}

export interface Topic {
	id: string
	name: string
	description: string
	createdAt: number
	origin: "bootstrap" | "pool" | "split" | "merge"
	/** Why it exists, in the proposer's words. */
	reason: string
	retiredAt?: number
	retiredReason?: string
	renamedFrom?: string[]
}

export interface Assignment {
	topicId: string
	p: number
	level: "applied" | "suggested"
	/** The step it was decided at. */
	at: number
}

export type SimEvent =
	| { step: number; type: "arrive"; articleId: string; outcome: "waiting" | "sorted" | "unsorted" }
	| { step: number; type: "bootstrap"; topicIds: string[] }
	| { step: number; type: "new-topics"; topicIds: string[]; poolIds: string[]; note: string }
	| { step: number; type: "no-new-topic"; poolIds: string[]; note: string }
	| {
			step: number
			type: "widen"
			topicId: string
			from: string
			to: string
			articleIds: string[]
			reason: string
	  }
	| {
			step: number
			type: "maintenance"
			ops: MaintenanceOp[]
			note: string
	  }

export type MaintenanceOp =
	| { op: "merge"; topicIds: string[]; into: string; reason: string }
	| { op: "split"; topicId: string; into: string[]; reason: string }
	| { op: "rename"; topicId: string; from: string; to: string; reason: string }
	| { op: "retire"; topicId: string; reason: string }

export interface Snapshot {
	step: number
	topics: number
	sorted: number
	unsorted: number
	waiting: number
}

export interface RunResult {
	name: string
	config: Config
	articles: { id: string; arrivedAt: number }[]
	topics: Topic[]
	assignments: Record<string, Assignment[]>
	scores: Record<string, Record<string, number>>
	unsorted: string[]
	events: SimEvent[]
	snapshots: Snapshot[]
}

function topicSpec(style: Config["style"]) {
	return z.object({
		name: z
			.string()
			.describe(
				style === "broad"
					? "The label of a shelf: one subject in 1-3 words, such as Management or Psychology, never two subjects joined with And"
					: "The label of a specific shelf: one subject in 1-4 words, such as Engineering Management, Online Writing or Behavioral Economics, never a whole field like Work or Psychology, never two subjects joined with And",
			),
		description: z
			.string()
			.describe(
				style === "broad"
					? "One sentence: what belongs here, written to sort new articles into it"
					: "Two sentences: what belongs here, then what does not (naming the neighbouring topics it could be confused with), written to sort new articles into it",
			),
	})
}

const SYSTEM: Record<Config["style"], string> = {
	broad: `You organize one person's reading library into topics, the way a thoughtful librarian would. Topics are broad enough to hold many articles over time and narrow enough to be useful for finding things again. They describe what articles are about (subject matter), not their format, tone or source. Avoid overlapping topics.`,
	specific: `You organize one person's reading library into topics, the way a thoughtful librarian would. A topic is a specific subject this reader keeps coming back to, the kind of shelf they would browse on purpose: "Engineering Management", "Online Writing", "Behavioral Economics", "Death and Mortality". Never propose a whole field such as Work, Life, Psychology, Technology or Science: a field swallows everything near it and helps no one find anything. Prefer two specific topics to one broad one, and prefer waiting for more articles to inventing a vague topic. Topics describe what articles are about (subject matter), not their format, tone or source, and must not overlap.`,
}

export class Simulation {
	readonly topics: Topic[] = []
	readonly assignments = new Map<string, Assignment[]>()
	/** The latest probability of every topic for every article, applied or not. */
	readonly scores = new Map<string, Record<string, number>>()
	readonly events: SimEvent[] = []
	readonly snapshots: Snapshot[] = []
	private readonly library: Article[] = []
	private unsorted: string[] = []
	private lastAttemptPool = 0
	private step = 0
	private nextTopic = 1

	constructor(
		private readonly config: Config,
		/** The models' calls; tests pass fakes. */
		private readonly models: Pick<Models, "haiku" | "jev">,
		private readonly log: (line: string) => void = () => {},
	) {}

	private spec() {
		return topicSpec(this.config.style)
	}

	private active(): Topic[] {
		return this.topics.filter((t) => t.retiredAt === undefined)
	}

	private topicName(id: string): string {
		return this.topics.find((t) => t.id === id)?.name ?? id
	}

	async arrive(article: Article): Promise<void> {
		this.step++
		this.library.push(article)
		const step = this.step
		if (this.active().length === 0) {
			this.events.push({ step, type: "arrive", articleId: article.id, outcome: "waiting" })
			this.log(`#${step} ${article.title} → waiting for the first topics`)
			if (this.library.length >= this.config.bootstrapSize) await this.bootstrap()
		} else {
			await this.sort(article, this.active())
			const sorted = this.isSorted(article.id)
			if (!sorted) this.unsorted.push(article.id)
			this.events.push({
				step,
				type: "arrive",
				articleId: article.id,
				outcome: sorted ? "sorted" : "unsorted",
			})
			this.log(`#${step} ${article.title} → ${this.describe(article.id)}`)
			if (
				this.unsorted.length >= this.config.poolSize &&
				this.unsorted.length >= this.lastAttemptPool + this.config.poolSize
			)
				await this.growFromPool()
		}
		if (step % this.config.maintainEvery === 0 && this.active().length > 0) await this.maintain()
		this.snapshot()
	}

	private snapshot() {
		const waiting = this.active().length === 0 ? this.library.length : 0
		this.snapshots.push({
			step: this.step,
			topics: this.active().length,
			sorted: this.library.filter((a) => this.isSorted(a.id)).length,
			unsorted: this.unsorted.length,
			waiting,
		})
	}

	private isSorted(articleId: string): boolean {
		return (this.assignments.get(articleId) ?? []).some((a) => a.level === "applied")
	}

	private describe(articleId: string): string {
		const list = this.assignments.get(articleId) ?? []
		if (list.length === 0) return "unsorted"
		return list
			.map(
				(a) =>
					`${this.topicName(a.topicId)} ${a.p.toFixed(2)}${a.level === "suggested" ? "?" : ""}`,
			)
			.join(", ")
	}

	private addTopic(
		spec: z.infer<ReturnType<typeof topicSpec>>,
		origin: Topic["origin"],
		reason: string,
	) {
		const topic: Topic = {
			id: `t${this.nextTopic++}`,
			name: spec.name,
			description: spec.description,
			createdAt: this.step,
			origin,
			reason,
		}
		this.topics.push(topic)
		return topic
	}

	/** What a classifier reads. */
	private state(article: Article): string {
		return [
			`Title: ${article.title}`,
			article.siteName ? `Site: ${article.siteName}` : "",
			article.description ? `Description: ${article.description}` : "",
			"",
			article.text.slice(0, this.config.textChars),
		]
			.filter((line, i) => line !== "" || i === 3)
			.join("\n")
	}

	/** One line about an article, for the proposer. */
	private line(article: Article): string {
		const about = article.description || article.text.slice(0, 280).replace(/\s+/g, " ")
		return `[${article.id.slice(0, 8)}] ${article.title}${article.siteName ? ` (${article.siteName})` : ""}: ${about}`
	}

	/** The probability that each topic is one of the article's main subjects. Public for `compare`. */
	async score(article: Article, topics: Topic[]): Promise<Record<string, number>> {
		if (topics.length === 0) return {}
		if (this.config.classifier === "jev") {
			const scores: Record<string, number> = {}
			for (let i = 0; i < topics.length; i += 20) {
				const chunk = topics.slice(i, i + 20)
				Object.assign(
					scores,
					await this.models.jev(
						"sort",
						this.state(article),
						Object.fromEntries(
							chunk.map((t) => [
								t.id,
								this.config.question === "main"
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
						),
					),
				)
			}
			return scores
		}
		const answer = await this.models.haiku("sort", {
			system: SYSTEM[this.config.style],
			sample: this.config.sample,
			prompt: `Topics:\n${topics.map((t) => `- ${t.id}: ${t.name}: ${t.description}`).join("\n")}\n\nFor each topic, give the probability (0 to 1) that it is one of the main subjects of the article below. Most topics should be near 0; an article usually has one to three main subjects, and may have none of these.\n\n<article>\n${this.state(article)}\n</article>`,
			schema: z.object({
				scores: z.array(z.object({ topicId: z.string(), probability: z.number() })),
			}),
		})
		return Object.fromEntries(answer.scores.map((s) => [s.topicId, s.probability]))
	}

	/**
	 * Sorts an article into `topics`, keeping what it already has from other topics. The strongest
	 * `maxTopicsPerArticle` are applied; weaker ones above the suggestion threshold are suggested.
	 */
	private async sort(article: Article, topics: Topic[]): Promise<void> {
		const scores = await this.score(article, topics)
		this.scores.set(article.id, { ...this.scores.get(article.id), ...scores })
		const ids = new Set(topics.map((t) => t.id))
		const kept = (this.assignments.get(article.id) ?? []).filter((a) => !ids.has(a.topicId))
		const fresh = topics
			.map((t) => ({ topicId: t.id, p: scores[t.id] ?? 0 }))
			.filter((s) => s.p >= this.config.suggestThreshold)
			.map((s) => ({
				...s,
				level: (s.p >= this.config.applyThreshold ? "applied" : "suggested") as Assignment["level"],
				at: this.step,
			}))
		const all = [...kept, ...fresh].sort((a, b) => b.p - a.p)
		let applied = 0
		for (const a of all) {
			if (a.level !== "applied") continue
			if (applied >= this.config.maxTopicsPerArticle) a.level = "suggested"
			else applied++
		}
		this.assignments.set(article.id, all)
	}

	private async bootstrap() {
		const answer = await this.models.haiku("propose", {
			system: SYSTEM[this.config.style],
			sample: this.config.sample,
			prompt: `This person has saved their first ${this.library.length} articles. ${this.config.style === "broad" ? "Propose the first set of topics for their library: between 4 and 10, each one fitting at least two of these articles, and broad enough to keep receiving new articles." : "Propose the first set of topics for their library: specific subjects, each one fitting at least two of these articles. Leave an article without a topic rather than stretch a topic to cover it."}\n\n${this.library.map((a) => this.line(a)).join("\n")}`,
			schema: z.object({
				topics: z.array(this.spec().extend({ reason: z.string().describe("Which articles, why") })),
			}),
		})
		const topics = answer.topics.map((t) => this.addTopic(t, "bootstrap", t.reason))
		this.events.push({ step: this.step, type: "bootstrap", topicIds: topics.map((t) => t.id) })
		this.log(`  ★ first topics: ${topics.map((t) => t.name).join(", ")}`)
		for (const article of this.library) await this.sort(article, topics)
		this.unsorted = this.library.filter((a) => !this.isSorted(a.id)).map((a) => a.id)
		this.lastAttemptPool = this.unsorted.length
		this.log(
			`  sorted ${this.library.length - this.unsorted.length}, unsorted ${this.unsorted.length}`,
		)
	}

	/** Asks for new topics that would hold the unsorted articles, then sorts the library into them. */
	private async growFromPool() {
		const pool = this.unsorted.map((id) => this.library.find((a) => a.id === id)!)
		this.lastAttemptPool = pool.length
		const widen = this.config.widen
		const answer = await this.models.haiku("grow", {
			system: SYSTEM[this.config.style],
			sample: this.config.sample,
			prompt: `The library's topics:\n${this.active()
				.map((t) => `- ${widen ? `${t.id}: ` : ""}${t.name}: ${t.description}`)
				.join(
					"\n",
				)}\n\nThese recently saved articles fit none of them:\n${pool.map((a) => this.line(a)).join("\n")}\n\n${
				widen
					? `First, an article may belong on an existing shelf whose description is too narrow to say so. For such a shelf, write a wider description that takes those articles in (list their ids) while keeping the shelf specific and its name unchanged. Then, for the articles left, p`
					: "P"
			}ropose up to 2 new topics, each holding at least ${this.config.minNewTopicArticles} of these articles (list their ids), that do not overlap the existing topics. If they do not share a theme strong enough for a topic, propose none: an article may stay unsorted.`,
			schema: z.object({
				...(widen
					? {
							widen: z.array(
								z.object({
									topicId: z.string(),
									description: this.spec().shape.description,
									articleIds: z.array(z.string()).describe("The 8-character ids in brackets"),
									reason: z.string(),
								}),
							),
						}
					: {}),
				topics: z.array(
					this.spec().extend({
						articleIds: z.array(z.string()).describe("The 8-character ids in brackets"),
						reason: z.string(),
					}),
				),
				note: z.string().describe("One sentence on what you saw in these articles"),
			}),
		})
		const widened: Topic[] = []
		for (const w of (
			answer as {
				widen?: { topicId: string; description: string; articleIds: string[]; reason: string }[]
			}
		).widen ?? []) {
			const topic = this.active().find((t) => t.id === w.topicId)
			if (!topic || w.articleIds.length === 0) continue
			this.events.push({
				step: this.step,
				type: "widen",
				topicId: topic.id,
				from: topic.description,
				to: w.description,
				articleIds: w.articleIds,
				reason: w.reason,
			})
			topic.description = w.description
			widened.push(topic)
			this.log(`  ↔ widened ${topic.name}: ${w.description}`)
		}
		const accepted = answer.topics.filter(
			(t) => t.articleIds.length >= this.config.minNewTopicArticles,
		)
		const topics = accepted.map((t) => this.addTopic(t, "pool", t.reason))
		if (topics.length > 0) {
			this.events.push({
				step: this.step,
				type: "new-topics",
				topicIds: topics.map((t) => t.id),
				poolIds: [...this.unsorted],
				note: answer.note,
			})
			this.log(`  ★ new topics: ${topics.map((t) => t.name).join(", ")}`)
		} else if (widened.length === 0) {
			this.events.push({
				step: this.step,
				type: "no-new-topic",
				poolIds: [...this.unsorted],
				note: answer.note,
			})
			this.log(`  ○ no new topic from ${pool.length} unsorted: ${answer.note}`)
			return
		}
		// A new or widened topic is checked against the whole library, not only the pool.
		for (const article of this.library) await this.sort(article, [...widened, ...topics])
		this.unsorted = this.unsorted.filter((id) => !this.isSorted(id))
		this.lastAttemptPool = this.unsorted.length
	}

	private async maintain() {
		const active = this.active()
		const members = (id: string) =>
			this.library.filter((a) =>
				(this.assignments.get(a.id) ?? []).some((x) => x.topicId === id && x.level === "applied"),
			)
		const pairs: string[] = []
		for (let i = 0; i < active.length; i++)
			for (let j = i + 1; j < active.length; j++) {
				const a = new Set(members(active[i]!.id).map((x) => x.id))
				const b = members(active[j]!.id).map((x) => x.id)
				const both = b.filter((id) => a.has(id)).length
				if (both >= 2) pairs.push(`${active[i]!.name} + ${active[j]!.name}: ${both} articles`)
			}
		const sorted = this.library.filter((a) => this.isSorted(a.id)).length
		const answer = await this.models.haiku("maintain", {
			system: SYSTEM[this.config.style],
			sample: this.config.sample,
			prompt: `The library has ${this.library.length} articles; ${sorted} are in a topic and ${this.unsorted.length} are unsorted. Its topics, with how many articles each holds, when it last received one (the library's article number, now ${this.step}) and some of their titles:\n\n${active
				.map((t) => {
					const list = members(t.id)
					const last = Math.max(t.createdAt, ...list.map((a) => this.library.indexOf(a) + 1))
					return `${t.id}: ${t.name} (${list.length} articles, last at ${last}): ${t.description}\n${list
						.slice(-6)
						.map((a) => `    - ${a.title}`)
						.join("\n")}`
				})
				.join(
					"\n\n",
				)}\n\nTopics that often share articles:\n${pairs.join("\n") || "(none)"}\n\nReview the topics. Change them only when the change clearly helps someone find their articles: merge topics that overlap, ${this.config.style === "broad" ? "split a topic holding far more than its share (about a third of the library or more) into clearer ones" : "split a topic that holds more than about a sixth of the library, or that mixes subjects a reader would look for separately, into specific ones"}, rename a topic whose name no longer fits what it holds, retire a topic that is empty or holds a single article long after it was created. Most reviews change nothing or one thing. Never more than three changes.`,
			schema: z.object({
				changes: z.array(
					z.object({
						op: z.enum(["merge", "split", "rename", "retire"]),
						topicIds: z.array(z.string()).describe("The topics changed, by id"),
						into: z.array(this.spec()).describe("merge: one; split: two or three; rename: one"),
						reason: z.string(),
					}),
				),
				note: z.string().describe("One sentence on the state of the topics"),
			}),
		})
		const ops: MaintenanceOp[] = []
		for (const change of answer.changes.slice(0, 3)) {
			const targets = change.topicIds
				.map((id) => active.find((t) => t.id === id))
				.filter((t): t is Topic => !!t && t.retiredAt === undefined)
			if (targets.length === 0) continue
			if (change.op === "rename" && change.into[0]) {
				const t = targets[0]!
				ops.push({
					op: "rename",
					topicId: t.id,
					from: t.name,
					to: change.into[0].name,
					reason: change.reason,
				})
				t.renamedFrom = [...(t.renamedFrom ?? []), t.name]
				t.name = change.into[0].name
				t.description = change.into[0].description
				// Renamed in place: its articles keep it, judged again against the new description.
				for (const a of members(t.id)) await this.sort(a, [t])
			} else if (change.op === "retire") {
				this.retire(targets, change.reason)
				ops.push({ op: "retire", topicId: targets[0]!.id, reason: change.reason })
			} else if (change.op === "merge" && targets.length >= 2 && change.into[0]) {
				const affected = [...new Set(targets.flatMap((t) => members(t.id)))]
				this.retire(targets, `merged: ${change.reason}`)
				const merged = this.addTopic(change.into[0], "merge", change.reason)
				ops.push({
					op: "merge",
					topicIds: targets.map((t) => t.id),
					into: merged.id,
					reason: change.reason,
				})
				for (const a of affected) await this.sort(a, [merged])
			} else if (change.op === "split" && change.into.length >= 2) {
				const t = targets[0]!
				const affected = members(t.id)
				this.retire([t], `split: ${change.reason}`)
				const parts = change.into.map((spec) => this.addTopic(spec, "split", change.reason))
				ops.push({
					op: "split",
					topicId: t.id,
					into: parts.map((p) => p.id),
					reason: change.reason,
				})
				for (const a of affected) await this.sort(a, parts)
			}
		}
		this.unsorted = this.library.filter((a) => !this.isSorted(a.id)).map((a) => a.id)
		this.lastAttemptPool = Math.min(this.lastAttemptPool, this.unsorted.length)
		this.events.push({ step: this.step, type: "maintenance", ops, note: answer.note })
		this.log(
			`  ⚙ maintenance: ${ops.length ? ops.map((o) => o.op).join(", ") : "no change"}. ${answer.note}`,
		)
	}

	private retire(topics: Topic[], reason: string) {
		for (const t of topics) {
			t.retiredAt = this.step
			t.retiredReason = reason
			for (const [id, list] of this.assignments)
				this.assignments.set(
					id,
					list.filter((a) => a.topicId !== t.id),
				)
		}
	}

	result(name: string): RunResult {
		return {
			name,
			config: this.config,
			articles: this.library.map((a, i) => ({ id: a.id, arrivedAt: i + 1 })),
			topics: this.topics,
			assignments: Object.fromEntries(this.assignments),
			scores: Object.fromEntries(this.scores),
			unsorted: this.unsorted,
			events: this.events,
			snapshots: this.snapshots,
		}
	}
}
