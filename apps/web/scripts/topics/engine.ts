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
import { judgeRequest, type Taste, tidyRequest } from "./reader"

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
	/** A simulated reader corrects the topics: takes articles out, renames and removes topics. */
	reader: boolean
	/** How picky the reader is. */
	taste: Taste
	/** The share of articles the reader looks at, the same ones in every run. */
	attention: number
	/** The reader looks at the topics after every this many arrivals, and when confirming them. */
	readerEvery: number
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
	reader: false,
	taste: "lenient",
	attention: 0.5,
	readerEvery: 10,
}

export interface Topic {
	id: string
	name: string
	/** What the topic holds, as a reader sees it. */
	description: string
	/** What does not belong in it: the models read it, a reader never does. */
	boundary: string
	createdAt: number
	origin: "bootstrap" | "pool" | "split" | "merge"
	/** Why it exists, in the proposer's words. */
	reason: string
	retiredAt?: number
	retiredReason?: string
	renamedFrom?: string[]
	/** The reader named it: a review never renames, merges, splits or retires it. */
	namedByReader?: boolean
	/** The reader removed it (it is retired too): its name never comes back. */
	removed?: boolean
}

/** An article the reader took out of a topic: it never comes back to it. */
export interface Refusal {
	articleId: string
	topicId: string
	at: number
	/** Passed on from a topic this one replaced, not taken out of it by the reader. */
	carried?: boolean
}

/** The final topics as the reader judges them, every article of the library looked at. */
export interface Audit {
	/** Placements applied, and how many of them the reader would look for there. */
	applied: number
	agreed: number
	/** Placements the reader would look for: recall is `agreed` of them. */
	wanted: number
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
	| {
			step: number
			type: "reader"
			takenOut: { articleId: string; topicId: string }[]
			change?: { op: "rename" | "remove"; topicId: string; from: string; to?: string }
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
	refusals: Refusal[]
	audit?: Audit
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
	readonly refusals: Refusal[] = []
	/** What the reader has judged: an article against a topic's name and description. */
	private readonly judged = new Set<string>()
	private readonly library: Article[] = []
	private unsorted: string[] = []
	private lastAttemptPool = 0
	/** The library's size when the first topics were last asked for. */
	private lastBootstrap = 0
	private step = 0
	/** The reader confirmed the first topics: the library grows from here, even with none left. */
	private confirmed = false
	private nextTopic = 1

	constructor(
		private readonly config: Config,
		/** The models' calls; tests pass fakes. */
		private readonly models: Pick<Models, "haiku" | "jev" | "reader">,
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
		if (!this.confirmed) {
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
		if (
			this.config.reader &&
			step % this.config.readerEvery === 0 &&
			this.active().length > 0 &&
			!this.events.some((e) => e.type === "bootstrap" && e.step === step)
		)
			await this.read(true)
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

	/**
	 * Whether an article could join a widened topic: it is in no topic, or the topic was suggested
	 * for it. Never one the reader took it out of.
	 */
	private mayJoin(articleId: string, topicId: string): boolean {
		if (this.refusedFor(articleId).has(topicId)) return false
		const own = (this.assignments.get(articleId) ?? []).find((a) => a.topicId === topicId)
		return own ? own.level === "suggested" : !this.isSorted(articleId)
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
			boundary: spec.boundary ?? "",
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
		return topics.map((t) => ({
			ref: t.id,
			name: t.name,
			description: t.description,
			boundary: t.boundary,
		}))
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
		const placed = place(
			this.assignments.get(article.id) ?? [],
			scored,
			this.config,
			this.refusedFor(article.id),
		)
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
		const topics = this.fresh(answer.topics).map((t) => this.addTopic(t, "bootstrap", t.reason))
		this.confirmed = topics.length > 0
		this.events.push({ step: this.step, type: "bootstrap", topicIds: topics.map((t) => t.id) })
		this.log(`  ★ first topics: ${topics.map((t) => t.name).join(", ")}`)
		// The reader confirms the first topics, perhaps renaming or removing one of them.
		if (this.config.reader && topics.length > 0) await this.tidy(true)
		for (const article of this.library) await this.sort(article, this.active())
		this.unsorted = this.library.filter((a) => !this.isSorted(a.id)).map((a) => a.id)
		this.lastAttemptPool = this.unsorted.length
		this.log(
			`  sorted ${this.library.length - this.unsorted.length}, unsorted ${this.unsorted.length}`,
		)
		if (this.config.reader && topics.length > 0) await this.read(false)
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
			topic.boundary = w.boundary ?? ""
			widened.push(topic)
			this.log(`  ↔ widened ${topic.name}: ${w.description}`)
		}
		// Only the pool's own articles count, each once: the model may repeat or invent ids.
		const poolRefs = new Set(pool.map((a) => view(a).ref))
		const accepted = this.fresh(
			answer.topics.filter((t) =>
				holdsEnough(t.articleIds, poolRefs, this.config.minNewTopicArticles),
			),
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
		// A new topic is checked against the whole library, not only the pool; a widened one only
		// against the articles that could join it, as in production.
		for (const article of this.library) {
			const joins = widened.filter((t) => this.mayJoin(article.id, t.id))
			if (joins.length || topics.length) await this.sort(article, [...joins, ...topics])
		}
		// What is left unsorted once the library is sorted into them: the next growth waits for more.
		this.unsorted = this.library.filter((a) => !this.isSorted(a.id)).map((a) => a.id)
		this.lastAttemptPool = this.unsorted.length
	}

	/** Each active topic's applied articles, in the order they arrived. */
	private members(id: string): Article[] {
		return this.library.filter((a) =>
			(this.assignments.get(a.id) ?? []).some((x) => x.topicId === id && x.level === "applied"),
		)
	}

	private async maintain() {
		const active = this.active()
		const members = (id: string) => this.members(id)
		const pairs: { a: string; b: string; count: number }[] = []
		for (let i = 0; i < active.length; i++)
			for (let j = i + 1; j < active.length; j++) {
				const a = new Set(members(active[i]!.id).map((x) => x.id))
				const both = members(active[j]!.id).filter((x) => a.has(x.id)).length
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
							boundary: t.boundary,
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
			// As production does: a reader's topic is only ever described again, never replaced.
			const theirs = targets.some((t) => t.namedByReader)
			if (change.op === "rename" && change.into[0]) {
				const t = targets[0]!
				const spec = change.into[0]
				// As production: a rename without a description changes nothing.
				if (!spec.description.trim()) continue
				// The reader's name, or one already taken, stays; the description is sharpened all the same.
				const [named] = t.namedByReader ? [] : this.fresh([spec])
				const from = t.name
				if (named) {
					t.renamedFrom = [...(t.renamedFrom ?? []), t.name]
					t.name = named.name
				}
				t.description = spec.description
				t.boundary = spec.boundary ?? ""
				ops.push({ op: "rename", topicId: t.id, from, to: t.name, reason: change.reason })
				// Described again; the whole library is judged again against the new description.
				for (const a of this.library) await this.sort(a, [t])
			} else if (theirs) {
				continue
			} else if (change.op === "retire") {
				this.retire(targets, change.reason)
				ops.push({ op: "retire", topicIds: targets.map((t) => t.id), reason: change.reason })
			} else if (change.op === "merge" && targets.length >= 2) {
				const [spec] = this.fresh(change.into.slice(0, 1))
				if (!spec) continue
				this.retire(targets, `merged: ${change.reason}`)
				const merged = this.addTopic(spec, "merge", change.reason)
				this.carryRefusals(targets, [merged])
				ops.push({
					op: "merge",
					topicIds: targets.map((t) => t.id),
					into: merged.id,
					reason: change.reason,
				})
				for (const a of this.library) await this.sort(a, [merged])
			} else if (change.op === "split") {
				const specs = this.fresh(change.into)
				if (specs.length < 2) continue
				const t = targets[0]!
				this.retire([t], `split: ${change.reason}`)
				const parts = specs.map((spec) => this.addTopic(spec, "split", change.reason))
				this.carryRefusals([t], parts)
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

	/**
	 * The model's topics that can be, as production keeps them: no name of a topic in use, or one
	 * the reader removed, or one that comes twice.
	 */
	private fresh<T extends TopicSpec>(specs: T[]): T[] {
		const names = new Set(
			this.topics
				.filter((t) => t.retiredAt === undefined || t.removed)
				.map((t) => t.name.toLocaleLowerCase()),
		)
		return specs.filter((t) => {
			const name = t.name.trim().toLocaleLowerCase()
			if (!name || names.has(name)) return false
			names.add(name)
			return true
		})
	}

	private refusedFor(articleId: string): Set<string> {
		return new Set(this.refusals.filter((r) => r.articleId === articleId).map((r) => r.topicId))
	}

	/** An article the reader took out of any of `from` stays out of each of `to`. */
	private carryRefusals(from: Topic[], to: Topic[]) {
		const ids = new Set(from.map((t) => t.id))
		const articles = new Set(
			this.refusals.filter((r) => ids.has(r.topicId)).map((r) => r.articleId),
		)
		for (const articleId of articles)
			for (const t of to)
				this.refusals.push({ articleId, topicId: t.id, at: this.step, carried: true })
	}

	/** Whether the reader looks at this article: the same articles in every run. */
	private attends(articleId: string): boolean {
		const h = [...articleId].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7)
		return (h % 1000) / 1000 < this.config.attention
	}

	/** The topics the reader would look for an article on, among `topics`. */
	private async judge(article: Article, topics: Topic[], purpose: string): Promise<Set<string>> {
		if (topics.length === 0) return new Set()
		const answer = await this.models.reader(purpose, {
			...judgeRequest(
				article,
				topics.map((t) => ({ ref: t.id, name: t.name, description: t.description })),
				this.config.taste,
			),
			sample: this.config.sample,
		})
		// Only the topics it was shown: a name or an id it made up is no topic.
		const shown = new Set(topics.map((t) => t.id))
		return new Set(answer.topicIds.filter((id) => shown.has(id)))
	}

	/**
	 * The reader's look at their topics: perhaps a rename or a removal (`tidy`), then the articles
	 * they look at taken out of topics where they would not look for them.
	 */
	private async read(tidy: boolean) {
		if (tidy) await this.tidy(false)
		const takenOut: { articleId: string; topicId: string }[] = []
		const active = this.active()
		for (const article of this.library) {
			if (!this.attends(article.id)) continue
			const applied = (this.assignments.get(article.id) ?? []).filter((a) => a.level === "applied")
			const unjudged = applied.filter((a) => {
				const t = active.find((x) => x.id === a.topicId)
				return t && !this.judged.has(`${article.id}|${t.id}|${t.name}|${t.description}`)
			})
			if (unjudged.length === 0) continue
			const wanted = await this.judge(article, active, "judge")
			for (const a of unjudged) {
				const t = active.find((x) => x.id === a.topicId)!
				this.judged.add(`${article.id}|${t.id}|${t.name}|${t.description}`)
				if (wanted.has(t.id)) continue
				this.refusals.push({ articleId: article.id, topicId: t.id, at: this.step })
				takenOut.push({ articleId: article.id, topicId: t.id })
			}
			this.assignments.set(
				article.id,
				(this.assignments.get(article.id) ?? []).filter(
					(a) => !takenOut.some((o) => o.articleId === article.id && o.topicId === a.topicId),
				),
			)
		}
		this.unsorted = this.library.filter((a) => !this.isSorted(a.id)).map((a) => a.id)
		if (takenOut.length) this.events.push({ step: this.step, type: "reader", takenOut })
		if (takenOut.length)
			this.log(
				`  ✋ reader took out ${takenOut.map((o) => `${this.topicName(o.topicId)}`).join(", ")}`,
			)
	}

	/** Perhaps the reader renames or removes one topic; at confirmation, one of the first topics. */
	private async tidy(confirming: boolean) {
		const active = this.active()
		const answer = await this.models.reader("tidy", {
			...tidyRequest(
				active.map((t) => {
					const list = this.members(t.id)
					return {
						ref: t.id,
						name: t.name,
						description: t.description,
						articles: list.length,
						titles: list.slice(-5).map((a) => a.title),
					}
				}),
				confirming,
				this.config.taste,
			),
			sample: this.config.sample,
		})
		const { op, topicId, name } = answer.change
		const t = active.find((x) => x.id === topicId)
		if (!t || op === "none") return
		if (op === "remove") {
			this.retire([t], "removed by the reader")
			t.removed = true
			this.events.push({
				step: this.step,
				type: "reader",
				takenOut: [],
				change: { op, topicId: t.id, from: t.name },
			})
			this.log(`  ✋ reader removed ${t.name}`)
			return
		}
		const clean = name.trim()
		// As production: any name but another topic's in use, a removed one included.
		const taken = active.some(
			(x) => x.id !== t.id && x.name.toLocaleLowerCase() === clean.toLocaleLowerCase(),
		)
		if (!clean || taken) return undefined
		const from = t.name
		t.renamedFrom = [...(t.renamedFrom ?? []), t.name]
		t.name = clean
		t.namedByReader = true
		this.events.push({
			step: this.step,
			type: "reader",
			takenOut: [],
			change: { op, topicId: t.id, from, to: clean },
		})
		this.log(`  ✋ reader renamed ${from} to ${clean}`)
	}

	/** The final topics, each article of the library judged by the reader against all of them. */
	async audit(): Promise<Audit> {
		const active = this.active()
		const audit: Audit = { applied: 0, agreed: 0, wanted: 0 }
		for (const article of this.library) {
			const wanted = await this.judge(article, active, "audit")
			const applied = new Set(
				(this.assignments.get(article.id) ?? [])
					.filter((a) => a.level === "applied")
					.map((a) => a.topicId),
			)
			audit.applied += applied.size
			audit.wanted += wanted.size
			for (const id of applied) if (wanted.has(id)) audit.agreed++
		}
		return audit
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
			refusals: this.refusals,
		}
	}
}
