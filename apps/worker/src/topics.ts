import {
	type AiLanguage,
	estimateCostUsd,
	place,
	type Placement,
	type ReviewChange,
	retryable,
	TOPIC_RULES,
	type TopicArticleIn,
	type TopicIn,
	type TopicModels,
	type TopicSpec,
	type TopicSpend,
} from "@klipstack/ai"
import { cleanTopicName } from "@klipstack/api-contract/names"
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
	exists,
	inArray,
	isNotNull,
	isNull,
	monthOf,
	not,
	notExists,
	type SQL,
	sql,
	type Tx,
	topicLibraries,
	topicSorts,
	topics,
	usageCounts,
	user,
	userFeatures,
} from "@klipstack/db"
import { log } from "./log"

/**
 * A reader's automatic topics, brought up to date by one run of the `topics` job. A run does what
 * is due, in order, and at most a batch of articles' worth of sorting:
 *
 * 1. Before the reader confirmed: propose the first topics once the library is big enough.
 * 2. Sort the articles not sorted yet into the topics.
 * 3. Sort the library again into the topics new or changed since (`resortPending`), from where the
 *    last run stopped.
 * 4. Grow new topics, or widen existing ones, from the articles no topic holds.
 * 5. Review the topics every so many new articles.
 *
 * What is left goes to the next run (`again`). Runs for one reader never overlap (the queue's
 * `stately` policy). Every write first checks that the reader still has topics on: one turned
 * off mid-run stops the run, and nothing it learned is kept.
 */

export interface TopicsDeps {
	models: Pick<TopicModels, "available" | "propose" | "grow" | "review" | "sort">
	/** Haiku's work (propose, grow, review) an account may have a month. */
	limit: number
	/** Queues another run for the reader, for what this one left. */
	again: () => Promise<void>
	/** Articles sorted in one run (`SORT_BATCH`); tests make it small. */
	batch?: number
}

export type TopicsOutcome =
	| { done: "nothing"; why: "off" | "no-feature" | "unavailable" | "waiting" | "capped" }
	| { done: "proposed"; topics: number }
	| {
			done: "sorted"
			articles: number
			resorted: number
			grew: number
			widened: number
			reviewed: boolean
	  }

const RULES = TOPIC_RULES
/** Articles sorted, or sorted again, in one run; more are left to the next. */
export const SORT_BATCH = 200
/** The newest articles a first proposal reads: a large library's older ones change it little. */
export const PROPOSE_MAX = 200
/** The newest unsorted articles a growth reads. */
const GROW_MAX = 40
/** A model's description longer than this is cut: it is a sentence or two. */
const DESCRIPTION_MAX = 600

/** The reader turned topics off while the run was on: it stops, keeping nothing. */
class TopicsOff extends Error {}

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
	try {
		if (!library.confirmedAt) {
			if (library.proposedAt) return { done: "nothing", why: "waiting" }
			return await run.propose(library.proposedAtCount)
		}
		return await run.keepUp(library)
	} catch (error) {
		if (error instanceof TopicsOff) return { done: "nothing", why: "off" }
		throw error
	}
}

type Library = typeof topicLibraries.$inferSelect
type ActiveTopic = TopicIn & { namedByReader: boolean; resortPending: boolean }

class Run {
	readonly batch: number

	constructor(
		readonly userId: string,
		readonly language: AiLanguage,
		readonly deps: TopicsDeps,
	) {
		this.batch = deps.batch ?? SORT_BATCH
	}

	/** A change, once it is sure the reader still has topics on; the row is locked meanwhile. */
	async write<T>(change: (tx: Tx) => Promise<T>): Promise<T> {
		return db.transaction(async (tx) => {
			const [library] = await tx
				.select({ userId: topicLibraries.userId })
				.from(topicLibraries)
				.where(eq(topicLibraries.userId, this.userId))
				.for("share")
			if (!library) throw new TopicsOff()
			return change(tx)
		})
	}

	async setLibrary(values: Partial<Library>) {
		await this.write((tx) =>
			tx.update(topicLibraries).set(values).where(eq(topicLibraries.userId, this.userId)),
		)
	}

	/** The first topics, from the newest articles, once the library has enough of them. */
	async propose(lastCount: number | null): Promise<TopicsOutcome> {
		const count = await this.libraryCount()
		if (count < RULES.bootstrapSize) return { done: "nothing", why: "waiting" }
		// A proposal that came back empty waits for more articles before asking again.
		if (lastCount !== null && count < lastCount + RULES.poolSize)
			return { done: "nothing", why: "waiting" }
		if (!(await this.mayWork())) return { done: "nothing", why: "capped" }
		const articles = await this.articles({ newest: PROPOSE_MAX })
		const answer = await this.deps.models.propose({ articles, language: this.language })
		await this.worked(answer.spend)
		const fresh = await this.fresh(answer.value)
		// Only an answer counts as an ask: until then the page says the topics are on their way, and a
		// failed request is tried again without waiting for more articles.
		await this.write(async (tx) => {
			if (fresh.length)
				await tx
					.insert(topics)
					.values(
						fresh.map((t) => ({
							userId: this.userId,
							name: t.name,
							description: t.description,
							status: "proposed" as const,
							origin: "first" as const,
						})),
					)
					.onConflictDoNothing()
			await tx
				.update(topicLibraries)
				.set({ proposedAtCount: count, ...(fresh.length ? { proposedAt: new Date() } : {}) })
				.where(eq(topicLibraries.userId, this.userId))
		})
		return { done: "proposed", topics: fresh.length }
	}

	/** After the reader confirmed: sort what is new, sort again what changed, then grow and review. */
	async keepUp(library: Library): Promise<TopicsOutcome> {
		const outcome = { articles: 0, resorted: 0, grew: 0, widened: 0, reviewed: false }
		const done = () => ({ done: "sorted" as const, ...outcome })
		const later = async () => {
			await this.deps.again()
			return done()
		}

		const pending = await this.articles({ unsorted: true, limit: this.batch })
		const active = await this.activeTopics()
		// The library's first sort, right after the reader confirmed, does not call for a review:
		// only articles saved since do.
		const counts = library.librarySortedAt !== null
		for (const article of pending)
			await this.sortInto(article, active, { first: true, counts, refusedFirst: true })
		outcome.articles = pending.length
		if (pending.length === this.batch) return later()
		if (!counts) await this.setLibrary({ librarySortedAt: new Date() })

		const resort = await this.resort(library)
		outcome.resorted = resort.articles
		if (!resort.finished) return later()

		const growth = await this.grow(library.unsortedAtLastGrow)
		outcome.grew = growth.grew
		outcome.widened = growth.widened
		if (growth.grew + growth.widened > 0) return later()

		const [fresh] = await db
			.select({ sortedSinceReview: topicLibraries.sortedSinceReview })
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, this.userId))
		if ((fresh?.sortedSinceReview ?? 0) >= RULES.reviewEvery) {
			outcome.reviewed = await this.review()
			if ((await this.activeTopics()).some((t) => t.resortPending)) return later()
		}
		return done()
	}

	/**
	 * Sorts a batch of the library again into the topics that need it, after the article the last
	 * batch stopped at. `finished` once the library's end is reached: the topics are up to date.
	 */
	async resort(library: Library): Promise<{ articles: number; finished: boolean }> {
		const changed = (await this.activeTopics()).filter((t) => t.resortPending)
		if (changed.length === 0) return { articles: 0, finished: true }
		const after =
			library.resortAfterAt && library.resortAfterId
				? { at: library.resortAfterAt, id: library.resortAfterId }
				: null
		const batch = await this.articles({ sorted: true, after, limit: this.batch })
		for (const article of batch)
			await this.sortInto(article, changed, { first: false, counts: false, refusedFirst: false })
		const last = batch.at(-1)
		if (batch.length === this.batch && last) {
			await this.setLibrary({ resortAfterAt: last.createdAt, resortAfterId: last.id })
			return { articles: batch.length, finished: false }
		}
		await this.write(async (tx) => {
			await tx
				.update(topics)
				.set({ resortPending: false })
				.where(
					inArray(
						topics.id,
						changed.map((t) => t.id),
					),
				)
			await tx
				.update(topicLibraries)
				.set({ resortAfterAt: null, resortAfterId: null })
				.where(eq(topicLibraries.userId, this.userId))
		})
		return { articles: batch.length, finished: true }
	}

	/** Marks topics for the library to be sorted again into them, from its first article. */
	async needsResort(tx: Tx, topicIds: string[]) {
		if (topicIds.length === 0) return
		await tx.update(topics).set({ resortPending: true }).where(inArray(topics.id, topicIds))
		await tx
			.update(topicLibraries)
			.set({ resortAfterAt: null, resortAfterId: null })
			.where(eq(topicLibraries.userId, this.userId))
	}

	/**
	 * New topics, or wider descriptions, for the articles no topic holds, once enough more of them
	 * piled up since the last time. The library is then sorted again into what changed.
	 */
	async grow(unsortedAtLastGrow: number): Promise<{ grew: number; widened: number }> {
		const none = { grew: 0, widened: 0 }
		const unsorted = await this.unsortedCount()
		if (unsorted < RULES.poolSize || unsorted < unsortedAtLastGrow + RULES.poolSize) return none
		if (!(await this.mayWork())) return none
		const active = await this.activeTopics()
		const answer = await this.deps.models.grow({
			topics: active,
			pool: await this.articles({ unsortedInTopics: true, newest: GROW_MAX }),
			language: this.language,
		})
		await this.worked(answer.spend)
		const fresh = await this.fresh(answer.value.topics)
		const widen = answer.value.widen.flatMap((w) => {
			const description = cleanDescription(w.description)
			return description && active.some((t) => t.id === w.topicId)
				? [{ topicId: w.topicId, description }]
				: []
		})
		return this.write(async (tx) => {
			// What a growth asked for is settled, whatever it brought: the next waits for more.
			await tx
				.update(topicLibraries)
				.set({ unsortedAtLastGrow: unsorted })
				.where(eq(topicLibraries.userId, this.userId))
			for (const w of widen)
				await tx
					.update(topics)
					.set({ description: w.description })
					.where(and(eq(topics.id, w.topicId), eq(topics.status, "active")))
			const created = await this.createTopics(tx, fresh, "grown")
			await this.needsResort(tx, [...widen.map((w) => w.topicId), ...created.map((t) => t.id)])
			return { grew: created.length, widened: widen.length }
		})
	}

	/**
	 * Merges, splits, renames or retires topics when Haiku finds a change that clearly helps. A
	 * topic the reader named is theirs: a review only sharpens its description.
	 */
	async review(): Promise<boolean> {
		if (!(await this.mayWork())) return false
		const active = await this.activeTopics()
		if (active.length === 0) {
			await this.setLibrary({ sortedSinceReview: 0 })
			return false
		}
		const library = await this.articles({ sorted: true, withText: false })
		const position = new Map(library.map((a, i) => [a.id, i + 1]))
		const applied = await this.appliedRows(active.map((t) => t.id))
		const members = (topicId: string) =>
			applied
				.filter((r) => r.topicId === topicId && position.has(r.documentId))
				.map((r) => r.documentId)
				.sort((x, y) => position.get(x)! - position.get(y)!)
		const pairs: { a: string; b: string; count: number }[] = []
		for (let i = 0; i < active.length; i++)
			for (let j = i + 1; j < active.length; j++) {
				const a = new Set(members(active[i]!.id))
				const count = members(active[j]!.id).filter((id) => a.has(id)).length
				if (count >= 2) pairs.push({ a: active[i]!.id, b: active[j]!.id, count })
			}
		const titles = new Map(library.map((a) => [a.id, a.title]))
		const unsorted = await this.unsortedCount()
		const answer = await this.deps.models.review({
			libraryCount: library.length,
			sortedCount: library.length - unsorted,
			unsortedCount: unsorted,
			topics: active.map((t) => {
				const list = members(t.id)
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
		await this.worked(answer.spend)
		await this.setLibrary({ sortedSinceReview: 0 })
		for (const change of answer.value.changes) await this.apply(change)
		return true
	}

	/** One change from a review, all of it or nothing. Refusals pass to what replaces a topic. */
	async apply(change: ReviewChange) {
		const into = await Promise.all(
			change.into.map(async (spec) => ({ spec, fresh: (await this.fresh([spec])).length > 0 })),
		)
		const description = (spec: TopicSpec | undefined) => cleanDescription(spec?.description ?? "")
		await this.write(async (tx) => {
			const live = await tx
				.select({ id: topics.id, namedByReader: topics.namedByReader })
				.from(topics)
				.where(
					and(
						inArray(topics.id, change.topicIds),
						eq(topics.userId, this.userId),
						eq(topics.status, "active"),
					),
				)
				.for("update")
			if (live.length === 0) return
			const theirs = live.some((t) => t.namedByReader)
			const first = into[0]
			if (change.op === "rename" && first) {
				const sharpened = description(first.spec)
				if (!sharpened) return
				const t = live[0]!
				// The reader's name, or one already taken, stays; the description is sharpened all the same.
				const name = !t.namedByReader && first.fresh ? cleanTopicName(first.spec.name)! : undefined
				await tx
					.update(topics)
					.set({ description: sharpened, ...(name ? { name } : {}) })
					.where(eq(topics.id, t.id))
				await this.needsResort(tx, [t.id])
			} else if (theirs) {
				return
			} else if (change.op === "retire") {
				await this.end(
					tx,
					live.map((t) => t.id),
				)
			} else if (change.op === "merge" && live.length >= 2 && first?.fresh) {
				const merged = await this.createTopics(tx, [first.spec], "merged")
				await this.carryRefusals(
					tx,
					live.map((t) => t.id),
					merged.map((t) => t.id),
				)
				await this.end(
					tx,
					live.map((t) => t.id),
				)
				await this.needsResort(
					tx,
					merged.map((t) => t.id),
				)
			} else if (change.op === "split" && into.filter((i) => i.fresh).length >= 2) {
				const parts = await this.createTopics(
					tx,
					into.filter((i) => i.fresh).map((i) => i.spec),
					"split",
				)
				const ids = parts.map((p) => p.id)
				await this.carryRefusals(tx, [live[0]!.id], ids)
				await this.end(tx, [live[0]!.id])
				await this.needsResort(tx, ids)
			}
		})
	}

	/**
	 * Scores an article against `scored` topics and records where it stands: what it has from
	 * other topics stays, and a topic the reader took it out of never comes back. `first`: its
	 * first sort; `counts`: one towards the next review. An article a provider refuses to sort is
	 * left out of the topics (`refusedFirst`: and counted as sorted), not retried forever.
	 */
	async sortInto(
		article: TopicArticleIn,
		scored: TopicIn[],
		{ first, counts, refusedFirst }: { first: boolean; counts: boolean; refusedFirst: boolean },
	) {
		let scores: Record<string, number> = {}
		try {
			const answer = await this.deps.models.sort({ article, topics: scored })
			await this.spent(answer.spend)
			scores = Object.fromEntries(scored.map((t) => [t.id, answer.value[t.id] ?? 0]))
		} catch (error) {
			if (retryable(error)) throw error
			log.warn("topics: an article was refused", { documentId: article.id, error: String(error) })
			if (!refusedFirst) return
		}
		await this.write(async (tx) => {
			const rows = await tx
				.select()
				.from(documentTopics)
				.innerJoin(topics, eq(topics.id, documentTopics.topicId))
				.where(and(eq(documentTopics.documentId, article.id), eq(topics.status, "active")))
			// Only topics still active: one the reader removed meanwhile gets nothing.
			const live = new Set(
				scored.length === 0
					? []
					: (
							await tx
								.select({ id: topics.id })
								.from(topics)
								.where(
									and(
										eq(topics.userId, this.userId),
										eq(topics.status, "active"),
										inArray(
											topics.id,
											scored.map((t) => t.id),
										),
									),
								)
						).map((t) => t.id),
			)
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
			const placed = place(
				kept,
				Object.fromEntries(Object.entries(scores).filter(([id]) => live.has(id))),
				RULES,
				refused,
			)
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

	async createTopics(
		tx: Tx,
		specs: TopicSpec[],
		origin: "grown" | "split" | "merged",
	): Promise<TopicIn[]> {
		if (specs.length === 0) return []
		return (
			tx
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
				// A name the reader gave a topic meanwhile wins: the model's is skipped.
				.onConflictDoNothing()
				.returning({ id: topics.id, name: topics.name, description: topics.description })
		)
	}

	/** Retires topics; the articles lose them, refusals included (nothing sorts into them again). */
	async end(tx: Tx, topicIds: string[]) {
		await tx
			.update(topics)
			.set({ status: "retired", endedAt: new Date() })
			.where(inArray(topics.id, topicIds))
		await tx.delete(documentTopics).where(inArray(documentTopics.topicId, topicIds))
	}

	/** An article the reader took out of any of `from` stays out of each of `to`. */
	async carryRefusals(tx: Tx, from: string[], to: string[]) {
		const refused = await tx
			.selectDistinct({ documentId: documentTopics.documentId })
			.from(documentTopics)
			.where(and(inArray(documentTopics.topicId, from), isNotNull(documentTopics.refusedAt)))
		if (refused.length === 0 || to.length === 0) return
		const now = new Date()
		await tx
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

	/**
	 * The model's topics that can be: a name cleaned as the reader's would be, a description cut to
	 * size, and no name the reader has already, or removed once, or that comes twice.
	 */
	async fresh<T extends TopicSpec>(specs: T[]): Promise<T[]> {
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
		return specs.flatMap((t) => {
			const name = cleanTopicName(t.name)
			const description = cleanDescription(t.description)
			if (!name || !description || names.has(name.toLocaleLowerCase())) return []
			names.add(name.toLocaleLowerCase())
			return [{ ...t, name, description }]
		})
	}

	async activeTopics(): Promise<ActiveTopic[]> {
		return db
			.select({
				id: topics.id,
				name: topics.name,
				description: topics.description,
				namedByReader: topics.namedByReader,
				resortPending: topics.resortPending,
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

	/** Ready, not in the trash, an article (not a post): what the topics are about. */
	inLibrary(): SQL {
		return and(
			eq(documents.userId, this.userId),
			eq(documents.status, "ready"),
			eq(documents.type, "article"),
			isNull(documents.deletedAt),
		)!
	}

	/** Sorted already (`topic_sorts`), and in no active topic. */
	inNoTopic(): SQL {
		return and(
			exists(
				db
					.select({ id: topicSorts.documentId })
					.from(topicSorts)
					.where(eq(topicSorts.documentId, documents.id)),
			),
			not(
				exists(
					db
						.select({ id: documentTopics.documentId })
						.from(documentTopics)
						.innerJoin(topics, eq(topics.id, documentTopics.topicId))
						.where(
							and(
								eq(documentTopics.documentId, documents.id),
								eq(documentTopics.level, "applied"),
								isNull(documentTopics.refusedAt),
								eq(topics.status, "active"),
							),
						),
				),
			),
		)!
	}

	/**
	 * The library's articles, oldest first (the `newest` ones, still oldest first). `unsorted`: not
	 * sorted yet; `sorted`: sorted already; `unsortedInTopics`: sorted into no topic; `after`: past
	 * that article, by save time then id. Without `withText`, the text is left out.
	 */
	async articles(
		options: {
			unsorted?: boolean
			sorted?: boolean
			unsortedInTopics?: boolean
			after?: { at: Date; id: string } | null
			limit?: number
			newest?: number
			withText?: boolean
		} = {},
	): Promise<(TopicArticleIn & { createdAt: Date })[]> {
		const sortedYet = exists(
			db
				.select({ id: topicSorts.documentId })
				.from(topicSorts)
				.where(eq(topicSorts.documentId, documents.id)),
		)
		const text =
			options.withText === false
				? sql<string>`''`
				: sql<string>`left(${documentVersions.text}, ${RULES.textChars})`
		const rows = await db
			.select({
				id: documents.id,
				title: documents.title,
				siteName: documents.siteName,
				description: documents.description,
				text,
				createdAt: documents.createdAt,
			})
			.from(documents)
			.innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
			.where(
				and(
					this.inLibrary(),
					options.unsorted
						? notExists(
								db
									.select({ id: topicSorts.documentId })
									.from(topicSorts)
									.where(eq(topicSorts.documentId, documents.id)),
							)
						: undefined,
					options.sorted ? sortedYet : undefined,
					options.unsortedInTopics ? this.inNoTopic() : undefined,
					options.after
						? // Milliseconds, as the cursor was kept: a JavaScript date has no more.
							sql`(date_trunc('milliseconds', ${documents.createdAt}), ${documents.id}) > (${options.after.at.toISOString()}::timestamptz, ${options.after.id}::uuid)`
						: undefined,
				),
			)
			.orderBy(
				options.newest
					? desc(sql`date_trunc('milliseconds', ${documents.createdAt})`)
					: asc(sql`date_trunc('milliseconds', ${documents.createdAt})`),
				options.newest ? desc(documents.id) : asc(documents.id),
			)
			.limit(options.newest ?? options.limit ?? 1_000_000)
		const list = options.newest ? rows.reverse() : rows
		return list.map((r) => ({ ...r, title: r.title ?? "(untitled)" }))
	}

	async libraryCount(): Promise<number> {
		const [row] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(documents)
			.where(this.inLibrary())
		return row?.count ?? 0
	}

	/** Sorted articles in no topic: how many, without reading them. */
	async unsortedCount(): Promise<number> {
		const [row] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(documents)
			.where(and(this.inLibrary(), this.inNoTopic()))
		return row?.count ?? 0
	}

	/** Whether the account may have another piece of Haiku's work this month. */
	async mayWork(): Promise<boolean> {
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
		return (row?.count ?? 0) < this.deps.limit
	}

	/** One piece of Haiku's work done: counted once answered, so an outage spends none. */
	async worked(spend: TopicSpend[]) {
		await addUsage(db, this.userId, "topics")
		await this.spent(spend)
	}

	/** What the requests cost, added to the account's AI spend for admins. */
	async spent(spend: TopicSpend[]) {
		const micros = Math.round(
			spend.reduce((sum, s) => sum + estimateCostUsd(s.model, s), 0) * 1_000_000,
		)
		if (micros > 0) await addUsage(db, this.userId, "ai_spend", micros)
	}
}

/** A model's description as stored: one line of plain text, cut to size. Null when empty. */
function cleanDescription(raw: string): string | null {
	const clean = raw.replaceAll("\u0000", "").replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX)
	return clean.length ? clean : null
}
