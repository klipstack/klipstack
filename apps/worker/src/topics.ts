import {
	type AiLanguage,
	place,
	type Placement,
	type ReviewChange,
	TOPIC_RULES,
	type TopicArticleIn,
	type TopicIn,
	type TopicModels,
	type TopicSpend,
	type TopicSpec,
	estimateCostUsd,
} from "@klipstack/ai"
import {
	addUsage,
	and,
	asc,
	db,
	desc,
	documents,
	documentTopics,
	documentVersions,
	eq,
	inArray,
	isNotNull,
	isNull,
	monthOf,
	notExists,
	sql,
	topicLibraries,
	topicSorts,
	topics,
	usageCounts,
	user,
	userFeatures,
} from "@klipstack/db"

/**
 * A reader's automatic topics, brought up to date by one run of the `topics` job. A run does what
 * is due, in order: propose the first topics once the library is big enough; after the reader
 * confirms them, sort the articles not sorted yet; then grow new topics from the articles none
 * holds, and review the topics now and then. Runs for one reader never overlap (the queue's
 * `stately` policy), and a run that fails is tried again from what is still due.
 */

export interface TopicsDeps {
	models: Pick<TopicModels, "available" | "propose" | "grow" | "review" | "sort">
	/** Haiku's work (propose, grow, review) an account may have a month. */
	limit: number
	/** Queues another run for the reader, for what this one left (a library bigger than a batch). */
	again: () => Promise<void>
	/** Articles sorted in one run (`SORT_BATCH`); tests make it small. */
	batch?: number
}

export type TopicsOutcome =
	| { done: "nothing"; why: "off" | "no-feature" | "unavailable" | "waiting" | "capped" }
	| { done: "proposed"; topics: number }
	| { done: "sorted"; articles: number; grew: number; widened: number; reviewed: boolean }

const RULES = TOPIC_RULES
/** Articles sorted in one run; more are left to the next. */
export const SORT_BATCH = 200
/** The newest articles a first proposal reads; a large library's older ones don't change it much. */
const PROPOSE_MAX = 200
/** The newest unsorted articles a growth reads. */
const GROW_MAX = 40

export async function bringTopicsUpToDate(
	userId: string,
	deps: TopicsDeps,
): Promise<TopicsOutcome> {
	const [library] = await db.select().from(topicLibraries).where(eq(topicLibraries.userId, userId))
	if (!library) return { done: "nothing", why: "off" }
	// Turned off for the account by an admin: its topics stay as they are, and nothing runs.
	const [feature] = await db
		.select({ userId: userFeatures.userId })
		.from(userFeatures)
		.where(and(eq(userFeatures.userId, userId), eq(userFeatures.feature, "topics")))
	if (!feature) return { done: "nothing", why: "no-feature" }
	if (!deps.models.available) return { done: "nothing", why: "unavailable" }
	const [account] = await db.select({ locale: user.locale }).from(user).where(eq(user.id, userId))
	const language: AiLanguage = account?.locale === "es" ? "es" : "en"
	const run = new Run(userId, language, deps)

	if (!library.confirmedAt) {
		if (library.proposedAt) return { done: "nothing", why: "waiting" }
		return run.propose(library.proposedAtCount)
	}
	return run.keepUp(library)
}

class Run {
	constructor(
		readonly userId: string,
		readonly language: AiLanguage,
		readonly deps: TopicsDeps,
	) {}

	/** The first topics, from the newest articles, once the library has enough of them. */
	async propose(lastCount: number | null): Promise<TopicsOutcome> {
		const count = await this.libraryCount()
		if (count < RULES.bootstrapSize) return { done: "nothing", why: "waiting" }
		// A proposal that came back empty waits for more articles before asking again.
		if (lastCount !== null && count < lastCount + RULES.poolSize)
			return { done: "nothing", why: "waiting" }
		if (!(await this.takeWork())) return { done: "nothing", why: "capped" }
		const articles = await this.articles({ newest: PROPOSE_MAX })
		const answer = await this.deps.models.propose({ articles, language: this.language })
		await this.spent(answer.spend)
		// Only an answer counts as an ask: until then the page says the topics are on their way, and a
		// failed request is tried again without waiting for more articles.
		await db
			.update(topicLibraries)
			.set({ proposedAtCount: count })
			.where(eq(topicLibraries.userId, this.userId))
		const fresh = await this.withoutRemoved(answer.value)
		if (fresh.length === 0) return { done: "proposed", topics: 0 }
		await db.transaction(async (tx) => {
			await tx.insert(topics).values(
				fresh.map((t) => ({
					userId: this.userId,
					name: t.name,
					description: t.description,
					status: "proposed" as const,
					origin: "first" as const,
				})),
			)
			await tx
				.update(topicLibraries)
				.set({ proposedAt: new Date() })
				.where(eq(topicLibraries.userId, this.userId))
		})
		return { done: "proposed", topics: fresh.length }
	}

	/** After the reader confirmed: sort what is new, then grow and review when due. */
	async keepUp(library: typeof topicLibraries.$inferSelect): Promise<TopicsOutcome> {
		const batch = this.deps.batch ?? SORT_BATCH
		const pending = await this.articles({ unsorted: true, limit: batch })
		const active = await this.activeTopics()
		// The library's first sort, right after the reader confirmed, does not call for a review:
		// only articles saved since do.
		const counts = library.librarySortedAt !== null
		for (const article of pending) await this.sortInto(article, active, { first: true, counts })
		if (pending.length === batch) {
			await this.deps.again()
			return { done: "sorted", articles: pending.length, grew: 0, widened: 0, reviewed: false }
		}
		if (!counts)
			await db
				.update(topicLibraries)
				.set({ librarySortedAt: new Date() })
				.where(eq(topicLibraries.userId, this.userId))
		const growth = await this.grow(library.unsortedAtLastGrow)
		const [after] = await db
			.select({ sortedSinceReview: topicLibraries.sortedSinceReview })
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, this.userId))
		const reviewed =
			(after?.sortedSinceReview ?? 0) >= RULES.reviewEvery ? await this.review() : false
		return { done: "sorted", articles: pending.length, ...growth, reviewed }
	}

	/**
	 * New topics, or wider descriptions, for the articles no topic holds, once enough more of them
	 * piled up since the last time. The whole library is then sorted into what changed.
	 */
	async grow(unsortedAtLastGrow: number): Promise<{ grew: number; widened: number }> {
		const pool = await this.unsorted()
		if (pool.length < RULES.poolSize || pool.length < unsortedAtLastGrow + RULES.poolSize)
			return { grew: 0, widened: 0 }
		if (!(await this.takeWork())) return { grew: 0, widened: 0 }
		await this.setUnsortedAtLastGrow(pool.length)
		const active = await this.activeTopics()
		const answer = await this.deps.models.grow({
			topics: active,
			pool: pool.slice(0, GROW_MAX),
			language: this.language,
		})
		await this.spent(answer.spend)
		const widened: TopicIn[] = []
		for (const w of answer.value.widen) {
			const topic = active.find((t) => t.id === w.topicId)
			if (!topic) continue
			await db.update(topics).set({ description: w.description }).where(eq(topics.id, topic.id))
			widened.push({ ...topic, description: w.description })
		}
		const fresh = await this.withoutRemoved(answer.value.topics)
		const created = await this.createTopics(fresh, "grown")
		if (widened.length + created.length === 0) return { grew: 0, widened: 0 }
		await this.resortLibrary([...widened, ...created])
		await this.setUnsortedAtLastGrow((await this.unsorted()).length)
		return { grew: created.length, widened: widened.length }
	}

	/** Merges, splits, renames or retires topics when Haiku finds a change that clearly helps. */
	async review(): Promise<boolean> {
		if (!(await this.takeWork())) return false
		await db
			.update(topicLibraries)
			.set({ sortedSinceReview: 0 })
			.where(eq(topicLibraries.userId, this.userId))
		const active = await this.activeTopics()
		if (active.length === 0) return true
		const library = await this.articles({ sorted: true })
		const position = new Map(library.map((a, i) => [a.id, i + 1]))
		const applied = await this.appliedRows(active.map((t) => t.id))
		const members = (topicId: string) =>
			applied.filter((r) => r.topicId === topicId && position.has(r.documentId))
		const pairs: { a: string; b: string; count: number }[] = []
		for (let i = 0; i < active.length; i++)
			for (let j = i + 1; j < active.length; j++) {
				const a = new Set(members(active[i]!.id).map((r) => r.documentId))
				const count = members(active[j]!.id).filter((r) => a.has(r.documentId)).length
				if (count >= 2) pairs.push({ a: active[i]!.id, b: active[j]!.id, count })
			}
		const titles = new Map(library.map((a) => [a.id, a.title]))
		const unsorted = (await this.unsorted()).length
		const answer = await this.deps.models.review({
			libraryCount: library.length,
			sortedCount: library.length - unsorted,
			unsortedCount: unsorted,
			topics: active.map((t) => {
				const list = members(t.id)
					.map((r) => r.documentId)
					.sort((x, y) => position.get(x)! - position.get(y)!)
				return {
					...t,
					articles: list.length,
					lastAt: list.length ? position.get(list.at(-1)!)! : 0,
					titles: list.slice(-6).map((id) => titles.get(id)!),
				}
			}),
			pairs,
			language: this.language,
		})
		await this.spent(answer.spend)
		for (const change of answer.value.changes) await this.apply(change, active)
		return true
	}

	/** One change from a review. A merged or split topic's refusals pass to what replaces it. */
	async apply(change: ReviewChange, active: (TopicIn & { namedByReader: boolean })[]) {
		const targets = change.topicIds.flatMap((id) => active.filter((t) => t.id === id))
		const current = await this.activeTopics()
		const live = targets.filter((t) => current.some((c) => c.id === t.id))
		if (live.length === 0) return
		const [into] = change.into
		if (change.op === "rename" && into) {
			const t = live[0]!
			// A name the reader chose stays; the description may still be sharpened.
			const name = t.namedByReader ? t.name : into.name
			await db
				.update(topics)
				.set({ name, description: into.description })
				.where(eq(topics.id, t.id))
			await this.resortLibrary([{ id: t.id, name, description: into.description }])
		} else if (change.op === "retire") {
			await this.end(live.map((t) => t.id))
		} else if (change.op === "merge" && live.length >= 2 && into) {
			const [merged] = await this.createTopics([into], "merged")
			await this.carryRefusals(
				live.map((t) => t.id),
				[merged!.id],
			)
			await this.end(live.map((t) => t.id))
			await this.resortLibrary([merged!])
		} else if (change.op === "split" && change.into.length >= 2) {
			const parts = await this.createTopics(change.into, "split")
			await this.carryRefusals(
				[live[0]!.id],
				parts.map((p) => p.id),
			)
			await this.end([live[0]!.id])
			await this.resortLibrary(parts)
		}
	}

	/** Sorts every sorted article again, into `changed` topics only. */
	async resortLibrary(changed: TopicIn[]) {
		const library = await this.articles({ sorted: true })
		for (const article of library)
			await this.sortInto(article, changed, { first: false, counts: false })
	}

	/**
	 * Scores an article against `scored` topics and records where it stands: what it has from
	 * other topics stays, and a topic the reader took it out of never comes back. `first`: its
	 * first sort; `counts`: one towards the next review.
	 */
	async sortInto(
		article: TopicArticleIn,
		scored: TopicIn[],
		{ first, counts }: { first: boolean; counts: boolean },
	) {
		const answer = await this.deps.models.sort({ article, topics: scored })
		await this.spent(answer.spend)
		const scores = Object.fromEntries(scored.map((t) => [t.id, answer.value[t.id] ?? 0]))
		await db.transaction(async (tx) => {
			const rows = await tx
				.select()
				.from(documentTopics)
				.innerJoin(topics, eq(topics.id, documentTopics.topicId))
				.where(and(eq(documentTopics.documentId, article.id), eq(topics.status, "active")))
			const refused = new Set(
				rows.filter((r) => r.document_topics.refusedAt).map((r) => r.document_topics.topicId),
			)
			const kept: Placement[] = rows
				.filter((r) => !r.document_topics.refusedAt)
				.map((r) => ({
					topicId: r.document_topics.topicId,
					p: r.document_topics.probability,
					level: r.document_topics.level,
				}))
			const placed = place(kept, scores, RULES, refused)
			await tx
				.delete(documentTopics)
				.where(and(eq(documentTopics.documentId, article.id), isNull(documentTopics.refusedAt)))
			if (placed.length)
				await tx.insert(documentTopics).values(
					placed.map((p) => ({
						documentId: article.id,
						topicId: p.topicId,
						probability: p.p,
						level: p.level,
					})),
				)
			if (first)
				await tx
					.insert(topicSorts)
					.values({ documentId: article.id, userId: this.userId })
					.onConflictDoNothing()
			if (counts)
				await tx
					.update(topicLibraries)
					.set({ sortedSinceReview: sql`${topicLibraries.sortedSinceReview} + 1` })
					.where(eq(topicLibraries.userId, this.userId))
		})
	}

	async createTopics(specs: TopicSpec[], origin: "grown" | "split" | "merged"): Promise<TopicIn[]> {
		if (specs.length === 0) return []
		return db
			.insert(topics)
			.values(
				specs.map((t) => ({
					userId: this.userId,
					name: t.name,
					description: t.description,
					status: "active" as const,
					origin,
				})),
			)
			.returning({ id: topics.id, name: topics.name, description: topics.description })
	}

	/** Retires topics; the articles lose them, refusals included (nothing sorts into them again). */
	async end(topicIds: string[]) {
		await db.transaction(async (tx) => {
			await tx
				.update(topics)
				.set({ status: "retired", endedAt: new Date() })
				.where(inArray(topics.id, topicIds))
			await tx.delete(documentTopics).where(inArray(documentTopics.topicId, topicIds))
		})
	}

	/** An article the reader took out of any of `from` stays out of each of `to`. */
	async carryRefusals(from: string[], to: string[]) {
		const refused = await db
			.selectDistinct({ documentId: documentTopics.documentId })
			.from(documentTopics)
			.where(and(inArray(documentTopics.topicId, from), isNotNull(documentTopics.refusedAt)))
		if (refused.length === 0) return
		const now = new Date()
		await db
			.insert(documentTopics)
			.values(
				to.flatMap((topicId) =>
					refused.map((r) => ({
						documentId: r.documentId,
						topicId,
						probability: 0,
						level: "suggested" as const,
						refusedAt: now,
					})),
				),
			)
			.onConflictDoNothing()
	}

	/** Proposed topics the reader removed once, by name, are not proposed again. */
	async withoutRemoved<T extends TopicSpec>(specs: T[]): Promise<T[]> {
		const taken = await db
			.select({ name: topics.name })
			.from(topics)
			.where(
				and(
					eq(topics.userId, this.userId),
					inArray(topics.status, ["removed", "active", "proposed"]),
				),
			)
		const names = new Set(taken.map((t) => t.name.toLocaleLowerCase()))
		return specs.filter((t) => {
			const name = t.name.toLocaleLowerCase()
			if (names.has(name)) return false
			names.add(name)
			return true
		})
	}

	async activeTopics() {
		return db
			.select({
				id: topics.id,
				name: topics.name,
				description: topics.description,
				namedByReader: topics.namedByReader,
			})
			.from(topics)
			.where(and(eq(topics.userId, this.userId), eq(topics.status, "active")))
			.orderBy(asc(topics.createdAt), asc(topics.id))
	}

	async appliedRows(topicIds: string[]) {
		if (topicIds.length === 0) return []
		return db
			.select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
			.from(documentTopics)
			.where(
				and(
					inArray(documentTopics.topicId, topicIds),
					eq(documentTopics.level, "applied"),
					isNull(documentTopics.refusedAt),
				),
			)
	}

	/** The library's articles: ready, not in the trash, oldest first (newest first with `newest`). */
	async articles(
		options: { unsorted?: boolean; sorted?: boolean; limit?: number; newest?: number } = {},
	): Promise<(TopicArticleIn & { createdAt: Date })[]> {
		const sorted = db
			.select({ id: topicSorts.documentId })
			.from(topicSorts)
			.where(eq(topicSorts.documentId, documents.id))
		const query = db
			.select({
				id: documents.id,
				title: documents.title,
				siteName: documents.siteName,
				description: documents.description,
				text: sql<string>`left(${documentVersions.text}, ${RULES.textChars})`,
				createdAt: documents.createdAt,
			})
			.from(documents)
			.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
			.where(
				and(
					eq(documents.userId, this.userId),
					eq(documents.status, "ready"),
					eq(documents.type, "article"),
					isNull(documents.deletedAt),
					options.unsorted ? notExists(sorted) : undefined,
					options.sorted
						? sql`exists (select 1 from ${topicSorts} where ${topicSorts.documentId} = ${documents.id})`
						: undefined,
				),
			)
			.orderBy(
				options.newest ? desc(documents.createdAt) : asc(documents.createdAt),
				asc(documents.id),
			)
			.limit(options.newest ?? options.limit ?? 1_000_000)
		const rows = await query
		const list = options.newest ? rows.reverse() : rows
		return list.map((r) => ({ ...r, title: r.title ?? "(untitled)" }))
	}

	async libraryCount(): Promise<number> {
		const [row] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(documents)
			.where(
				and(
					eq(documents.userId, this.userId),
					eq(documents.status, "ready"),
					eq(documents.type, "article"),
					isNull(documents.deletedAt),
				),
			)
		return row?.count ?? 0
	}

	/** Sorted articles in no topic, newest first. */
	async unsorted() {
		const library = await this.articles({ sorted: true })
		const active = (await this.activeTopics()).map((t) => t.id)
		const placed = new Set((await this.appliedRows(active)).map((r) => r.documentId))
		return library.filter((a) => !placed.has(a.id)).reverse()
	}

	async setUnsortedAtLastGrow(count: number) {
		await db
			.update(topicLibraries)
			.set({ unsortedAtLastGrow: count })
			.where(eq(topicLibraries.userId, this.userId))
	}

	/**
	 * Counts one piece of Haiku's work this month, unless the account has had its `limit`: then
	 * nothing is counted, and the work waits for next month (sorting goes on).
	 */
	async takeWork(): Promise<boolean> {
		const { month } = monthOf()
		const [row] = await db
			.select({ count: usageCounts.count })
			.from(usageCounts)
			.where(
				and(
					eq(usageCounts.userId, this.userId),
					eq(usageCounts.metric, "topics"),
					eq(usageCounts.month, month),
				),
			)
		if ((row?.count ?? 0) >= this.deps.limit) return false
		await addUsage(db, this.userId, "topics")
		return true
	}

	/** What the requests cost, added to the account's AI spend for admins. */
	async spent(spend: TopicSpend[]) {
		const micros = Math.round(
			spend.reduce((sum, s) => sum + estimateCostUsd(s.model, s), 0) * 1_000_000,
		)
		if (micros > 0) await addUsage(db, this.userId, "ai_spend", micros)
	}
}
