import {
	articleState,
	growRequest,
	holdsEnough,
	place,
	proposeRequest,
	reviewRequest,
	sortQuestions,
	sortRequest,
	type TopicArticle,
	type TopicQuestion,
	type TopicSpec,
	type TopicStyle,
} from "@klipstack/ai"
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
	style: TopicStyle
	/** What Jev is asked: whether the topic is a main subject, or whether the article belongs on its shelf. */
	question: TopicQuestion
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
	| { op: "retire"; topicIds: string[]; reason: string }

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

/** How the models see an article: named by the start of its id, as the cached answers know it. */
const view = (article: Article): TopicArticle => ({ ...article, ref: article.id.slice(0, 8) })

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
	/** The library's size when the first topics were last asked for. */
	private lastBootstrap = 0
	private step = 0
	private nextTopic = 1

	constructor(
		private readonly config: Config,
		/** The models' calls; tests pass fakes. */
		private readonly models: Pick<Models, "haiku" | "jev">,
		private readonly log: (line: string) => void = () => {},
	) {}

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
			if (
				this.library.length >= this.config.bootstrapSize &&
				(this.lastBootstrap === 0 ||
					this.library.length >= this.lastBootstrap + this.config.poolSize)
			)
				await this.bootstrap()
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

	private addTopic(spec: TopicSpec, origin: Topic["origin"], reason: string) {
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
		return articleState(view(article), this.config.textChars)
	}

	/** The topics as the models see them: named by their ids. */
	private refs(topics: Topic[]) {
		return topics.map((t) => ({ ref: t.id, name: t.name, description: t.description }))
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
						sortQuestions(this.refs(chunk), this.config.question),
					),
				)
			}
			return scores
		}
		const answer = await this.models.haiku("sort", {
			...sortRequest(view(article), this.refs(topics), {
				style: this.config.style,
				textChars: this.config.textChars,
			}),
			sample: this.config.sample,
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
		const scored = Object.fromEntries(topics.map((t) => [t.id, scores[t.id] ?? 0]))
		const placed = place(this.assignments.get(article.id) ?? [], scored, this.config)
		// What was already there keeps the step it was decided at.
		this.assignments.set(
			article.id,
			placed.map((a) => ({ at: this.step, ...a })),
		)
	}

	private async bootstrap() {
		this.lastBootstrap = this.library.length
		const answer = await this.models.haiku("propose", {
			...proposeRequest(this.library.map(view), { style: this.config.style }),
			sample: this.config.sample,
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
			...growRequest(this.refs(this.active()), pool.map(view), {
				style: this.config.style,
				widen,
				minNewTopicArticles: this.config.minNewTopicArticles,
			}),
			sample: this.config.sample,
		})
		const widened: Topic[] = []
		for (const w of answer.widen ?? []) {
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
		// Only the pool's own articles count, each once: the model may repeat or invent ids.
		const poolRefs = new Set(pool.map((a) => view(a).ref))
		const accepted = answer.topics.filter((t) =>
			holdsEnough(t.articleIds, poolRefs, this.config.minNewTopicArticles),
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
		// A widened topic can also let an article go.
		this.unsorted = this.library.filter((a) => !this.isSorted(a.id)).map((a) => a.id)
		this.lastAttemptPool = this.unsorted.length
	}

	private async maintain() {
		const active = this.active()
		const members = (id: string) =>
			this.library.filter((a) =>
				(this.assignments.get(a.id) ?? []).some((x) => x.topicId === id && x.level === "applied"),
			)
		const pairs: { a: string; b: string; count: number }[] = []
		for (let i = 0; i < active.length; i++)
			for (let j = i + 1; j < active.length; j++) {
				const a = new Set(members(active[i]!.id).map((x) => x.id))
				const b = members(active[j]!.id).map((x) => x.id)
				const both = b.filter((id) => a.has(id)).length
				if (both >= 2) pairs.push({ a: active[i]!.name, b: active[j]!.name, count: both })
			}
		const sorted = this.library.filter((a) => this.isSorted(a.id)).length
		const answer = await this.models.haiku("maintain", {
			...reviewRequest(
				{
					libraryCount: this.library.length,
					sortedCount: sorted,
					unsortedCount: this.unsorted.length,
					topics: active.map((t) => {
						const list = members(t.id)
						return {
							ref: t.id,
							name: t.name,
							description: t.description,
							articles: list.length,
							lastAt: Math.max(t.createdAt, ...list.map((a) => this.library.indexOf(a) + 1)),
							titles: list.slice(-6).map((a) => a.title),
						}
					}),
					pairs,
				},
				{ style: this.config.style },
			),
			sample: this.config.sample,
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
				// Renamed in place; the whole library is judged again against the new description.
				for (const a of this.library) await this.sort(a, [t])
			} else if (change.op === "retire") {
				this.retire(targets, change.reason)
				ops.push({ op: "retire", topicIds: targets.map((t) => t.id), reason: change.reason })
			} else if (change.op === "merge" && targets.length >= 2 && change.into[0]) {
				this.retire(targets, `merged: ${change.reason}`)
				const merged = this.addTopic(change.into[0], "merge", change.reason)
				ops.push({
					op: "merge",
					topicIds: targets.map((t) => t.id),
					into: merged.id,
					reason: change.reason,
				})
				for (const a of this.library) await this.sort(a, [merged])
			} else if (change.op === "split" && change.into.length >= 2) {
				const t = targets[0]!
				this.retire([t], `split: ${change.reason}`)
				const parts = change.into.map((spec) => this.addTopic(spec, "split", change.reason))
				ops.push({
					op: "split",
					topicId: t.id,
					into: parts.map((p) => p.id),
					reason: change.reason,
				})
				for (const a of this.library) await this.sort(a, parts)
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
