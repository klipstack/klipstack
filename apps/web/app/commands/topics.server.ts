import { Id, TopicName } from "@klipstack/api-contract"
import { cleanTopicName } from "@klipstack/api-contract/names"
import {
	and,
	db,
	documents,
	documentTopics,
	eq,
	inArray,
	isNull,
	topicLibraries,
	topicSorts,
	topics,
} from "@klipstack/db"
import { enqueue, QUEUES } from "@klipstack/queue"
import { z } from "zod"
import { topicModels } from "~/lib/ai.server"
import { AppError, notFound, parseInput } from "~/lib/app-error"
import { hasFeature } from "~/lib/features.server"

/**
 * A reader's automatic topics: turning them on and off, confirming the first ones, and correcting
 * them. The worker's `topics` job does the rest (proposing, sorting, growing, reviewing).
 */

const NO_TOPIC = "No topic with that id."

/** Asks the worker to bring the reader's topics up to date: one run at a time per reader. */
const queueRun = (userId: string) => enqueue(QUEUES.topics, { userId }, { singletonKey: userId })

async function mayUseTopics(userId: string) {
	if (!(await hasFeature(userId, "topics")))
		throw new AppError("forbidden", "Topics are not turned on for this account.")
	if (!topicModels.available)
		throw new AppError("unavailable", "Topics are not set up on this server.")
}

/**
 * Turns topics on: from now on, article text goes to TypeSafe and Anthropic to sort it. Turning
 * them on again while on changes nothing.
 */
export async function enableTopics(userId: string): Promise<void> {
	await mayUseTopics(userId)
	await db.insert(topicLibraries).values({ userId }).onConflictDoNothing()
	await queueRun(userId)
}

/** Turns topics off and deletes them: every topic, where each article was, and what was refused. */
export async function disableTopics(userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		// The topics' rows in `document_topics` go with them.
		await tx.delete(topics).where(eq(topics.userId, userId))
		await tx.delete(topicSorts).where(eq(topicSorts.userId, userId))
		await tx.delete(topicLibraries).where(eq(topicLibraries.userId, userId))
	})
}

/** The reader opened the proposal: the sidebar's dot and Home's card go. */
export async function markTopicsSeen(userId: string): Promise<void> {
	await db
		.update(topicLibraries)
		.set({ seenAt: new Date() })
		.where(and(eq(topicLibraries.userId, userId), isNull(topicLibraries.seenAt)))
}

const Confirmation = z.object({
	/** The proposed topics the reader keeps, by id, each with a new name or none. */
	keep: z.array(z.object({ id: Id, name: TopicName.optional() })).max(100),
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

async function activeTopic(userId: string, id: string) {
	const topicId = parseInput(Id, id)
	const [topic] = await db
		.select({ id: topics.id, name: topics.name })
		.from(topics)
		.where(and(eq(topics.id, topicId), eq(topics.userId, userId), eq(topics.status, "active")))
	if (!topic) throw notFound(NO_TOPIC)
	return topic
}

/** Renames a topic. The name is the reader's from now on: a review never changes it. */
export async function renameTopic(userId: string, id: string, rawName: string) {
	const topic = await activeTopic(userId, id)
	const name = cleanTopicName(parseInput(TopicName, rawName))!
	await db.update(topics).set({ name, namedByReader: true }).where(eq(topics.id, topic.id))
	return { id: topic.id, name }
}

/** Removes a topic: its articles leave it, and it is never proposed again. */
export async function removeTopic(userId: string, id: string) {
	const topic = await activeTopic(userId, id)
	await db.transaction(async (tx) => {
		await tx
			.update(topics)
			.set({ status: "removed", endedAt: new Date() })
			.where(eq(topics.id, topic.id))
		await tx.delete(documentTopics).where(eq(documentTopics.topicId, topic.id))
	})
	return topic
}

/**
 * Takes articles out of a topic, for good: sorting never puts them back in it. Articles of the
 * reader's not in the topic are taken out all the same (they will never be put in it).
 */
export async function takeOutOfTopic(userId: string, id: string, articleIds: string[]) {
	const topic = await activeTopic(userId, id)
	const ids = parseInput(z.array(Id).min(1).max(500), articleIds)
	const owned = await db
		.select({ id: documents.id })
		.from(documents)
		.where(
			and(eq(documents.userId, userId), inArray(documents.id, ids), isNull(documents.deletedAt)),
		)
	if (owned.length !== new Set(ids).size) throw notFound("No article with that id.")
	const now = new Date()
	await db
		.insert(documentTopics)
		.values(
			owned.map((d) => ({
				documentId: d.id,
				topicId: topic.id,
				probability: 0,
				level: "suggested" as const,
				refusedAt: now,
			})),
		)
		.onConflictDoUpdate({
			target: [documentTopics.documentId, documentTopics.topicId],
			set: { refusedAt: now },
		})
	return { topic, taken: owned.map((d) => d.id) }
}
