import { createTopicModels, retryable } from "@klipstack/ai"
import { db, eq, topicLibraries } from "@klipstack/db"
import { enqueue, type JobPayloads, QUEUES } from "@klipstack/queue"
import type { JobWithMetadata } from "pg-boss"
import { log } from "../log"
import { bringTopicsUpToDate, type TopicsDeps } from "../topics"

/** Haiku's work on one account's topics a month, unless `LIMIT_TOPICS_PER_MONTH` says otherwise. */
export const TOPICS_PER_MONTH = 100

function depsFor(userId: string): TopicsDeps {
	const limit = Number(process.env.LIMIT_TOPICS_PER_MONTH)
	return {
		models: createTopicModels({
			anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
			typesafeApiKey: process.env.TYPESAFE_API_KEY || undefined,
			fake: process.env.AI_FAKE === "1",
		}),
		limit: Number.isInteger(limit) && limit >= 0 ? limit : TOPICS_PER_MONTH,
		again: () => queueTopics(userId),
	}
}

/** Asks for a run of the reader's topics: at most one waits while another runs. */
export async function queueTopics(userId: string) {
	await enqueue(QUEUES.topics, { userId }, { singletonKey: userId })
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
