import { createTopicModels, retryable } from "@klipstack/ai"
import { and, db, eq, topicLibraries, topicLimits, userFeatures } from "@klipstack/db"
import { enqueue, type JobPayloads, QUEUES } from "@klipstack/queue"
import type { JobWithMetadata } from "pg-boss"
import { log } from "../log"
import { bringTopicsUpToDate, type TopicsDeps } from "../topics"

function depsFor(userId: string): TopicsDeps {
	const limits = topicLimits()
	return {
		models: createTopicModels({
			anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
			typesafeApiKey: process.env.TYPESAFE_API_KEY || undefined,
			fake: process.env.AI_FAKE === "1",
		}),
		limit: limits.topics,
		sortLimit: limits.sorts,
		again: () => queueTopics(userId),
	}
}

/** Asks for a run of the reader's topics: at most one waits while another runs. */
export async function queueTopics(userId: string) {
	await enqueue(QUEUES.topics, { userId }, { singletonKey: userId })
}

/**
 * Scheduled on the 1st: a run for every reader with topics on and the feature, as the month's
 * sorts start again. What waited for them is sorted without waiting for a new save; a reader with
 * nothing due costs a few queries.
 */
export async function handleTopicsMonth() {
	const readers = await db
		.select({ userId: topicLibraries.userId })
		.from(topicLibraries)
		.innerJoin(
			userFeatures,
			and(eq(userFeatures.userId, topicLibraries.userId), eq(userFeatures.feature, "topics")),
		)
	for (const { userId } of readers) await queueTopics(userId)
	return { readers: readers.length }
}

/** After an article is ready: a run for its reader, if they have topics on. */
export async function queueTopicsAfterSave(userId: string) {
	const [library] = await db
		.select({ userId: topicLibraries.userId })
		.from(topicLibraries)
		.where(eq(topicLibraries.userId, userId))
	if (library) await queueTopics(userId)
}

export async function handleTopics(
	job: JobWithMetadata<JobPayloads["topics"]>,
	deps: TopicsDeps = depsFor(job.data.userId),
) {
	try {
		const outcome = await bringTopicsUpToDate(job.data.userId, deps)
		if (outcome.done !== "nothing") log.info("topics", { userId: job.data.userId, ...outcome })
	} catch (error) {
		// A request a provider refused fails again the same way: it waits for the next save.
		if (!retryable(error)) {
			log.error("topics: refused", { userId: job.data.userId, error: String(error) })
			return
		}
		throw error
	}
}
