import { Id, PROPOSED_TOPICS_MAX, TopicName } from "@klipstack/api-contract"
import { cleanTopicName } from "@klipstack/api-contract/names"
import { renameTopicOperator } from "@klipstack/api-contract/search-query"
import {
	addUsage,
	and,
	db,
	notInArray,
	sql,
	type Db,
	type Tx,
	documents,
	documentTopics,
	eq,
	inArray,
	isNull,
	topicLibraries,
	topicSorts,
	topics,
	rewriteSavedQueries,
	user as userTable,
} from "@klipstack/db"
import { enqueue, QUEUES } from "@klipstack/queue"
import { z } from "zod"
import { topicModels } from "~/lib/ai.server"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { hasFeature } from "~/lib/features.server"
import { isUniqueViolation } from "~/lib/postgres-errors.server"
import { rateLimit } from "~/lib/rate-limit.server"

/**
 * A reader's automatic topics: turning them on and off, confirming the first ones, and correcting
 * them. The worker's `topics` job does the rest (proposing, sorting, growing, reviewing).
 */

const NO_TOPIC = "No topic with that id."

/** Asks the worker to bring the reader's topics up to date: one run at a time per reader. */
const queueRun = (userId: string) => enqueue(QUEUES.topics, { userId }, { singletonKey: userId })

/**
 * After an article comes back to the library (restored from the trash): a run, if topics are on.
 * It is sorted again, as if new: topics may have come and gone while it was away.
 */
export async function queueTopicsIfOn(userId: string, articleId?: string): Promise<void> {
	if (articleId) await db.delete(topicSorts).where(eq(topicSorts.documentId, articleId))
	const [library] = await db
		.select({ userId: topicLibraries.userId })
		.from(topicLibraries)
		.where(eq(topicLibraries.userId, userId))
	if (library) await queueRun(userId)
}

/** The account has topics: changing them needs no provider. */
async function mayChangeTopics(userId: string) {
	if (!(await hasFeature(userId, "topics")))
		throw new AppError("forbidden", "Topics are not turned on for this account.")
}

/** The account has topics and the server can run them: what sends text to the providers. */
async function mayUseTopics(userId: string) {
	await mayChangeTopics(userId)
	if (!topicModels.available)
		throw new AppError("unavailable", "Topics are not set up on this server.")
}

const NAME_TAKEN = "Another topic has that name."

/** Whether a topic of the reader's, other than `except`, has the name already, whatever its case. */
async function nameTaken(tx: Tx, userId: string, name: string, except: string[] = []) {
	const [other] = await tx
		.select({ id: topics.id })
		.from(topics)
		.where(
			and(
				eq(topics.userId, userId),
				inArray(topics.status, ["active", "proposed"]),
				sql`lower(${topics.name}) = lower(${name})`,
				except.length ? notInArray(topics.id, except) : undefined,
			),
		)
	return !!other
}

/**
 * Turns topics on: from now on, article text goes to TypeSafe and Anthropic to sort it. Turning
 * them on again while on changes nothing.
 */
export async function enableTopics(userId: string): Promise<void> {
	await mayUseTopics(userId)
	await db.transaction(async (tx) => {
		await tx.insert(topicLibraries).values({ userId }).onConflictDoNothing()
		await endInvitation(tx, userId)
	})
	await queueRun(userId)
}

/** Turns topics off and deletes them: every topic, where each article was, and what was refused. */
export async function disableTopics(userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		// The reader's row first, as the worker locks it before each write: a run's write in progress
		// finishes before this, and its rows go with the rest; one after it finds topics off.
		await tx
			.select({ userId: topicLibraries.userId })
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, userId))
			.for("update")
		// The topics' rows in `document_topics` go with them.
		await tx.delete(topics).where(eq(topics.userId, userId))
		await tx.delete(topicSorts).where(eq(topicSorts.userId, userId))
		await tx.delete(topicLibraries).where(eq(topicLibraries.userId, userId))
	})
}

/** The reader opened the proposal: the sidebar's dot and Home's card go. */
export async function markTopicsSeen(userId: string): Promise<void> {
	await mayChangeTopics(userId)
	await db
		.update(topicLibraries)
		.set({ seenAt: new Date() })
		.where(and(eq(topicLibraries.userId, userId), isNull(topicLibraries.seenAt)))
}

/** "Not now" on Home's card: the card goes; the sidebar's dot stays until the proposal is opened. */
export async function dismissTopicsCard(userId: string): Promise<void> {
	await mayChangeTopics(userId)
	await db
		.update(topicLibraries)
		.set({ cardDismissedAt: new Date() })
		.where(and(eq(topicLibraries.userId, userId), isNull(topicLibraries.cardDismissedAt)))
}

/**
 * Home's invitation to turn topics on is over, for good: "No thanks" on it, or the Topics page
 * opened while topics are off.
 */
export async function endTopicsInvitation(userId: string): Promise<void> {
	await mayChangeTopics(userId)
	await endInvitation(db, userId)
}

/** Marks the invitation over, keeping the first time it ended. */
async function endInvitation(tx: Db | Tx, userId: string) {
	await tx
		.update(userTable)
		.set({
			prefs: sql`${userTable.prefs} || jsonb_build_object('topicsInvitationEndedAt', ${new Date().toISOString()}::text)`,
		})
		.where(and(eq(userTable.id, userId), sql`not (${userTable.prefs} ? 'topicsInvitationEndedAt')`))
}

const Confirmation = z.object({
	/** The proposed topics the reader keeps, by id, each with a new name or none. */
	keep: z.array(z.object({ id: Id, name: TopicName.optional() })).max(PROPOSED_TOPICS_MAX),
})
export type ConfirmationInput = z.input<typeof Confirmation>

/**
 * Confirms the first topics: the ones kept, under the names the reader gave them; the others are
 * removed, and never proposed again. Then the worker sorts the whole library.
 */
export async function confirmTopics(userId: string, input: ConfirmationInput): Promise<void> {
	const { keep } = parseInput(Confirmation, input)
	await mayUseTopics(userId)
	await db.transaction(async (tx) => {
		const [library] = await tx
			.select()
			.from(topicLibraries)
			.where(eq(topicLibraries.userId, userId))
			.for("update")
		if (!library?.proposedAt) throw notFound("No topics are waiting to be confirmed.")
		if (library.confirmedAt) throw new AppError("already_done", "The topics are confirmed already.")
		const proposed = await tx
			.select({ id: topics.id, name: topics.name })
			.from(topics)
			.where(and(eq(topics.userId, userId), eq(topics.status, "proposed")))
		const kept = new Map(keep.map((k) => [k.id, k.name]))
		for (const id of kept.keys()) if (!proposed.some((p) => p.id === id)) throw notFound(NO_TOPIC)
		// Two kept topics may not end up with one name.
		const names = proposed
			.filter((p) => kept.has(p.id))
			.map((p) => {
				const raw = kept.get(p.id)
				return (raw === undefined ? p.name : cleanTopicName(raw)!).toLocaleLowerCase()
			})
		if (new Set(names).size !== names.length) throw new AppError("name_taken", NAME_TAKEN)
		const now = new Date()
		for (const topic of proposed) {
			if (!kept.has(topic.id)) {
				await tx
					.update(topics)
					.set({ status: "removed", endedAt: now })
					.where(eq(topics.id, topic.id))
				continue
			}
			const raw = kept.get(topic.id)
			const name = raw === undefined ? topic.name : cleanTopicName(raw)!
			await tx
				.update(topics)
				.set({ status: "active", name, namedByReader: name !== topic.name })
				.where(eq(topics.id, topic.id))
		}
		await tx
			.update(topicLibraries)
			.set({ confirmedAt: now, seenAt: library.seenAt ?? now })
			.where(eq(topicLibraries.userId, userId))
	})
	await queueRun(userId)
}

/** Renames a topic. The name is the reader's from now on: a review never changes it. */
export async function renameTopic(userId: string, id: string, rawName: string) {
	const topicId = parseInput(Id, id)
	const name = cleanTopicName(parseInput(TopicName, rawName))!
	await mayChangeTopics(userId)
	try {
		return await db.transaction(async (tx) => {
			if (await nameTaken(tx, userId, name, [topicId])) throw new AppError("name_taken", NAME_TAKEN)
			const [before] = await tx
				.select({ name: topics.name })
				.from(topics)
				.where(and(eq(topics.id, topicId), eq(topics.userId, userId), eq(topics.status, "active")))
				.for("update")
			if (!before) throw notFound(NO_TOPIC)
			// The saved searches that name it follow it.
			await rewriteSavedQueries(tx, userId, (q) => renameTopicOperator(q, before.name, [name]))
			const [renamed] = await tx
				.update(topics)
				.set({ name, namedByReader: true })
				.where(and(eq(topics.id, topicId), eq(topics.userId, userId), eq(topics.status, "active")))
				.returning({ id: topics.id, name: topics.name })
			if (!renamed) throw notFound(NO_TOPIC)
			await addUsage(tx, userId, "topic_renamed")
			return renamed
		})
	} catch (error) {
		// A topic of that name made meanwhile (the worker's): the unique index has the last word.
		if (isUniqueViolation(error)) throw new AppError("name_taken", NAME_TAKEN)
		throw error
	}
}

/** Removes a topic: its articles leave it, and it is never proposed again. */
export async function removeTopic(userId: string, id: string) {
	const topicId = parseInput(Id, id)
	await mayChangeTopics(userId)
	return db.transaction(async (tx) => {
		const [removed] = await tx
			.update(topics)
			.set({ status: "removed", endedAt: new Date() })
			.where(and(eq(topics.id, topicId), eq(topics.userId, userId), eq(topics.status, "active")))
			.returning({ id: topics.id, name: topics.name })
		if (!removed) throw notFound(NO_TOPIC)
		await tx.delete(documentTopics).where(eq(documentTopics.topicId, topicId))
		await addUsage(tx, userId, "topic_removed")
		return removed
	})
}

/** Takes an article out of a topic, for good: sorting never puts it back in it. */
export async function takeOutOfTopic(userId: string, id: string, articleId: string) {
	const topicId = parseInput(Id, id)
	const documentId = parseInput(Id, articleId)
	await mayChangeTopics(userId)
	return db.transaction(async (tx) => {
		const [topic] = await tx
			.select({ id: topics.id, name: topics.name })
			.from(topics)
			.where(and(eq(topics.id, topicId), eq(topics.userId, userId), eq(topics.status, "active")))
			.for("share")
		if (!topic) throw notFound(NO_TOPIC)
		const [article] = await tx
			.select({ id: documents.id })
			.from(documents)
			.where(
				and(
					eq(documents.id, documentId),
					eq(documents.userId, userId),
					isNull(documents.deletedAt),
				),
			)
		if (!article) throw notFound("No article with that id.")
		const now = new Date()
		await tx
			.insert(documentTopics)
			.values({ documentId, topicId, probability: 0, level: "suggested", refusedAt: now })
			.onConflictDoUpdate({
				target: [documentTopics.documentId, documentTopics.topicId],
				set: { refusedAt: now },
			})
		await addUsage(tx, userId, "topic_taken_out")
		return topic
	})
}

/** What the reader clicks that `countTopicUse` counts; the commands above count the rest. */
const TopicClick = z.enum([
	"topic_filter_library",
	"topic_filter_search",
	"topic_opened",
	"topic_next",
	"topic_home",
])
/** More clicks a minute than a person makes: the counts stay numbers an admin can trust. */
const CLICKS_PER_MINUTE = 60

/**
 * One more use of a part of topics this month, for admins (`/admin/usage`): its name only, no
 * article and no topic.
 */
export async function countTopicUse(userId: string, use: string): Promise<void> {
	const metric = parseInput(TopicClick, use)
	await mayChangeTopics(userId)
	const limited = rateLimit(`topic-use:${userId}`, CLICKS_PER_MINUTE, 60_000)
	if (!limited.ok)
		throw new AppError("rate_limited", "Too many topic uses at once.", {
			retryAfter: limited.retryAfterSeconds,
		})
	await addUsage(db, userId, metric)
}
