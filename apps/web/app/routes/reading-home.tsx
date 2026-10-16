import { fallbackLanguage, isLocale } from "@klipstack/i18n/languages"
import { ChevronDown, CircleAlert, Clock3 } from "lucide-react"
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
import { dailyHighlights } from "~/commands/resurfacing.server"
import { EmptyDrawing } from "~/components/empty-drawing"
import { FeedArticle } from "~/components/feed-article"
import { HomeArticle } from "~/components/home-article"
import { FinishedLately } from "~/components/home-finished"
import { HomeHighlights } from "~/components/home-highlights"
import { HomeMasthead } from "~/components/home-masthead"
import { HomeNotes } from "~/components/home-notes"
import { MenuNavLink, MoreMenu } from "~/components/more-menu"
import { openSaveLink } from "~/components/save-link-dialog"
import { StarterTexts } from "~/components/starter-texts"
import { Button, buttonVariants } from "~/components/ui/button"
import { useFeedReader } from "~/hooks/use-feed-reader"
import { topicModels } from "~/lib/ai.server"
import { knownTimeZone } from "~/lib/date-groups"
import { hasFeature } from "~/lib/features.server"
import { editionEar, mastheadDate, partOfDay } from "~/lib/home-masthead"
import { fitsIn, homeShelves } from "~/lib/home-shelves"
import { getInstance } from "~/lib/i18n.server"
import { listSearch, parseTime, REDISCOVER_AFTER_DAYS, TIME_CHOICES } from "~/lib/inbox-filters"
import { extractLinkIds } from "~/lib/note-links"
import { warmOffline } from "~/lib/offline.client"
import type { PageBarHandle } from "~/lib/page-bar"
import { requireUser } from "~/lib/session.server"
import { isSearchShortcut } from "~/lib/shortcuts"
import { countTopicClick } from "~/lib/topic-use"
import { cn } from "~/lib/utils"
import { editionNudge } from "~/services/editions.server"
import { linkTargetStatus } from "~/services/links.server"
import { listNoteReminders } from "~/services/note-reminders.server"
import { finishedLately } from "~/services/reading-history.server"
import { readingHome } from "~/services/reading-home.server"
import { resurfacingDay } from "~/services/resurfacing.server"
import { offeredStarterTexts } from "~/services/starter-texts.server"
import {
	firstTopicsNotice,
	homeTopics,
	topicLabels,
	topicsInvitation,
} from "~/services/topics.server"
import type { Route } from "./+types/reading-home"

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const t = getInstance(context).getFixedT(null, "library")
	const knownZone = knownTimeZone(request.headers.get("cookie"))
	const timeZone = knownZone ?? "UTC"
	const params = new URL(request.url).searchParams
	const topicId = params.get("topic")
	const choosing = topicChoice(user.id, topicId, params.has("different"))
	// Without a topic asked for, Home loads alongside the topics; with one, after them, for its id.
	const [topics, finished, topicsReady, invitation, home, highlights, notes, nudge] =
		await Promise.all([
			choosing,
			finishedLately(user.id, { timeZone }),
			firstTopicsReady(user.id),
			topicsInvitation(user.id),
			topicId
				? choosing.then((choice) => readingHome(user.id, { topicId: choice?.chosen?.id }))
				: readingHome(user.id),
			// In a topic, Home is about its articles: no day's highlights picked for it.
			topicId ? null : homeHighlights(user.id, timeZone),
			// In a topic, Home is about reading what's next.
			topicId ? null : listNoteReminders(user.id),
			editionNudge(user.id),
		])
	const now = new Date()
	const locale = isLocale(user.locale) ? user.locale : fallbackLanguage
	// Each article's topic, when Home is not already about one.
	const labels =
		topics && !topics.chosen
			? await topicLabels(user.id, [
					...new Set(
						[
							...home.candidates.reading,
							...home.candidates.recent,
							...home.candidates.again,
							...home.candidates.rediscover,
						].map((d) => d.id),
					),
				])
			: {}
	return {
		...home,
		// Nothing to read, now or yet: something to start with, in the reader's language.
		starter: await homeStarter(user.id, locale, home.emptyState?.kind),
		language: locale,
		finished,
		topicsReady,
		invitation,
		topics,
		labels,
		highlights,
		notes,
		masthead: {
			// Without the browser's zone, the date and a greeting by the hour could be the wrong ones.
			date: knownZone ? mastheadDate(now, locale, knownZone) : null,
			part: knownZone ? partOfDay(now, knownZone) : null,
			edition: editionEar(nudge),
		},
		title: `${t("home.title")} · Klipstack`,
	}
}

/** A shelf's worth: the rest are on the Add page. */
/** The starter texts Home offers when it has nothing to feature: nothing saved, or all of it read. */
function homeStarter(userId: string, language: string, empty: string | undefined) {
	if (empty !== "new" && empty !== "caughtUp") return null
	return offeredStarterTexts(userId, language)
}

/** The day's highlights, and what Home knows of the articles their notes link to. */
async function homeHighlights(userId: string, timeZone: string) {
	const items = await dailyHighlights(userId, resurfacingDay(new Date(), timeZone))
	const linkTargets = await linkTargetStatus(
		userId,
		extractLinkIds(items.map((h) => h.note ?? "").join("\n")),
	)
	return { items, linkTargets }
}

/**
 * The reader's topics to choose from, the one to offer as something different, and the one chosen
 * (`?topic=` its id; `&different` when it was offered as something different, which it stays after
 * the reader reads from it). Null without topics. A topic that is not one of theirs, or has nothing
 * to read, is no choice: Home shows everything.
 */
async function topicChoice(userId: string, id: string | null, different: boolean) {
	if (!topicModels.available || !(await hasFeature(userId, "topics"))) return null
	const list = await homeTopics(userId)
	if (!list.topics.length) return null
	const chosen = list.topics.find((topic) => topic.id === id)
	return {
		list: list.topics.map(({ id, name, toRead }) => ({ id, name, toRead })),
		different: list.different,
		chosen: chosen ? { ...chosen, different } : null,
	}
}

/** The first topics wait for the reader, who has not opened them: Home says so, once. */
async function firstTopicsReady(userId: string): Promise<boolean> {
	if (!topicModels.available || !(await hasFeature(userId, "topics"))) return false
	return (await firstTopicsNotice(userId)).card
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
		// The page's name: on phones the masthead's greeting is a line of text under it.
		titleKey: "common:nav.home",
		save: true,
		search: { to: "/search", labelKey: "library:search.label" },
	},
}

/** Topics Home offers as chips, most to read first: the rest are under More. */
const TOPIC_CHIPS = 4

/** A topic chosen on Home: its id, and whether it was offered as something different. */
type TopicPick = { id: string; different: boolean } | null

/** Home's address for a topic and a time; null for any. */
function homeSearch(topic: TopicPick, minutes: number | null) {
	const params = new URLSearchParams()
	if (topic) params.set("topic", topic.id)
	if (topic?.different) params.set("different", "")
	if (minutes !== null) params.set("time", String(minutes))
	const search = params.toString()
	return search ? `?${search}` : ""
}

type TopicChoices = NonNullable<Route.ComponentProps["loaderData"]["topics"]>

export default function ReadingHome({
	loaderData: {
		candidates,
		timeChoice,
		feed,
		emptyState,
		starter,
		language,
		review,
		finished,
		topicsReady,
		invitation,
		topics,
		labels,
		highlights,
		notes,
		masthead,
	},
}: Route.ComponentProps) {
	const { t } = useTranslation(["library", "feed"])
	const navigate = useNavigate()
	const { onRead, readingId } = useFeedReader("/home")
	// Minutes to read, or null for any length: links, so they work before the page's script runs.
	const [searchParams] = useSearchParams()
	const minutes = parseTime(searchParams.get("time"))
	const chosen = topics?.chosen ?? null
	const pick: TopicPick = chosen ? { id: chosen.id, different: chosen.different } : null
	const { reading, recent, again, rediscover } = useMemo(
		() => homeShelves(candidates, timeChoice ? minutes : null),
		[candidates, timeChoice, minutes],
	)
	const timed = timeChoice && minutes !== null
	// The article read last shows even when it doesn't fit: it says so, and doesn't count as a fit.
	const nothingFits =
		timed && ![...reading, ...recent, ...again, ...rediscover].some((doc) => fitsIn(doc, minutes))
	const featured = reading[0]
	// Nothing to read draws the reading chair; a status keeps its icon.
	const EmptyIcon = emptyState?.kind === "processing" ? Clock3 : CircleAlert
	useEffect(() => {
		warmOffline(
			["/home", "/library"],
			[...reading, ...recent, ...again, ...rediscover].map((d) => `/read/${d.id}`),
		)
	}, [reading, recent, again, rediscover])
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
			<HomeMasthead {...masthead} deck={finished ? <FinishedLately {...finished} /> : null}>
				{timeChoice ? <TimeChoice minutes={minutes} topic={pick} /> : null}
				{topics ? <TopicChoice topics={topics} minutes={minutes} pick={pick} /> : null}
			</HomeMasthead>
			{topicsReady ? <TopicsCard /> : null}
			{/* With a time chosen, the reader came to read. */}
			{invitation && !timed ? <TopicsInvitation count={invitation.count} /> : null}
			{/* With a time chosen, the reader came to read. Mounted without a question, to keep a
			note being written on it. */}
			{timed ? null : (
				<HomeNotes items={notes?.items ?? []} suggested={notes?.suggested ?? false} />
			)}
			{chosen ? <TopicHeading topic={chosen} minutes={timed ? minutes : null} /> : null}
			<div className="space-y-12">
				<FrontPage
					reading={reading}
					recent={recent}
					labels={labels}
					topicId={chosen?.id}
					pickUp={
						timed && featured && !fitsIn(featured, minutes) ? (
							<p className="mt-3 text-sm text-muted-fg">
								{t("home.time.pickUp", { count: minutes! })}
							</p>
						) : null
					}
				/>
				{/* Recent saves have their columns when the side column holds the other reads. */}
				{reading.length > 1 && recent.length ? (
					<Columns
						id="home-recent"
						title={t("home.recent")}
						to={`/library${listSearch("unread", "newest", chosen?.id)}`}
						docs={recent}
						labels={labels}
					/>
				) : null}
				{again.length ? (
					<Columns
						id="home-again"
						title={t("home.again.title")}
						description={t("home.again.description")}
						to={`/library${listSearch("again", "recent", chosen?.id)}`}
						docs={again}
						labels={labels}
					/>
				) : null}
				{/* With a time chosen, the reader came to read. */}
				{highlights && !timed ? <HomeHighlights {...highlights} /> : null}
				{rediscover.length ? (
					<Columns
						id="home-rediscover"
						title={t("home.rediscover.title")}
						description={t("home.rediscover.description", { count: REDISCOVER_AFTER_DAYS })}
						to={`/library${listSearch("unread", "oldest", chosen?.id)}`}
						docs={rediscover}
						labels={labels}
					/>
				) : null}
				{/* With a time chosen, the reader came to read, not to tidy up. */}
				{review && !timed && !chosen ? <ReviewCard /> : null}
				{nothingFits ? (
					<div className="flex flex-col items-center gap-4 py-10 text-center">
						<p className="text-sm text-muted-fg">
							{chosen
								? t("home.topics.none", { count: minutes!, topic: chosen.name })
								: t("home.time.none", { count: minutes! })}
						</p>
						<Link
							to={{ search: homeSearch(pick, null) }}
							replace
							preventScrollReset
							className={buttonVariants({ variant: "secondary" })}
						>
							{chosen ? t("home.topics.anyLength") : t("home.time.showAll")}
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
						{/* Nothing to read yet, or now: the reading chair, waiting. */}
						{emptyState.kind === "new" || emptyState.kind === "caughtUp" ? (
							<EmptyDrawing name="chair" className="w-44" />
						) : (
							<EmptyIcon className="size-9 text-muted-fg" aria-hidden />
						)}
						<h2 className="font-serif text-3xl">{t(`home.empty.${emptyState.kind}.title`)}</h2>
						<p className="max-w-sm text-sm leading-relaxed text-muted-fg">
							{t(`home.empty.${emptyState.kind}.description`)}
						</p>
						<Link
							to={emptyState.to}
							// Nothing saved: it opens the Save link dialog where it is, as the + button does.
							onClick={(e) => {
								if (emptyState.kind === "new" && openSaveLink()) e.preventDefault()
							}}
							className={buttonVariants()}
						>
							{t(`home.empty.${emptyState.kind}.action`)}
						</Link>
						{starter?.length ? (
							<div className="mt-10 w-full max-w-xl">
								<StarterTexts items={starter} language={language} title={t("starter.homeTitle")} />
								<Link
									to="/texts"
									className="mt-4 inline-block text-sm text-link underline-offset-4 hover:underline"
								>
									{t("starter.more")}
								</Link>
							</div>
						) : null}
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

/** The first topics are ready: a way to them, or "Not now", which puts the card away (the dot stays). */
function TopicsCard() {
	const { t } = useTranslation("library")
	const later = useFetcher()
	if (later.state !== "idle" || later.data) return null
	return (
		<section
			aria-labelledby="home-topics"
			data-testid="home-topics"
			className="mb-8 rounded-xl border border-border bg-card p-5"
		>
			<h2 id="home-topics" className="font-medium">
				{t("topics.card.title")}
			</h2>
			<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-fg">
				{t("topics.card.body")}
			</p>
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Link to="/topics" className={buttonVariants({ variant: "secondary" })}>
					{t("topics.card.open")}
				</Link>
				<later.Form method="post" action="/topics">
					<input type="hidden" name="intent" value="dismiss" />
					<Button type="submit" variant="ghost">
						{t("topics.card.later")}
					</Button>
				</later.Form>
			</div>
		</section>
	)
}

/**
 * Topics are off and the library is big enough for them: an invitation, once, honest about where
 * the text goes. The way to the Topics page, or "No thanks", ends it for good.
 */
function TopicsInvitation({ count }: { count: number }) {
	const { t } = useTranslation("library")
	const decline = useFetcher()
	if (decline.state !== "idle" || decline.data) return null
	return (
		<section
			aria-labelledby="home-topics-invitation"
			data-testid="home-topics-invitation"
			className="mb-8 rounded-xl border border-border bg-card p-5"
		>
			<h2 id="home-topics-invitation" className="font-medium">
				{t("topics.invitation.title")}
			</h2>
			<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-fg">
				{t("topics.invitation.body", { count })}
			</p>
			<p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-fg">
				{t("topics.invitation.privacy")}
			</p>
			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Link to="/topics" className={buttonVariants({ variant: "secondary" })}>
					{t("topics.invitation.open")}
				</Link>
				<decline.Form method="post" action="/topics">
					<input type="hidden" name="intent" value="end-invitation" />
					<Button type="submit" variant="ghost">
						{t("topics.invitation.decline")}
					</Button>
				</decline.Form>
			</div>
		</section>
	)
}

/** How much time there is: narrows every section to what fits, without asking the server. */
function TimeChoice({ minutes, topic }: { minutes: number | null; topic: TopicPick }) {
	const { t } = useTranslation("library")
	const choice = (value: number | null) => (
		<Link
			key={value ?? "any"}
			to={{ search: homeSearch(topic, value) }}
			replace
			preventScrollReset
			aria-current={value === minutes ? "true" : undefined}
			// Already chosen: nothing to load or pick again.
			onClick={(e) => {
				if (value === minutes) e.preventDefault()
			}}
			className="chip aria-[current]:marked"
		>
			{value === null ? t("home.time.any") : t("home.time.choice", { count: value })}
		</Link>
	)
	return (
		<div
			role="group"
			aria-labelledby="home-time"
			data-testid="home-time"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 md:justify-center"
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

const CHIP = "shrink-0 chip aria-[current]:marked"

/**
 * What to read about: anything, the topics with most to read, something different (the topic read
 * from least lately), and the rest under More. A topic chosen from More shows as a chip of its own.
 * Each choice loads Home for it, keeping the time chosen.
 */
function TopicChoice({
	topics,
	minutes,
	pick,
}: {
	topics: TopicChoices
	minutes: number | null
	pick: TopicPick
}) {
	const { t } = useTranslation("library")
	const chosenId = pick && !pick.different ? pick.id : null
	const chips = topics.list.slice(0, TOPIC_CHIPS)
	const extra = topics.list.find((topic) => topic.id === chosenId && !chips.includes(topic))
	if (extra) chips.push(extra)
	const rest = topics.list.filter((topic) => !chips.includes(topic))
	// Something different stays chosen, and stays the same topic, when the reader reads from it.
	const different = pick?.different
		? pick
		: topics.different
			? { id: topics.different, different: true }
			: null
	const choice = (key: string, value: TopicPick, current: boolean, label: string) => (
		<Link
			key={key}
			to={{ search: homeSearch(value, minutes) }}
			replace
			preventScrollReset
			aria-current={current ? "true" : undefined}
			onClick={(e) => {
				if (current) e.preventDefault()
				else if (value) countTopicClick("topic_home")
			}}
			className={CHIP}
		>
			{label}
		</Link>
	)
	return (
		<div
			role="group"
			aria-labelledby="home-topic-choice"
			data-testid="home-topic-choice"
			className="flex flex-wrap items-center gap-x-3 gap-y-2 md:flex-nowrap md:items-start md:justify-center"
		>
			<h2 id="home-topic-choice" className="shrink-0 text-sm text-muted-fg md:py-1">
				{t("home.topics.title")}
			</h2>
			{/* One line on phones, scrolled sideways, so Home's sections stay in view. */}
			<div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-auto md:min-w-0 md:flex-initial md:flex-wrap md:overflow-visible md:px-0">
				{choice("any", null, !pick, t("home.topics.any"))}
				{chips.map((topic) =>
					choice(topic.id, { id: topic.id, different: false }, topic.id === chosenId, topic.name),
				)}
				{different
					? choice("different", different, !!pick?.different, t("home.topics.different"))
					: null}
				{rest.length ? (
					<MoreMenu
						label={t("home.topics.moreLabel")}
						className={cn(CHIP, "flex items-center gap-1")}
						icon={
							<>
								{t("home.topics.more")}
								<ChevronDown className="size-3.5" aria-hidden />
							</>
						}
					>
						{rest.map((topic) => (
							<MenuNavLink
								key={topic.id}
								to={homeSearch({ id: topic.id, different: false }, minutes)}
								replace
								onChoose={() => countTopicClick("topic_home")}
							>
								{topic.name}
							</MenuNavLink>
						))}
					</MoreMenu>
				) : null}
			</div>
		</div>
	)
}

/** The topic chosen, with the time if chosen: its name, why it is offered, and the way to all of it. */
function TopicHeading({
	topic,
	minutes,
}: {
	topic: NonNullable<TopicChoices["chosen"]>
	minutes: number | null
}) {
	const { t } = useTranslation("library")
	return (
		<div
			data-testid="home-topic"
			className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-border pb-5"
		>
			<div className="min-w-0">
				<h2 className="font-serif text-3xl leading-tight">
					{minutes === null
						? topic.name
						: t("home.topics.timed", { count: minutes, topic: topic.name })}
				</h2>
				<p className="mt-1 text-sm text-muted-fg">
					{topic.different
						? t(topic.lastRead ? "home.topics.differentLeast" : "home.topics.differentNever")
						: t("home.topics.toRead", { count: topic.toRead })}
				</p>
			</div>
			<Link
				to={`/topics/${topic.id}`}
				onClick={() => countTopicClick("topic_opened")}
				className="py-1 text-sm text-link hover:underline"
			>
				{t("home.topics.all", { topic: topic.name })}
				<span aria-hidden> →</span>
			</Link>
		</div>
	)
}

type HomeDoc = Route.ComponentProps["loaderData"]["candidates"]["reading"][number]

/** Where the front page's columns meet: a hairline between them, a rule above on phones. */
const SIDE_COLUMN =
	"max-md:mt-8 max-md:border-t max-md:border-border max-md:pt-6 md:border-l md:border-border md:pl-7"

/**
 * The front page: the article read last as the lead, the others in progress beside it (or, with
 * none, the newest saves). Without anything in progress, the newest save is the lead and the next
 * ones are beside it.
 */
function FrontPage({
	reading,
	recent,
	labels,
	topicId,
	pickUp,
}: {
	reading: HomeDoc[]
	recent: HomeDoc[]
	labels: Record<string, string>
	topicId: string | undefined
	/** Said under the lead when it doesn't fit the time chosen. */
	pickUp: ReactNode
}) {
	const { t } = useTranslation("library")
	const grid = "md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
	const sideList = (docs: HomeDoc[]) => (
		<ul>
			{docs.map((doc) => (
				<li
					key={doc.id}
					className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0"
				>
					<HomeArticle doc={doc} variant="side" topic={labels[doc.id]} />
				</li>
			))}
		</ul>
	)
	const [first, ...rest] = reading
	if (first) {
		const side =
			rest.length > 0
				? {
						id: "home-also",
						title: t("home.alsoReading"),
						to: `/library${listSearch("progress", "recent", topicId)}`,
						docs: rest,
					}
				: recent.length > 0
					? {
							id: "home-recent",
							title: t("home.recent"),
							to: `/library${listSearch("unread", "newest", topicId)}`,
							docs: recent,
						}
					: null
		return (
			<div data-testid="home-front" className={cn(side && grid)}>
				<section aria-labelledby="home-reading" className={cn(side && "md:pr-8")}>
					{/* With the others in progress beside it, the way to all of them is there. */}
					<Kicker
						id="home-reading"
						title={t("continueReading.title")}
						to={rest.length ? undefined : `/library${listSearch("progress", "recent", topicId)}`}
					/>
					<HomeArticle doc={first} variant="lead" topic={labels[first.id]} />
					{pickUp}
				</section>
				{side ? (
					<section aria-labelledby={side.id} className={SIDE_COLUMN}>
						<Kicker id={side.id} title={side.title} to={side.to} />
						{sideList(side.docs)}
					</section>
				) : null}
			</div>
		)
	}
	const [newest, ...next] = recent
	if (!newest) return null
	return (
		<section
			aria-labelledby="home-recent"
			data-testid="home-front"
			className={cn(next.length && grid)}
		>
			<div className={cn(next.length && "md:pr-8")}>
				<Kicker
					id="home-recent"
					title={t("home.recent")}
					to={`/library${listSearch("unread", "newest", topicId)}`}
				/>
				<HomeArticle doc={newest} variant="lead" topic={labels[newest.id]} />
			</div>
			{next.length ? <div className={SIDE_COLUMN}>{sideList(next)}</div> : null}
		</section>
	)
}

/** A front-page heading, set small as a newspaper's kicker, with the way to all of it. */
function Kicker({ id, title, to }: { id: string; title: string; to?: string }) {
	const { t } = useTranslation("library")
	return (
		<div className="mb-3 flex items-baseline justify-between gap-4">
			<h2 id={id} className="text-xs font-medium tracking-[0.08em] text-muted-fg uppercase">
				{title}
			</h2>
			{to ? (
				<Link
					to={to}
					aria-label={t("home.viewAllOf", { title })}
					className="shrink-0 py-1 text-sm text-link hover:underline"
				>
					{t("home.viewAll")}
					<span aria-hidden> →</span>
				</Link>
			) : null}
		</div>
	)
}

/** A section of the inside pages: its stories in columns, a hairline between them. */
function Columns({
	id,
	title,
	description,
	to,
	docs,
	labels,
}: {
	id: string
	title: string
	description?: string
	to: string
	docs: HomeDoc[]
	labels: Record<string, string>
}) {
	return (
		<section aria-labelledby={id} data-testid={id}>
			<SectionHeading id={id} title={title} to={to} />
			{description ? <p className="-mt-1 mb-5 text-sm text-muted-fg">{description}</p> : null}
			{/* Every column as wide as the others, so their pictures, and the headlines under them, line
			    up: each has the same padding, the outer ones reaching past the section's edges. */}
			<ul className="grid gap-y-5 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-8 lg:-mx-6 lg:grid-cols-3 lg:gap-x-0">
				{docs.map((doc) => (
					<li
						key={doc.id}
						className="min-w-0 max-sm:border-t max-sm:border-border max-sm:pt-5 max-sm:first:border-t-0 max-sm:first:pt-0 lg:border-l lg:border-border lg:px-6 lg:first:border-l-transparent"
					>
						<HomeArticle doc={doc} topic={labels[doc.id]} />
					</li>
				))}
			</ul>
		</section>
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
		<div className="mb-4 flex items-baseline justify-between gap-4 border-t-2 border-fg pt-2">
			<h2 id={id} className="section-title">
				{title}
			</h2>
			<Link
				to={to}
				aria-label={label ?? t("home.viewAllOf", { title })}
				className="shrink-0 py-2 text-sm text-link hover:underline"
			>
				{label ?? t("home.viewAll")}
				<span aria-hidden> →</span>
			</Link>
		</div>
	)
}
