import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { tooltip } from "~/components/tooltip-host"
import { knownTimeZone } from "~/lib/date-groups"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { longerThan } from "~/lib/reading-books"
import { requireUser } from "~/lib/session.server"
import { cn } from "~/lib/utils"
import { type ReadTotals, type ReadingStats, readingStats } from "~/services/reading-history.server"
import { topicsInUse } from "~/services/topics.server"
import type { Route } from "./+types/reading"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.reading") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.reading" } }

const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const params = new URL(request.url).searchParams
	const by = params.get("by") === "month" ? "month" : "week"
	const start = params.get("start")
	return {
		by,
		stats: await readingStats(user.id, {
			timeZone: knownTimeZone(request.headers.get("cookie")) ?? "UTC",
			by,
			start: start && DAY.test(start) ? start : null,
			topics: await topicsInUse(user.id),
		}),
	} as const
}

/** A `YYYY-MM-DD` day, which has no zone, as a date in the reader's language. */
function useDays() {
	const { i18n } = useTranslation()
	const format = (day: string, options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(i18n.language, { ...options, timeZone: "UTC" }).format(
			new Date(`${day}T00:00:00Z`),
		)
	return {
		short: (day: string) => format(day, { month: "short", day: "numeric" }),
		long: (day: string) => format(day, { month: "long", day: "numeric", year: "numeric" }),
		month: (day: string) => format(day, { month: "long" }),
		monthShort: (day: string) => format(day, { month: "short" }),
		monthYear: (day: string) => format(day, { month: "long", year: "numeric" }),
		number: (n: number) => new Intl.NumberFormat(i18n.language).format(n),
	}
}

export default function Reading({ loaderData: { by, stats } }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const days = useDays()
	const read = Object.keys(stats.days).length > 0 || stats.periods.some((p) => p.articles > 0)
	return (
		<main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-3 pb-12 md:px-8 md:pt-4">
			<h1 className="hidden page-title md:block md:leading-10">{tc("nav.reading")}</h1>
			<p className="text-sm text-muted-fg md:mt-2">{t("stats.description")}</p>
			{read ? null : (
				<p data-testid="reading-empty" className="mt-6 font-display text-lg text-muted-fg italic">
					{t("stats.empty")}
				</p>
			)}
			<div className="mt-6 grid gap-3 sm:grid-cols-3">
				<Total label={t("stats.pastWeek")} totals={stats.totals.week} testId="total-week" />
				<Total label={days.month(stats.today)} totals={stats.totals.month} testId="total-month" />
				<Total label={stats.today.slice(0, 4)} totals={stats.totals.year} testId="total-year" />
			</div>
			<YearGrid stats={stats} />
			<Periods by={by} stats={stats} />
		</main>
	)
}

function useAmounts() {
	const { t } = useTranslation("library")
	const days = useDays()
	return {
		articles: (count: number) => t("stats.articles", { count, n: days.number(count) }),
		words: (count: number) => t("stats.words", { count, n: days.number(count) }),
		minutes: (count: number) =>
			count < 60
				? t("stats.minutes", { count })
				: count % 60
					? t("stats.hours", { hours: Math.floor(count / 60), minutes: count % 60 })
					: t("stats.wholeHours", { hours: count / 60 }),
	}
}

function Total({ label, totals, testId }: { label: string; totals: ReadTotals; testId: string }) {
	const { t } = useTranslation("library")
	const amounts = useAmounts()
	const book = longerThan(totals.words)
	return (
		<section data-testid={testId} className="rounded-xl border border-border p-4">
			<h2 className="text-sm text-muted-fg first-letter:uppercase">{label}</h2>
			<p className="mt-1 font-display text-3xl">{amounts.articles(totals.articles)}</p>
			{totals.articles ? (
				<p className="mt-1 text-sm text-muted-fg tabular-nums">
					{totals.minutes
						? t("stats.length", {
								words: amounts.words(totals.words),
								minutes: amounts.minutes(totals.minutes),
							})
						: amounts.words(totals.words)}
				</p>
			) : null}
			{book ? (
				<p className="mt-2 font-display text-sm italic">
					{t("stats.longerThan", { book: t(`stats.books.${book}`) })}
				</p>
			) : null}
		</section>
	)
}

/**
 * Navy ink, by articles finished in a day: the more, the deeper. Not the highlighter's colors,
 * which are too pale to stand apart from the page.
 */
const LEVELS = ["var(--k-muted)", "var(--k-heat-1)", "var(--k-heat-2)", "var(--k-heat-3)"] as const
const level = (count: number) => (count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3)

/**
 * A year of days, a column per week from Monday, as GitHub draws contributions. A day without a
 * finish is only an empty square: no runs, nothing broken.
 */
function YearGrid({ stats }: { stats: ReadingStats }) {
	const { t } = useTranslation("library")
	const days = useDays()
	const weeks: string[][] = []
	for (let day = stats.from; day <= stats.today; day = nextDay(day)) {
		if (weekdayIndex(day) === 0) weeks.push([])
		weeks.at(-1)!.push(day)
	}
	const counts = Object.values(stats.days)
	const total = counts.reduce((a, b) => a + b, 0)
	const columns = { gridTemplateColumns: `repeat(${weeks.length}, minmax(10px, 1fr))` }
	return (
		<section className="mt-10">
			<h2 className="section-title">{t("stats.year.title")}</h2>
			<p className="sr-only" data-testid="year-summary">
				{t("stats.year.summary", {
					count: total,
					n: days.number(total),
					days: t("stats.year.days", { count: counts.length, n: days.number(counts.length) }),
					from: days.long(stats.from),
				})}
			</p>
			{/* Right to left, so a narrow screen opens on this week and scrolls back in time. */}
			<div className="mt-3 overflow-x-auto pb-2" dir="rtl" aria-hidden>
				<div className="min-w-[680px]" dir="ltr">
					<div className="grid gap-[3px] text-[10px] text-muted-fg" style={columns}>
						{weeks.map((week) => {
							const first = week.find((d) => d.endsWith("-01"))
							return (
								<span key={week[0]} className="whitespace-nowrap">
									{first ? days.monthShort(first) : ""}
								</span>
							)
						})}
					</div>
					<div
						className="mt-1 grid grid-flow-col grid-rows-7 gap-[3px]"
						style={columns}
						data-testid="year-grid"
					>
						{weeks.flat().map((day) => {
							const count = stats.days[day] ?? 0
							return (
								<span
									key={day}
									data-day={day}
									data-count={count}
									className="aspect-square rounded-[2px]"
									style={{
										backgroundColor: LEVELS[level(count)],
										// The first week starts on its weekday's row.
										gridRowStart: day === stats.from ? weekdayIndex(day) + 1 : undefined,
									}}
									{...tooltip(
										count
											? t("stats.year.day", { count, date: days.long(day) })
											: t("stats.year.dayNone", { date: days.long(day) }),
									)}
								/>
							)
						})}
					</div>
				</div>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-fg" aria-hidden>
				<span className="mr-1">{t("stats.year.legend")}</span>
				<span>{t("stats.year.less")}</span>
				{LEVELS.map((color) => (
					<span
						key={color}
						className="size-[11px] rounded-[2px]"
						style={{ backgroundColor: color }}
					/>
				))}
				<span>{t("stats.year.more")}</span>
			</div>
		</section>
	)
}

function Periods({ by, stats }: { by: "week" | "month"; stats: ReadingStats }) {
	const { t } = useTranslation("library")
	const days = useDays()
	const amounts = useAmounts()
	const most = Math.max(1, ...stats.periods.map((p) => p.words))
	const { selected } = stats
	const name = (start: string) =>
		by === "week" ? t("stats.periods.weekOf", { date: days.short(start) }) : days.monthYear(start)
	return (
		<section className="mt-10">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="section-title">
					{by === "week" ? t("stats.periods.title") : t("stats.periods.titleMonth")}
				</h2>
				<nav aria-label={t("stats.periods.by")} className="flex gap-1 text-sm">
					{(["week", "month"] as const).map((choice) => (
						<Link
							key={choice}
							to={`?by=${choice}`}
							preventScrollReset
							aria-current={by === choice ? "page" : undefined}
							className={cn(
								"rounded-lg px-2 py-1",
								by === choice ? "marked font-medium" : "text-muted-fg hover:ink-hover",
							)}
						>
							{t(`stats.periods.${choice}`)}
						</Link>
					))}
				</nav>
			</div>
			<ol className="mt-4 flex h-40 items-end gap-1.5 sm:gap-2" data-testid="period-bars">
				{stats.periods.map((p, i) => {
					const chosen = p.start === selected.start
					// Weeks by their Monday's day, with the month where one starts: narrow bars fit them.
					const newMonth =
						i === 0 || p.start.slice(5, 7) !== stats.periods[i - 1]!.start.slice(5, 7)
					return (
						<li key={p.start} className="flex h-full min-w-0 flex-1 flex-col justify-end">
							<Link
								to={`?by=${by}&start=${p.start}`}
								preventScrollReset
								aria-current={chosen ? "true" : undefined}
								aria-label={t("stats.periods.bar", {
									period: name(p.start),
									articles: amounts.articles(p.articles),
									words: amounts.words(p.words),
								})}
								{...tooltip(
									t("stats.periods.bar", {
										period: name(p.start),
										articles: amounts.articles(p.articles),
										words: amounts.words(p.words),
									}),
								)}
								className="group flex h-full flex-col"
							>
								<span className="flex flex-1 items-end">
									<span
										className={cn(
											"block w-full rounded-t-sm transition-colors",
											p.words ? "min-h-1" : "h-px",
											// The chosen one marked in the reader's ink, as the sidebar marks where they are.
											chosen ? "bg-[var(--hl)]" : "bg-muted-fg/35 group-hover:bg-muted-fg/60",
										)}
										style={p.words ? { height: `${(p.words / most) * 100}%` } : undefined}
									/>
								</span>
								<span
									className={cn(
										"mt-1 text-center text-[10px] leading-tight tabular-nums sm:text-xs",
										chosen ? "font-medium text-fg" : "text-muted-fg",
									)}
								>
									{by === "week" ? Number(p.start.slice(8)) : days.monthShort(p.start)}
									<span className="block min-h-[1lh] whitespace-nowrap">
										{by === "week" && newMonth ? days.monthShort(p.start) : ""}
									</span>
								</span>
							</Link>
						</li>
					)
				})}
			</ol>
			<div className="mt-8" data-testid="period-selected">
				<h3 className="font-display text-xl">
					{by === "week"
						? t("stats.selected.range", {
								from: days.short(selected.start),
								to: days.short(selected.end),
							})
						: days.monthYear(selected.start)}
				</h3>
				{selected.topics.length ? (
					<div className="mt-3">
						<h4 className="text-sm text-muted-fg">{t("stats.selected.topics")}</h4>
						<ul className="mt-1 flex flex-wrap gap-2">
							{selected.topics.map((topic) => (
								<li key={topic.id}>
									<Link
										to={`/topics/${topic.id}`}
										className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm hover:ink-hover"
									>
										{topic.name}
										<span className="text-muted-fg tabular-nums">{topic.articles}</span>
									</Link>
								</li>
							))}
						</ul>
					</div>
				) : null}
				{selected.articles.length ? (
					<ul className="mt-4 divide-y divide-border">
						{selected.articles.map((article) => (
							<li key={article.id} className="flex items-baseline justify-between gap-4 py-2.5">
								<Link to={`/read/${article.id}`} className="min-w-0 hover:underline">
									<span className="line-clamp-2">
										{article.title ?? article.siteName ?? t("card.untitled")}
									</span>
									{article.title && article.siteName ? (
										<span className="text-sm text-muted-fg">{article.siteName}</span>
									) : null}
								</Link>
								<span className="shrink-0 text-sm text-muted-fg tabular-nums">
									{article.words ? amounts.words(article.words) : null}
								</span>
							</li>
						))}
					</ul>
				) : (
					<p className="mt-3 text-sm text-muted-fg">{t("stats.selected.none")}</p>
				)}
			</div>
		</section>
	)
}

const nextDay = (day: string) =>
	new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
/** Monday 0 to Sunday 6. */
const weekdayIndex = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
