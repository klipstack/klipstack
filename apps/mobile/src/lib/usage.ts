import type { Usage } from "@klipstack/api-contract"
import { dateLocale, t } from "./i18n"

/** One cap on Account's Usage: what it counts, how much is used of it, and how full it is. */
export type UsageRow = {
	key: "saves" | "ai" | "topicSorts" | "storage" | "feeds" | "editions"
	label: string
	/** "12 of 500", in megabytes for storage. */
	amount: string
	/** What is left, where that is what the reader watches (AI questions). */
	left: string | null
	/** Used over the cap, 0–1. */
	share: number
	/** `full` at the cap (the server refuses more), `near` from 80%. */
	level: "ok" | "near" | "full"
}

const count = (n: number) => Math.round(n).toLocaleString(dateLocale)
/** Megabytes, with a decimal under 10, so a small library doesn't read as empty. */
const megabytes = (bytes: number) => {
	const mb = bytes / (1024 * 1024)
	return mb < 10 && mb > 0
		? Math.max(0.1, Math.round(mb * 10) / 10).toLocaleString(dateLocale)
		: count(mb)
}

function row(
	key: UsageRow["key"],
	label: string,
	{ used, max }: { used: number; max: number },
	show: (n: number) => string = count,
	{ inMegabytes = false, left = false }: { inMegabytes?: boolean; left?: boolean } = {},
): UsageRow {
	// A cap of 0 is a server that allows none: full from the start.
	const share = max > 0 ? Math.min(1, used / max) : 1
	return {
		key,
		label,
		amount: t(inMegabytes ? "account.usage.megabytes" : "account.usage.amount", {
			used: show(used),
			max: show(max),
		}),
		left: left
			? t("account.usage.left", {
					count: Math.max(0, max - used),
					left: count(Math.max(0, max - used)),
				})
			: null,
		share,
		level: share >= 1 ? "full" : share >= 0.8 ? "near" : "ok",
	}
}

/**
 * The caps as Account lists them: the monthly ones first, then what the account holds. AI and
 * topic sorting only when the account has them (the server sends null otherwise); editions and
 * feeds only while they are turned on.
 */
export function usageRows(usage: Usage, { editions = true, feeds = true } = {}): UsageRow[] {
	return [
		row("saves", t("account.usage.saves"), usage.saves),
		...(usage.ai ? [row("ai", t("account.usage.ai"), usage.ai, count, { left: true })] : []),
		...(usage.topicSorts
			? [row("topicSorts", t("account.usage.topicSorts"), usage.topicSorts)]
			: []),
		...(editions ? [row("editions", t("account.usage.editions"), usage.editions)] : []),
		row("storage", t("account.usage.storage"), usage.storage, megabytes, { inMegabytes: true }),
		...(feeds ? [row("feeds", t("account.usage.feeds"), usage.feeds)] : []),
	]
}

/** When the monthly counts start over, as the web says it: the day in UTC, "November 1". */
export function resetsOn(resetsAt: string): string {
	return new Intl.DateTimeFormat(dateLocale, {
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	}).format(new Date(resetsAt))
}
