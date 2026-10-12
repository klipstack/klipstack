import { TOPIC_NAME_MAX } from "@klipstack/api-contract/names"
import { topicsNamedIn } from "@klipstack/api-contract/search-query"
import { Shapes } from "lucide-react"
import { useEffect, useEffectEvent, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, redirect, useFetcher, useRevalidator, useRouteLoaderData } from "react-router"
import {
	confirmTopics,
	disableTopics,
	dismissTopicsCard,
	enableTopics,
	endTopicsInvitation,
	markTopicsSeen,
	removeTopic,
	renameTopic,
} from "~/commands/topics.server"
import { tooltip } from "~/components/tooltip-host"
import {
	TopicMenu,
	TopicRemoveConfirm,
	TopicRenameForm,
	useTopicActions,
	useTopicRefusals,
} from "~/components/topic-actions"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { topicModels } from "~/lib/ai.server"
import { AppError } from "~/lib/app-error"
import { formatDay } from "~/lib/date-groups"
import { hasFeature } from "~/lib/features.server"
import { getLocale } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { countTopicClick } from "~/lib/topic-use"
import { cn } from "~/lib/utils"
import { answer } from "~/lib/web-action.server"
import {
	hasTopics,
	type TopicBook,
	type TopicShelf,
	type TopicSummary,
	type TopicsState,
	topicsInvitationEnded,
	topicsState,
} from "~/services/topics.server"
import type { Route } from "./+types/topics"
import type { loader as layoutLoader } from "./app-layout"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.topics") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.topics" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	// Without the feature, or the providers, a reader who has topics may still turn them off.
	const usable = topicModels.available && (await hasFeature(user.id, "topics"))
	if (!usable && !(await hasTopics(user.id))) throw new Response(null, { status: 404 })
	const state = await topicsState(user.id)
	// Topics off, offered here: Home's invitation to them has done its work.
	const invited = usable && state.stage === "off" && !(await topicsInvitationEnded(user.id))
	// Formatted here, as Settings does: the server's Intl and the browser's may differ.
	const locale = getLocale(context)
	const number = new Intl.NumberFormat(locale)
	const sortsPaused = state.sortsPaused && {
		max: number.format(state.sortsPaused.max),
		waiting: number.format(state.sorting),
		date: formatDay(state.sortsPaused.resetsAt, locale, "UTC"),
		// The server sorts nothing at all: no month brings sorting back.
		off: state.sortsPaused.max === 0,
	}
	return { state, paused: !usable, invited, sortsPaused }
}

/**
 * POST /topics  intent=enable|disable|seen|dismiss|end-invitation|confirm|rename|remove. `confirm` takes the proposed
 * topics kept (`keep`, ids) and their names (`name:<id>`); `rename` and `remove` an `id`.
 */
export async function action({ request, context }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const id = String(form.get("id") ?? "")
	return answer(async () => {
		switch (form.get("intent")) {
			case "enable":
				await enableTopics(user.id)
				return {}
			case "disable":
				await disableTopics(user.id)
				// Without the feature, the page has nothing more to show: Home it is.
				if (!(topicModels.available && (await hasFeature(user.id, "topics"))))
					throw redirect("/home")
				return { disabled: true }
			case "seen":
				await markTopicsSeen(user.id)
				return {}
			case "dismiss":
				await dismissTopicsCard(user.id)
				return {}
			case "end-invitation":
				await endTopicsInvitation(user.id)
				return {}
			case "confirm":
				await confirmTopics(user.id, {
					keep: form.getAll("keep").map((kept) => ({
						id: String(kept),
						name: String(form.get(`name:${kept}`) ?? "") || undefined,
					})),
				})
				return {}
			case "rename":
				return renameTopic(user.id, id, String(form.get("name") ?? ""))
			case "remove":
				return { removed: (await removeTopic(user.id, id)).name }
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
}

/** The reader's topics, in whichever stage they are: off, waiting, proposing, proposed, active. */
export default function Topics({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const { state, paused, invited, sortsPaused } = loaderData
	// While the worker is on it, the page asks again now and then.
	const { revalidate } = useRevalidator()
	const busy =
		!paused &&
		(state.stage === "proposing" || (state.stage === "active" && state.sorting > 0 && !sortsPaused))
	useEffect(() => {
		if (!busy) return
		const id = window.setInterval(() => void revalidate(), 5000)
		return () => window.clearInterval(id)
	}, [busy, revalidate])
	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-8 md:px-8 md:pt-4 md:pb-8">
			<h1 className="hidden text-2xl font-semibold md:block md:leading-10">{tc("nav.topics")}</h1>
			<p className="max-w-2xl text-sm text-muted-fg md:mt-2">{t("topics.description")}</p>
			{paused ? (
				<p data-testid="topics-paused" className="mt-6 max-w-2xl text-sm text-muted-fg">
					{t("topics.paused")}
				</p>
			) : null}
			{state.stage === "off" && !paused ? <TurnOn state={state} invited={invited} /> : null}
			{state.stage === "waiting" && !paused ? (
				<section
					data-testid="topics-waiting"
					className="mt-6 max-w-2xl rounded-xl border border-border p-4"
				>
					<h2 className="font-medium">{t("topics.waiting.title")}</h2>
					<p className="mt-1 text-sm text-muted-fg">
						{t("topics.waiting.body", { needed: state.needed })}
					</p>
					<progress
						className="mt-3 h-2 w-full accent-accent"
						value={state.count}
						max={state.needed}
						aria-label={t("topics.waiting.progress", { count: state.count, needed: state.needed })}
					/>
					<p className="mt-1 text-xs text-muted-fg">
						{t("topics.waiting.progress", { count: state.count, needed: state.needed })}
					</p>
				</section>
			) : null}
			{state.stage === "proposing" && !paused ? (
				<section
					data-testid="topics-proposing"
					className="mt-6 max-w-2xl rounded-xl border border-border p-4"
				>
					<h2 className="font-medium">{t("topics.proposing.title")}</h2>
					<p className="mt-1 text-sm text-muted-fg">{t("topics.proposing.body")}</p>
				</section>
			) : null}
			{state.stage === "proposed" && !paused ? <Proposal state={state} /> : null}
			{state.stage === "active" && !paused ? (
				<Shelves state={state} sortsPaused={sortsPaused} />
			) : null}
			{state.stage === "off" ? null : <TurnOff />}
		</main>
	)
}

function TurnOn({ state, invited }: { state: TopicsState; invited: boolean }) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useTopicRefusals(fetcher.data)
	// Seeing this offer ends Home's invitation to it.
	const ended = useFetcher()
	const endInvitation = useEffectEvent(() =>
		ended.submit({ intent: "end-invitation" }, { method: "post" }),
	)
	useEffect(() => {
		if (invited) endInvitation()
	}, [invited])
	return (
		<section
			data-testid="topics-off"
			className="mt-6 max-w-2xl rounded-xl border border-border p-4"
		>
			<h2 className="flex items-center gap-2 font-medium">
				<Shapes className="size-4 text-accent" aria-hidden />
				{t("topics.off.title")}
			</h2>
			<p className="mt-2 text-sm">{t("topics.off.body", { needed: state.needed })}</p>
			<p className="mt-2 text-sm text-muted-fg">{t("topics.off.privacy")}</p>
			<fetcher.Form method="post" className="mt-4">
				<input type="hidden" name="intent" value="enable" />
				<Button type="submit" disabled={fetcher.state !== "idle"}>
					{t("topics.off.enable")}
				</Button>
			</fetcher.Form>
		</section>
	)
}

/** The first topics: keep, rename or drop each, then confirm once. */
function Proposal({ state }: { state: TopicsState }) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useTopicRefusals(fetcher.data)
	// Opening the proposal is seeing it: the sidebar's dot and Home's card go.
	const seen = useFetcher()
	const unseen = state.unseen
	const markSeen = useEffectEvent(() => seen.submit({ intent: "seen" }, { method: "post" }))
	useEffect(() => {
		if (unseen) markSeen()
	}, [unseen])
	if (state.topics.length === 0)
		return (
			<p data-testid="topics-none" className="mt-6 max-w-2xl text-sm text-muted-fg">
				{t("topics.proposed.none")}
			</p>
		)
	return (
		<section data-testid="topics-proposal" className="mt-6">
			<h2 className="font-medium">{t("topics.proposed.title")}</h2>
			<p className="mt-1 max-w-2xl text-sm text-muted-fg">{t("topics.proposed.body")}</p>
			<fetcher.Form method="post" className="mt-4">
				<input type="hidden" name="intent" value="confirm" />
				<ul data-testid="topics-proposal-grid" className="grid gap-3 md:grid-cols-2">
					{state.topics.map((topic) => (
						<ProposedTopic key={topic.id} topic={topic} />
					))}
				</ul>
				<Button type="submit" className="mt-4" disabled={fetcher.state !== "idle"}>
					{t("topics.proposed.confirm")}
				</Button>
			</fetcher.Form>
		</section>
	)
}

/**
 * One proposed topic, as a card: kept while checked, its name editable. Unchecked, it dims and its
 * name can't be edited (nor is it sent): a topic left out needs no name.
 */
function ProposedTopic({ topic }: { topic: TopicSummary }) {
	const { t } = useTranslation("library")
	const [kept, setKept] = useState(true)
	return (
		<li
			data-testid="proposed-topic"
			data-kept={kept}
			className={cn(
				"flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-opacity",
				!kept && "opacity-50",
			)}
		>
			<input
				type="checkbox"
				name="keep"
				value={topic.id}
				checked={kept}
				onChange={(e) => setKept(e.target.checked)}
				aria-label={t("topics.proposed.keep", { name: topic.name })}
				className="mt-2.5 size-4 shrink-0 accent-accent"
			/>
			<div className="min-w-0 flex-1">
				<Input
					name={`name:${topic.id}`}
					defaultValue={topic.name}
					disabled={!kept}
					maxLength={TOPIC_NAME_MAX}
					aria-label={t("topics.proposed.nameLabel", { name: topic.name })}
					autoComplete="off"
				/>
				<p className="mt-2 text-sm leading-relaxed text-muted-fg">{topic.description}</p>
			</div>
		</li>
	)
}

function Shelves({
	state,
	sortsPaused,
}: {
	state: TopicsState
	sortsPaused: { max: string; waiting: string; date: string; off: boolean } | null
}) {
	const { t } = useTranslation("library")
	return (
		<>
			{sortsPaused ? (
				<p data-testid="topics-sorts-paused" className="mt-6 max-w-2xl text-sm text-muted-fg">
					{t(sortsPaused.off ? "topics.sortsOff" : "topics.sortsPaused", {
						count: state.sorting,
						...sortsPaused,
					})}
				</p>
			) : state.sorting > 0 ? (
				<p
					data-testid="topics-sorting"
					role="status"
					className="mt-6 max-w-2xl text-sm text-muted-fg"
				>
					{t("topics.sorting", { count: state.sorting })}
				</p>
			) : null}
			{state.topics.length === 0 ? (
				<p data-testid="topics-empty" className="mt-6 max-w-2xl text-sm text-muted-fg">
					{t("topics.empty")}
				</p>
			) : (
				<>
					<ul data-testid="topics-shelves" className="mt-6 grid gap-x-10 gap-y-7 xl:grid-cols-2">
						{state.topics.map((topic) => (
							<Shelf key={topic.id} topic={topic} />
						))}
					</ul>
					<p className="mt-6 text-xs text-muted-fg">{t("topics.legend")}</p>
				</>
			)}
		</>
	)
}

/** A phone's shelf holds this many books; a larger screen's, what the server sends. */
const PHONE_SHELF = 12

/**
 * A topic as a shelf: its name, its size, and a book per article, newest first. A full shelf ends
 * in a book that says how many more there are, and opens the topic. On a phone a book is too narrow
 * to aim at, so the whole shelf opens the topic; on a larger screen, each book opens its article.
 */
function Shelf({ topic }: { topic: TopicShelf }) {
	const { t } = useTranslation("library")
	const actions = useTopicActions(topic)
	if (actions.removing) return null
	const href = `/topics/${topic.id}`
	// The server sends a full shelf at most: past it, the last place says how many more.
	const full = topic.articles > topic.books.length
	const shown = full ? topic.books.length - 1 : topic.books.length
	const phoneFull = topic.articles > PHONE_SHELF
	const seeAll = t("topics.seeAll", { count: topic.articles, name: actions.name })
	return (
		<li data-testid="topic-shelf" className="min-w-0">
			{actions.mode === "rename" ? (
				<TopicRenameForm actions={actions} />
			) : (
				<div className="flex items-center gap-2">
					<div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
						<h2 className="font-serif text-xl leading-tight font-semibold">
							<Link
								to={href}
								onClick={opened}
								className="decoration-1 underline-offset-2 hover:underline"
							>
								{actions.name}
							</Link>
						</h2>
						<span className="text-sm text-muted-fg">
							{t("topics.articles", { count: topic.articles })}
						</span>
						{topic.recent > 0 ? (
							<span
								className="inline-flex items-center gap-1 text-xs font-medium text-link"
								{...tooltip(t("topics.recentLong", { count: topic.recent }))}
							>
								<span aria-hidden className="size-1.5 rounded-full bg-current" />
								{t("topics.recent", { count: topic.recent })}
							</span>
						) : null}
					</div>
					<TopicMenu actions={actions} className="shrink-0 text-muted-fg" />
				</div>
			)}
			{actions.mode === "remove" ? (
				<div className="mt-2">
					<TopicRemoveConfirm actions={actions} />
				</div>
			) : null}
			<div className="relative mt-2">
				<ul
					aria-label={t("topics.shelf", { name: actions.name })}
					className="flex min-h-32 items-end gap-0.5 overflow-x-auto overflow-y-hidden border-b-[7px] border-shelf px-1.5 [scrollbar-width:thin] md:min-h-36"
				>
					{topic.books.slice(0, shown).map((book, i) => (
						<Book
							key={book.id}
							book={book}
							className={phoneFull && i >= PHONE_SHELF - 1 ? "max-md:hidden" : undefined}
						/>
					))}
					{phoneFull ? (
						<MoreBooks
							href={href}
							label={seeAll}
							count={topic.articles - (PHONE_SHELF - 1)}
							className="md:hidden"
						/>
					) : null}
					{full ? (
						<MoreBooks
							href={href}
							label={seeAll}
							count={topic.articles - shown}
							className="max-md:hidden"
						/>
					) : null}
				</ul>
				{/* Phones: the shelf is one target, the topic. */}
				<Link
					to={href}
					onClick={opened}
					tabIndex={-1}
					aria-hidden
					className="absolute inset-0 md:hidden"
				/>
			</div>
		</li>
	)
}

const opened = () => countTopicClick("topic_opened")

/** A small, stable number for a text: a book keeps its height and color from one visit to the next. */
function hash(text: string) {
	let h = 7
	for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
	return h
}

/**
 * An article as a book's spine: thicker for a longer read, colored by its site, its title down the
 * spine. One saved this week has a blue top.
 */
function Book({ book, className }: { book: TopicBook; className?: string }) {
	const { t } = useTranslation("library")
	const title = book.title ?? book.siteName ?? t("card.untitled")
	const words = Math.max(200, book.wordCount ?? 1000)
	const style = {
		"--k": Math.min(1, Math.max(0, (Math.log10(words) - 2.5) / 1.6)).toFixed(2),
		"--h": hash(book.id) % 30,
		"--hue": (hash(book.siteName ?? book.id) % 12) * 30,
	} as React.CSSProperties
	return (
		<li className={cn("flex shrink-0", className)}>
			<Link
				to={`/read/${book.id}`}
				aria-label={book.siteName ? `${title}, ${book.siteName}` : title}
				{...tooltip(title)}
				style={style}
				className={cn(
					"block h-[calc(92px+var(--h)*1px)] w-[calc(14px+var(--k)*6px)] overflow-hidden rounded-t-[3px] rounded-b-[1px] bg-[oklch(var(--k-book-l)_var(--k-book-c)_var(--hue))] py-2 text-[11px] leading-none font-medium text-ellipsis whitespace-nowrap text-book-fg [writing-mode:vertical-rl] motion-safe:transition-transform hover:-translate-y-1 focus-visible:-translate-y-1 md:h-[calc(104px+var(--h)*1px)] md:w-[calc(18px+var(--k)*14px)]",
					book.recent
						? "pt-3 shadow-[inset_0_4px_0_var(--color-link)]"
						: "shadow-[inset_-2px_0_0_rgb(0_0_0/0.06),inset_2px_0_0_rgb(255_255_255/0.18)]",
				)}
			>
				{title}
			</Link>
		</li>
	)
}

/** The last place on a full shelf: how many more, and the way to the topic that has them all. */
function MoreBooks({
	href,
	label,
	count,
	className,
}: {
	href: string
	label: string
	count: number
	className?: string
}) {
	return (
		<li className={cn("flex shrink-0", className)}>
			<Link
				to={href}
				onClick={opened}
				aria-label={label}
				{...tooltip(label)}
				className="grid h-24 w-[34px] place-items-center rounded-t-[3px] border border-dashed border-muted-fg/50 bg-muted text-[13px] font-semibold"
			>
				+{count}
			</Link>
		</li>
	)
}

/** Turning topics off deletes them: a second tap, as removing a topic. */
function TurnOff() {
	const { t, i18n } = useTranslation("library")
	const fetcher = useFetcher<typeof action>()
	useTopicRefusals(fetcher.data)
	const [armed, setArmed] = useState(false)
	// Saved searches that name topics would find nothing in them: the second tap says which.
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const naming = (layout?.savedSearches ?? [])
		.filter((s) => topicsNamedIn(s.query).length > 0)
		.map((s) => s.name)
	useEffect(() => {
		if (!armed) return
		const id = window.setTimeout(() => setArmed(false), naming.length ? 10000 : 4000)
		return () => window.clearTimeout(id)
	}, [armed, naming.length])
	const onAnswer = useEffectEvent((result: typeof fetcher.data) => {
		if (result?.ok && "disabled" in result) showToast({ message: t("topics.turnedOff") })
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])
	return (
		<fetcher.Form
			method="post"
			className="mt-10 max-w-2xl border-t border-border pt-4"
			onSubmit={(e) => {
				if (!armed) {
					e.preventDefault()
					setArmed(true)
				}
			}}
		>
			<input type="hidden" name="intent" value="disable" />
			<Button type="submit" variant={armed ? "danger" : "secondary"} size="sm">
				{armed ? t("topics.turnOffConfirm") : t("topics.turnOff")}
			</Button>
			{armed && naming.length ? (
				<p data-testid="topics-off-saved" role="status" className="mt-2 text-sm text-muted-fg">
					{t("topics.turnOffSaved", {
						count: naming.length,
						names: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(naming),
					})}
				</p>
			) : null}
		</fetcher.Form>
	)
}
