import {
	ChevronDown,
	Highlighter,
	ListFilter,
	Newspaper,
	Rows3,
	Shapes,
	Shuffle,
	X,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Link, redirect } from "react-router"
import { MenuNavLink, MoreMenu } from "~/components/more-menu"
import { PinnedControls } from "~/components/pinned-controls"
import { ArticleThumb, QuoteCard } from "~/components/quote-card"
import { SearchField } from "~/components/search-field"
import { tooltip } from "~/components/tooltip-host"
import { HIGHLIGHT_COLOR_NAMES, HIGHLIGHT_SWATCH, highlightColor } from "~/lib/highlight-colors"
import {
	DEFAULT_HIGHLIGHT_VIEW,
	HIGHLIGHT_FILTERS,
	HIGHLIGHT_VIEW_COOKIE,
	HIGHLIGHT_VIEWS,
	type HighlightFilter,
	type HighlightsState,
	type HighlightView,
	highlightsHref,
	highlightsKeep,
	highlightViewFromCookie,
	parseHighlightFilter,
	parseHighlightView,
} from "~/lib/highlight-filters"
import { extractLinkIds, type LinkTargets } from "~/lib/note-links"
import type { PageBarHandle } from "~/lib/page-bar"
import { cursorFields, isCursorTime, isUuid } from "~/lib/page-cursor"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import { sourceLabel } from "~/lib/site-label"
import { cn } from "~/lib/utils"
import {
	activeTopicName,
	dealHighlights,
	type HighlightTag,
	type HighlightTopicGroup,
	listHighlightTags,
	listHighlightTopics,
} from "~/services/highlight-board.server"
import {
	countHighlightFilters,
	type HighlightArticle,
	type HighlightListItem,
	listHighlightArticles,
	listUserHighlights,
} from "~/services/highlights.server"
import { linkTargetStatus } from "~/services/links.server"
import { topicsInUse } from "~/services/topics.server"
import type { Route } from "./+types/highlights"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.highlights") }]
}

/** A cursor this page wrote, or null: a bad one shows the first page. */
function decodeCursor(value: string | null) {
	const c = value ? cursorFields(value) : null
	return c && isCursorTime(c.createdAt) && isUuid(c.id)
		? { createdAt: c.createdAt, id: c.id }
		: null
}

/** A Shuffle hand's seed, as the address carries it. */
const SEED = /^[a-z0-9]{1,16}$/

export const handle: PageBarHandle = {
	pageBar: {
		titleKey: "common:nav.highlights",
		search: {
			action: "/highlights",
			clearTo: "/highlights",
			placeholderKey: "reader:highlights.search.placeholder",
			labelKey: "reader:highlights.search.label",
			clearKey: "reader:highlights.search.clear",
		},
	},
}

type Board =
	| { kind: "stream"; items: HighlightListItem[]; nextCursor: string | null }
	| { kind: "articles"; articles: HighlightArticle[] }
	| { kind: "topics"; groups: HighlightTopicGroup[] }
	| { kind: "shuffle"; items: HighlightListItem[] }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	const params = url.searchParams
	const q = params.get("q")?.trim() ?? ""
	const filter = parseHighlightFilter(params.get("show"))
	const [topicsOn, tags] = await Promise.all([topicsInUse(user.id), listHighlightTags(user.id)])
	// By topic only while the reader's topics are in use: otherwise by article.
	const usable = (v: HighlightView | null) => (v === "topics" && !topicsOn ? null : v)
	const asked = usable(parseHighlightView(params.get("view")))
	const saved = usable(highlightViewFromCookie(request.headers.get("cookie")))
	const view = asked ?? saved ?? DEFAULT_HIGHLIGHT_VIEW
	// A view in the URL is a choice: remember it on this device.
	const headers: HeadersInit =
		asked && asked !== saved
			? {
					"Set-Cookie": `${HIGHLIGHT_VIEW_COOKIE}=${asked}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
				}
			: {}
	// A tag or topic that is not the reader's (or not any more) narrows nothing.
	const tag = tags.find((t) => t.id === params.get("tag"))?.id ?? null
	const askedTopic = view === "topics" || !topicsOn ? null : params.get("topic")
	const topicName =
		askedTopic && askedTopic !== "none" && isUuid(askedTopic)
			? await activeTopicName(user.id, askedTopic)
			: null
	const topic = askedTopic === "none" ? "none" : topicName ? askedTopic : null
	const state: HighlightsState = { q, filter, view, tag, topic }

	const shuffle = params.get("shuffle")
	if (shuffle === "new")
		throw redirect(highlightsHref(state, { shuffle: Math.random().toString(36).slice(2, 10) }), {
			headers,
		})
	const seed = shuffle && SEED.test(shuffle) ? shuffle : null

	const matching = { userId: user.id, q, filter, scope: { tagId: tag, topic } }
	const [counts, board] = await Promise.all([
		countHighlightFilters(user.id, q, matching.scope),
		((): Promise<Board> => {
			if (seed)
				return dealHighlights({ ...matching, seed }).then((items) => ({ kind: "shuffle", items }))
			if (view === "topics")
				return listHighlightTopics(matching).then((groups) => ({ kind: "topics", groups }))
			if (view === "articles")
				return listHighlightArticles(matching).then((articles) => ({ kind: "articles", articles }))
			return listUserHighlights({ ...matching, cursor: decodeCursor(params.get("cursor")) }).then(
				({ items, nextCursor }) => ({
					kind: "stream",
					items,
					nextCursor: nextCursor
						? Buffer.from(JSON.stringify(nextCursor)).toString("base64url")
						: null,
				}),
			)
		})(),
	])
	// The notes' links say whether their articles are still there.
	const linkTargets = await linkTargetStatus(user.id, extractLinkIds(notesOf(board).join("\n")))
	return data(
		{ ...state, topicsOn, topicName, tags, counts, board, seed, linkTargets },
		{ headers },
	)
}

function cardsOf(board: Board): HighlightListItem[] {
	if (board.kind === "articles") return board.articles.flatMap((a) => a.highlights)
	if (board.kind === "topics") return board.groups.flatMap((g) => g.highlights)
	return board.items
}

function notesOf(board: Board): string[] {
	return cardsOf(board).flatMap((h) => (h.note ? [h.note] : []))
}

export default function Highlights({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("reader")
	const { t: tc } = useTranslation()
	const { t: tl } = useTranslation("library")
	const { q, filter, view, tag, topic, board, linkTargets } = loaderData
	const state: HighlightsState = { q, filter, view, tag, topic }
	const empty = cardsOf(board).length === 0
	const narrowed = Boolean(filter || tag || topic)
	const anyHighlights = q || narrowed || !empty
	const title = q ? t("highlights.search.results", { q }) : tc("nav.highlights")

	return (
		<main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-3 pb-6 md:pt-4 md:pb-8">
			<div className="hidden min-h-10 flex-wrap items-center justify-between gap-3 md:flex">
				<h1 className="text-2xl font-semibold">{title}</h1>
				<div className="flex items-center gap-2">
					<SearchField
						action="/highlights"
						value={q}
						clearTo={highlightsHref(state, { q: "" })}
						keep={highlightsKeep(state)}
						placeholder={t("highlights.search.placeholder")}
						label={t("highlights.search.label")}
						clearLabel={t("highlights.search.clear")}
					/>
				</div>
			</div>
			{anyHighlights ? (
				<PinnedControls title={title}>
					<Controls
						state={state}
						counts={loaderData.counts}
						tags={loaderData.tags}
						topicsOn={loaderData.topicsOn}
						topicName={loaderData.topicName}
						shuffling={board.kind === "shuffle"}
					/>
				</PinnedControls>
			) : null}
			{board.kind === "shuffle" && !empty ? (
				<div className="mt-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 md:mt-5">
					<h2 className="font-serif text-xl italic">{t("highlights.shuffle.title")}</h2>
					<Link
						to={highlightsHref(state, { shuffle: "new" })}
						className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm text-accent-fg hover:opacity-90"
					>
						<Shuffle className="size-3.5" aria-hidden />
						{t("highlights.shuffle.again")}
					</Link>
					<Link
						to={highlightsHref(state)}
						className="rounded-full px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg"
					>
						{t("highlights.shuffle.done")}
					</Link>
				</div>
			) : null}
			{empty ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					{narrowed ? (
						<ListFilter className="size-10" aria-hidden />
					) : (
						<Highlighter className="size-10" aria-hidden />
					)}
					<h2 className="text-lg font-medium text-fg">
						{q
							? t("highlights.search.empty")
							: narrowed
								? t("highlights.filters.empty")
								: t("highlights.pageEmpty.title")}
					</h2>
					{q || narrowed ? null : (
						<p className="max-w-sm text-sm">{t("highlights.pageEmpty.description")}</p>
					)}
				</div>
			) : board.kind === "articles" ? (
				<div className="flex flex-col gap-10 md:mt-4">
					{board.articles.map((article) => (
						<ArticleGroup key={article.documentId} article={article} linkTargets={linkTargets} />
					))}
				</div>
			) : board.kind === "topics" ? (
				<div className="flex flex-col gap-10 md:mt-4">
					{board.groups.map((group) => (
						<TopicGroup
							key={group.topicId ?? "none"}
							group={group}
							state={state}
							linkTargets={linkTargets}
						/>
					))}
				</div>
			) : (
				<>
					<Cards items={board.items} linkTargets={linkTargets} dealt={board.kind === "shuffle"} />
					{board.kind === "stream" && board.nextCursor ? (
						<div className="mt-6 flex justify-center">
							<Link
								to={highlightsHref(state, { cursor: board.nextCursor })}
								className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
							>
								{tl("loadMore")}
							</Link>
						</div>
					) : null}
				</>
			)}
		</main>
	)
}

/** The board: cards in columns, each as tall as its quote and note, like cards pinned to a wall. */
function Cards({
	items,
	linkTargets,
	withArticle = true,
	dealt = false,
}: {
	items: HighlightListItem[]
	linkTargets: LinkTargets
	withArticle?: boolean
	dealt?: boolean
}) {
	return (
		<ul className="columns-1 gap-5 pt-2 sm:columns-2 lg:columns-3 md:mt-2">
			{items.map((h, i) => (
				<QuoteCard
					key={h.id}
					h={h}
					linkTargets={linkTargets}
					withArticle={withArticle}
					dealt={dealt ? i : undefined}
				/>
			))}
		</ul>
	)
}

const CHIP =
	"flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg"
const CHIP_ON =
	"border-selected bg-selected text-selected-fg hover:bg-selected hover:text-selected-fg"

/**
 * The filter row: All, With notes and the colors (with counts; empty ones hide unless chosen), the
 * tag, the topic a group's "See all" chose; then Shuffle and the view switch.
 */
function Controls({
	state,
	counts,
	tags,
	topicsOn,
	topicName,
	shuffling,
}: {
	state: HighlightsState
	counts: Record<HighlightFilter, number>
	tags: HighlightTag[]
	topicsOn: boolean
	topicName: string | null
	shuffling: boolean
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const { filter, view } = state
	const shown = HIGHLIGHT_FILTERS.filter((f) => f === filter || counts[f] > 0)
	const chip = (f: HighlightFilter | null) => {
		const count = f ? counts[f] : 0
		const color = f && f !== "notes" ? HIGHLIGHT_COLOR_NAMES.indexOf(f) : null
		const label =
			f === null
				? t("highlights.filters.all")
				: f === "notes"
					? t("highlights.filters.notes")
					: t(`highlights.colors.${f}`)
		return (
			<Link
				key={f ?? "all"}
				to={highlightsHref(state, { filter: f })}
				aria-current={f === filter ? "true" : undefined}
				aria-label={color === null ? undefined : `${label} ${count}`}
				{...(color === null ? {} : tooltip(label))}
				className={CHIP}
			>
				{color === null ? (
					label
				) : (
					<span
						{...highlightColor(color)}
						data-testid="color-chip"
						className={cn("size-3 rounded-full", HIGHLIGHT_SWATCH)}
						aria-hidden
					/>
				)}
				{count ? <span className="tabular-nums">{count}</span> : null}
			</Link>
		)
	}
	const views = HIGHLIGHT_VIEWS.filter((v) => v !== "topics" || topicsOn)
	return (
		<div className="mt-1 mb-3 flex items-center gap-2 md:my-0">
			<nav
				aria-label={t("highlights.filters.label")}
				className="-ml-4 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pr-8 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:ml-0 md:pl-0"
			>
				{chip(null)}
				{shown.map((f) => chip(f))}
				{tags.length > 0 ? <TagChoice state={state} tags={tags} /> : null}
				{state.topic ? (
					<Link
						to={highlightsHref(state, { topic: null })}
						aria-label={tl("topicFilter.clear")}
						{...tooltip(tl("topicFilter.clear"))}
						data-testid="topic-chip"
						className={cn(CHIP, CHIP_ON)}
					>
						<span className="max-w-48 truncate">
							{tl("topicFilter.chosen", {
								topic: state.topic === "none" ? t("highlights.topics.other") : topicName,
							})}
						</span>
						<X className="size-3.5 shrink-0" aria-hidden />
					</Link>
				) : null}
			</nav>
			<Link
				to={highlightsHref(state, { shuffle: "new" })}
				aria-current={shuffling ? "true" : undefined}
				aria-label={t("highlights.shuffle.action")}
				{...tooltip(t("highlights.shuffle.action"))}
				className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border p-1.5 text-sm text-muted-fg hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg md:px-2.5"
			>
				<Shuffle className="size-4" aria-hidden />
				<span className="hidden md:inline">{t("highlights.shuffle.action")}</span>
			</Link>
			<fieldset
				aria-label={t("highlights.views.label")}
				className="flex shrink-0 rounded-lg border border-border p-0.5"
			>
				{views.map((v) => {
					const label = t(`highlights.views.${v}`)
					const Icon = v === "stream" ? Rows3 : v === "articles" ? Newspaper : Shapes
					return (
						<Link
							key={v}
							to={highlightsHref(state, { view: v })}
							aria-label={label}
							aria-current={v === view && !shuffling ? "true" : undefined}
							{...tooltip(label)}
							className="rounded-md p-1.5 text-muted-fg hover:text-fg aria-[current]:bg-selected aria-[current]:text-selected-fg"
						>
							<Icon className="size-4" aria-hidden />
						</Link>
					)
				})}
			</fieldset>
		</div>
	)
}

/** The tag the board keeps to: a menu of the tags whose articles have highlights; × shows all. */
function TagChoice({ state, tags }: { state: HighlightsState; tags: HighlightTag[] }) {
	const { t } = useTranslation("reader")
	const chosen = tags.find((x) => x.id === state.tag)?.name
	return (
		<span data-testid="tag-choice" className="flex shrink-0 items-center">
			<MoreMenu
				label={
					chosen
						? t("highlights.filters.tagChosen", { tag: chosen })
						: t("highlights.filters.tagChoose")
				}
				align="start"
				className={cn(CHIP, chosen && CHIP_ON, chosen && "rounded-r-none border-r-0 pr-2")}
				icon={
					<>
						<span className="max-w-40 truncate">
							{chosen ? `#${chosen}` : t("highlights.filters.tag")}
						</span>
						<ChevronDown className="size-3.5 shrink-0" aria-hidden />
					</>
				}
			>
				<div className="flex max-h-80 w-60 max-w-[80vw] flex-col overflow-y-auto">
					{tags.map((x) => (
						<MenuNavLink
							key={x.id}
							to={highlightsHref(state, { tag: x.id })}
							current={x.id === state.tag}
						>
							<span className="min-w-0 flex-1 truncate">{x.name}</span>
							<span className="shrink-0 text-xs text-muted-fg tabular-nums">{x.count}</span>
						</MenuNavLink>
					))}
				</div>
			</MoreMenu>
			{chosen ? (
				<Link
					to={highlightsHref(state, { tag: null })}
					aria-label={t("highlights.filters.tagClear")}
					{...tooltip(t("highlights.filters.tagClear"))}
					className={cn(CHIP, CHIP_ON, "self-stretch rounded-l-none border-l-0 px-2")}
				>
					<X className="size-3.5" aria-hidden />
				</Link>
			) : null}
		</span>
	)
}

/** Long articles show their first few highlights until opened up. */
const COLLAPSED = 6

function ArticleGroup({
	article,
	linkTargets,
}: {
	article: HighlightArticle
	linkTargets: LinkTargets
}) {
	const { t } = useTranslation("reader")
	const [open, setOpen] = useState(false)
	const count = article.highlights.length
	const shown = open ? article.highlights : article.highlights.slice(0, COLLAPSED)
	return (
		<section>
			<div className="mb-3 flex items-center gap-3">
				<ArticleThumb
					color={article.highlights[0]?.color ?? 0}
					image={article.image}
					sourceUrl={article.sourceUrl}
					siteName={article.siteName}
					className="size-12"
				/>
				<div className="min-w-0">
					<h2 className="font-serif text-xl leading-snug">
						<Link to={`/read/${article.documentId}`} className="hover:underline">
							{article.documentTitle ?? article.sourceUrl}
						</Link>
					</h2>
					<p className="text-sm text-muted-fg">
						{[sourceLabel(article), article.author, t("highlights.article.count", { count })]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
			</div>
			<Cards items={shown} linkTargets={linkTargets} withArticle={false} />
			{count > COLLAPSED ? (
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="rounded-md px-2 py-1 text-sm text-link hover:bg-muted"
				>
					{open ? t("highlights.article.showLess") : t("highlights.article.showAll", { count })}
				</button>
			) : null}
		</section>
	)
}

/** A topic's newest highlights, and the way to all of them: the stream, narrowed to the topic. */
function TopicGroup({
	group,
	state,
	linkTargets,
}: {
	group: HighlightTopicGroup
	state: HighlightsState
	linkTargets: LinkTargets
}) {
	const { t } = useTranslation("reader")
	const name = group.name ?? t("highlights.topics.other")
	return (
		<section aria-label={name}>
			<div className="mb-3 flex flex-wrap items-baseline gap-x-3">
				<h2 className="font-serif text-2xl leading-snug">{name}</h2>
				<p className="text-sm text-muted-fg">
					{t("highlights.article.count", { count: group.count })}
				</p>
				{group.count > group.highlights.length ? (
					<Link
						to={highlightsHref(state, { view: "stream", topic: group.topicId ?? "none" })}
						className="ml-auto text-sm text-link hover:underline"
					>
						{t("highlights.topics.seeAll", { count: group.count })}
					</Link>
				) : null}
			</div>
			<Cards items={group.highlights} linkTargets={linkTargets} />
		</section>
	)
}
