import type {
	getFinishedLately,
	getNextEdition,
	listRediscover,
	snoozeNextEdition,
} from "@klipstack/api-contract"
import { snoozeEditionNudge } from "~/commands/editions.server"
import { AppError } from "~/lib/app-error"
import { isTimeZone } from "~/lib/date-groups"
import { REDISCOVER_AFTER_DAYS } from "~/lib/inbox-filters"
import { appOrigin, articleSummary } from "~/services/article-summary.server"
import { editionNudge } from "~/services/editions.server"
import { finishedLately } from "~/services/reading-history.server"
import { rediscoverCandidates } from "~/services/reading-suggestions.server"
import { topicAsked } from "~/services/topics.server"
import { notFound } from "../errors.server"
import type { Handler } from "../handler.server"
import { NO_TOPIC } from "./articles.server"

/** What Home shows beside the library's lists, as the web's Home loads it (`routes/reading-home`). */

export const finished: Handler<typeof getFinishedLately> = async ({ userId, query }) => {
	if (!isTimeZone(query.timeZone))
		throw new AppError("invalid_request", "The time zone is not one: send an IANA name.")
	const found = await finishedLately(userId, { timeZone: query.timeZone })
	return found ?? { count: 0, title: null }
}

/**
 * Per choice: the iPhone's Recently saved shows up to 9 and its From a while ago 3, and the older
 * saves Recently saved already shows don't count twice.
 */
const REDISCOVER_KEEP = 12

export const rediscover: Handler<typeof listRediscover> = async ({ userId, query }) => {
	const topic = query.topic ? await topicAsked(userId, query.topic) : null
	if (query.topic && !topic) throw notFound(NO_TOPIC)
	const { items, savedBefore } = await rediscoverCandidates(userId, {
		keep: REDISCOVER_KEEP,
		topicId: topic ?? undefined,
	})
	return {
		items: items.map(articleSummary),
		savedBefore: savedBefore.toISOString(),
		afterDays: REDISCOVER_AFTER_DAYS,
	}
}

export const nextEdition: Handler<typeof getNextEdition> = async ({ userId }) => {
	const nudge = await editionNudge(userId)
	return {
		marked: nudge.marked,
		draft: nudge.draft ? { items: nudge.draft.items } : null,
		nudge: nudge.reason
			? { reason: nudge.reason, daysSince: nudge.daysSince, readSince: nudge.readSince }
			: null,
		url: `${appOrigin}/editions`,
	}
}

export const snoozeNudge: Handler<typeof snoozeNextEdition> = async ({ userId }) => {
	await snoozeEditionNudge(userId)
}
