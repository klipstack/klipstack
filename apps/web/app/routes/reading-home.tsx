import { BookOpen, CircleAlert, Clock3, Search } from "lucide-react"
import { type ReactNode, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
	Form,
	Link,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
	useNavigate,
	useSearchParams,
} from "react-router"
import { FeedArticle } from "~/components/feed-article"
import { HomeArticle } from "~/components/home-article"
import { HomeGreeting } from "~/components/home-greeting"
import { SaveLinkDialog } from "~/components/save-link-dialog"
import { Button, buttonVariants } from "~/components/ui/button"
import { useFeedReader } from "~/hooks/use-feed-reader"
import { timeZoneFromCookie } from "~/lib/date-groups"
import { fitsIn, homeShelves, shortTitle } from "~/lib/home-shelves"
import { getInstance } from "~/lib/i18n.server"
import { listSearch, parseTime, REDISCOVER_AFTER_DAYS, TIME_CHOICES } from "~/lib/inbox-filters"
import { warmOffline } from "~/lib/offline.client"
import type { PageBarHandle } from "~/lib/page-bar"
import { requireUser } from "~/lib/session.server"
import { isSearchShortcut } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"
import { finishedLately } from "~/services/reading-history.server"
import { readingHome } from "~/services/reading-home.server"
import type { Route } from "./+types/reading-home"

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const t = getInstance(context).getFixedT(null, "library")
	const timeZone = timeZoneFromCookie(request.headers.get("cookie"))
	const [home, finished] = await Promise.all([
		readingHome(user.id),
		finishedLately(user.id, { timeZone }),
	])
	return { ...home, finished, title: `${t("home.title")} · Klipstack` }
}

export function meta({ loaderData }: Route.MetaArgs) {
	return [{ title: loaderData?.title ?? "Home · Klipstack" }]
}

/**
 * Choosing a time (`?time=`) picks from what the page already has: no round trip for it. Anything
 * else (actions, live updates, other addresses) loads Home again.
 */
export function shouldRevalidate({
	currentUrl,
	nextUrl,
	formMethod,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	const withoutTime = (url: URL) => {
		const params = new URLSearchParams(url.search)
		params.delete("time")
		return `${url.pathname}?${params}`
	}
	const onlyTime =
		currentUrl.search !== nextUrl.search && withoutTime(currentUrl) === withoutTime(nextUrl)
	return !formMethod && onlyTime ? false : defaultShouldRevalidate
}

export const handle: PageBarHandle = {
	pageBar: {
		titleKey: "common:nav.home",
		title: <HomeGreeting />,
		save: true,
		search: { to: "/search", labelKey: "library:search.label" },
	},
}

export default function ReadingHome({
	loaderData: { candidates, timeChoice, feed, emptyState, review, finished },
}: Route.ComponentProps) {
	const { t } = useTranslation(["library", "feed"])
	const navigate = useNavigate()
	const { onRead, readingId } = useFeedReader("/home")
	// Minutes to read, or null for any length: links, so they work before the page's script runs.
	const [searchParams] = useSearchParams()
	const minutes = parseTime(searchParams.get("time"))
	const { reading, recent, rediscover } = useMemo(
		() => homeShelves(candidates, timeChoice ? minutes : null),
		[candidates, timeChoice, minutes],
	)
	const timed = timeChoice && minutes !== null
	// The article read last shows even when it doesn't fit: it says so, and doesn't count as a fit.
	const nothingFits =
		timed && ![...reading, ...recent, ...rediscover].some((doc) => fitsIn(doc, minutes))
	const featured = reading[0]
	// Without Continue reading, the newest save takes its big card.
	const lead = featured ? undefined : recent[0]
	const moreRecent = lead ? recent.slice(1) : recent
	const EmptyIcon =
		emptyState?.kind === "processing"
			? Clock3
			: emptyState?.kind === "failed"
				? CircleAlert
				: BookOpen
	useEffect(() => {
		warmOffline(
			["/home", "/library"],
			[...reading, ...recent, ...rediscover].map((d) => `/read/${d.id}`),
		)
	}, [reading, recent, rediscover])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!isSearchShortcut(e)) return
			e.preventDefault()
			void navigate("/search", { state: { from: "/home" } })
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [navigate])

	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-12 md:px-8 md:pt-4 md:pb-8">
			<header
				className={cn(
					"hidden min-h-10 flex-wrap items-center justify-between gap-3 md:flex",
					finished ? "mb-1" : "mb-9",
				)}
			>
				<h1 className="text-2xl font-semibold">
					<HomeGreeting />
				</h1>
				<div className="flex items-center gap-2">
					<Link
						to="/search"
						state={{ from: "/home" }}
						aria-label={t("search.label")}
						className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
					>
						<Search className="size-5" aria-hidden />
					</Link>
					<SaveLinkDialog />
				</div>
			</header>
			{finished ? <FinishedLately {...finished} /> : null}
			{timeChoice ? <TimeChoice minutes={minutes} /> : null}
			<div className="space-y-10">
				{featured ? (
					<section aria-labelledby="home-reading">
						<SectionHeading
							id="home-reading"
							title={t("continueReading.title")}
							to="/library?show=progress"
						/>
						<HomeArticle doc={featured} featured />
						{timed && !fitsIn(featured, minutes) ? (
							<p className="mt-3 text-sm text-muted-fg">
								{t("home.time.pickUp", { count: minutes! })}
							</p>
						) : null}
						{reading.length > 1 ? (
							<ul className="mt-5 grid gap-5 sm:grid-cols-2">
								{reading.slice(1).map((doc) => (
									<li key={doc.id} className="min-w-0">
										<HomeArticle doc={doc} compact />
									</li>
								))}
							</ul>
						) : null}
					</section>
				) : null}
				{recent.length ? (
					<section aria-labelledby="home-recent">
						<SectionHeading id="home-recent" title={t("home.recent")} to="/library?show=unread" />
						{lead ? <HomeArticle doc={lead} featured /> : null}
						{moreRecent.length ? (
							<ul
								className={cn("grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3", lead && "mt-7")}
							>
								{moreRecent.map((doc) => (
									<li key={doc.id} className="min-w-0">
										<HomeArticle doc={doc} />
									</li>
								))}
							</ul>
						) : null}
					</section>
				) : null}
				{rediscover.length ? (
					<section aria-labelledby="home-rediscover" data-testid="home-rediscover">
						<SectionHeading
							id="home-rediscover"
							title={t("home.rediscover.title")}
							to={`/library${listSearch("unread", "oldest")}`}
						/>
						<p className="-mt-2 mb-5 text-sm text-muted-fg">
							{t("home.rediscover.description", { count: REDISCOVER_AFTER_DAYS })}
						</p>
						<ul className="grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
							{rediscover.map((doc) => (
								<li key={doc.id} className="min-w-0">
									<HomeArticle doc={doc} />
								</li>
							))}
						</ul>
					</section>
				) : null}
				{/* With a time chosen, the reader came to read, not to tidy up. */}
				{review && !timed ? <ReviewCard /> : null}
				{nothingFits ? (
					<div className="flex flex-col items-center gap-4 py-10 text-center">
						<p className="text-sm text-muted-fg">{t("home.time.none", { count: minutes! })}</p>
						<Link
							to={{ search: "" }}
							replace
							preventScrollReset
							className={buttonVariants({ variant: "secondary" })}
						>
							{t("home.time.showAll")}
						</Link>
					</div>
				) : null}
				{/* Feed posts have no reading time to choose by. */}
				{feed.length && !timed ? (
					<section aria-labelledby="home-feed" data-testid="home-feed">
						<SectionHeading
							id="home-feed"
							title={t("feed:fromYourFeeds")}
							to="/feed"
							label={t("home.viewFeeds")}
						/>
						<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{feed.map(({ item, source }) => (
								<FeedArticle
									key={item.id}
									item={item}
									source={source}
									isNew={item.isNew}
									featured
									onRead={onRead}
									reading={readingId === item.id}
									from="/home"
								/>
							))}
						</ul>
					</section>
				) : null}
				{emptyState ? (
					<div className="flex flex-col items-center gap-4 py-14 text-center">
						<EmptyIcon className="size-9 text-muted-fg" aria-hidden />
						<h2 className="font-serif text-3xl">{t(`home.empty.${emptyState.kind}.title`)}</h2>
						<p className="max-w-sm text-sm leading-relaxed text-muted-fg">
							{t(`home.empty.${emptyState.kind}.description`)}
						</p>
						<Link to={emptyState.to} className={buttonVariants()}>
							{t(`home.empty.${emptyState.kind}.action`)}
						</Link>
					</div>
				) : null}
			</div>
		</main>
	)
}

/**
 * Old saves never opened, to keep or let go of: a quiet suggestion, without a count. Opening the
 * review or "Not now" puts it off for a month.
 */
function ReviewCard() {
	const { t } = useTranslation("library")
	const later = useFetcher()
	if (later.state !== "idle" || later.data) return null
	return (
		<section
			aria-labelledby="home-review"
			data-testid="home-review"
			className="rounded-xl border border-border bg-card p-5"
		>
			<h2 id="home-review" className="font-medium">
				{t("review.card.title")}
			</h2>
			<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-fg">
				{t("review.card.description")}
			</p>
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Form method="post" action="/library/review">
					<input type="hidden" name="intent" value="open" />
					<Button type="submit" variant="secondary">
						{t("review.card.open")}
					</Button>
				</Form>
				<later.Form method="post" action="/library/review">
					<input type="hidden" name="intent" value="snooze" />
					<Button type="submit" variant="ghost">
						{t("review.card.later")}
					</Button>
				</later.Form>
			</div>
		</section>
	)
}

/** Titles longer than this are cut, so the sentence stays one line or two. */
const FINISHED_TITLE_MAX = 80
const TITLE_SLOT = "\u0000title\u0000"

/**
 * What the reader finished in the past week, under the greeting. Only what was read: nothing about
 * what is left, no comparison, and nothing at all after a week without a finish.
 */
function FinishedLately({ count, title }: { count: number; title: string | null }) {
	const { t } = useTranslation("library")
	let text: ReactNode
	if (count > 1) text = t("home.finished.count", { count })
	else if (!title) text = t("home.finished.untitled")
	else {
		// The sentence around the title, which is set apart as one. Not markup in the string: a title
		// may hold anything.
		const [before, after] = t("home.finished.named", { title: TITLE_SLOT }).split(TITLE_SLOT)
		text = (
			<>
				{before}
				<cite className="text-fg italic">{shortTitle(title, FINISHED_TITLE_MAX)}</cite>
				{after}
			</>
		)
	}
	return (
		<p data-testid="home-finished" className="mb-6 text-sm text-muted-fg md:mb-9">
			{text}
		</p>
	)
}

/** How much time there is: narrows every section to what fits, without asking the server. */
function TimeChoice({ minutes }: { minutes: number | null }) {
	const { t } = useTranslation("library")
	const choice = (value: number | null) => (
		<Link
			key={value ?? "any"}
			to={{ search: value === null ? "" : `?time=${value}` }}
			replace
			preventScrollReset
			aria-current={value === minutes ? "true" : undefined}
			// Already chosen: nothing to load or pick again.
			onClick={(e) => {
				if (value === minutes) e.preventDefault()
			}}
			className="rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg"
		>
			{value === null ? t("home.time.any") : t("home.time.choice", { count: value })}
		</Link>
	)
	return (
		<div
			role="group"
			aria-labelledby="home-time"
			data-testid="home-time"
			className="mb-9 flex flex-wrap items-center gap-x-3 gap-y-2"
		>
			<h2 id="home-time" className="text-sm text-muted-fg">
				{t("home.time.title")}
			</h2>
			<div className="flex flex-wrap gap-2">
				{choice(null)}
				{TIME_CHOICES.map(choice)}
			</div>
		</div>
	)
}

function SectionHeading({
	id,
	title,
	to,
	label,
}: {
	id: string
	title: string
	to: string
	label?: string
}) {
	const { t } = useTranslation("library")
	return (
		<div className="mb-4 flex items-center justify-between gap-4">
			<h2 id={id} className="text-lg font-medium">
				{title}
			</h2>
			<Link
				to={to}
				aria-label={label ?? `${t("home.viewAll")}: ${title}`}
				className="shrink-0 py-2 text-sm text-link hover:underline"
			>
				{label ?? t("home.viewAll")}
				<span aria-hidden> →</span>
			</Link>
		</div>
	)
}
