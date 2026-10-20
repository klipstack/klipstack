import { createTopicModels, retryable } from "@klipstack/ai"
import {
	accountBilling,
	and,
	billingStartsAt,
	db,
	eq,
	mayAddSql,
	topicLibraries,
	topicLimits,
	user,
	userFeatures,
} from "@klipstack/db"
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
		.innerJoin(user, eq(user.id, topicLibraries.userId))
		.leftJoin(accountBilling, eq(accountBilling.userId, user.id))
		// A lapsed account adds nothing to sort, and its topics stay as they are.
		.where(mayAddSql(billingStartsAt()))
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

/** Whether the reader's account lapsed: its topics stay as they are, and cost nothing more. */
async function lapsed(userId: string) {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.leftJoin(accountBilling, eq(accountBilling.userId, user.id))
		.where(and(eq(user.id, userId), mayAddSql(billingStartsAt())))
	return rows.length === 0
}

export async function handleTopics(
	job: JobWithMetadata<JobPayloads["topics"]>,
	deps: TopicsDeps = depsFor(job.data.userId),
) {
	// Whatever queued the run (a save, a restore, turning topics on): a lapsed account gets none.
	if (await lapsed(job.data.userId)) return
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
