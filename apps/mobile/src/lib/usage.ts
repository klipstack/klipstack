import type { Usage } from "@klipstack/api-contract"

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

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]

const count = (n: number) => Math.round(n).toLocaleString("en-US")
/** Megabytes, with a decimal under 10, so a small library doesn't read as empty. */
const megabytes = (bytes: number) => {
	const mb = bytes / (1024 * 1024)
	return mb < 10 && mb > 0 ? String(Math.max(0.1, Math.round(mb * 10) / 10)) : count(mb)
}

function row(
	key: UsageRow["key"],
	label: string,
	{ used, max }: { used: number; max: number },
	show: (n: number) => string = count,
	{ unit = "", left = false }: { unit?: string; left?: boolean } = {},
): UsageRow {
	// A cap of 0 is a server that allows none: full from the start.
	const share = max > 0 ? Math.min(1, used / max) : 1
	return {
		key,
		label,
		amount: `${show(used)} of ${show(max)}${unit}`,
		left: left ? `${count(Math.max(0, max - used))} left` : null,
		share,
		level: share >= 1 ? "full" : share >= 0.8 ? "near" : "ok",
	}
}

/**
 * The caps as Account lists them: the monthly ones first, then what the account holds. AI and
 * topic sorting only when the account has them (the server sends null otherwise); editions only
 * while they are turned on.
 */
export function usageRows(usage: Usage, { editions = true } = {}): UsageRow[] {
	return [
		row("saves", "Saves", usage.saves),
		...(usage.ai ? [row("ai", "AI questions", usage.ai, count, { left: true })] : []),
		...(usage.topicSorts ? [row("topicSorts", "Topic sorting", usage.topicSorts)] : []),
		...(editions ? [row("editions", "Editions published", usage.editions)] : []),
		row("storage", "Storage", usage.storage, megabytes, { unit: " MB" }),
		row("feeds", "Feeds followed", usage.feeds),
	]
}

/** When the monthly counts start over, as the web says it: the day in UTC, "November 1". */
export function resetsOn(resetsAt: string): string {
	const date = new Date(resetsAt)
	return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}
