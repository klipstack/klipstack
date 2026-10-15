import { ChevronDown, ListFilter, Newspaper, Rows3, Shapes, Shuffle, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Link, redirect, useLocation } from "react-router"
import { ArticleNoteCard, type ArticleNoteCardNote } from "~/components/article-note-card"
import { MenuNavLink, MoreMenu } from "~/components/more-menu"
import { NotebookNote } from "~/components/notebook-note"
import { PinnedControls } from "~/components/pinned-controls"
import { tiltFor } from "~/components/post-it"
import { ArticleThumb, QuoteCard } from "~/components/quote-card"
import { SearchField } from "~/components/search-field"
import { tooltip } from "~/components/tooltip-host"
import { HIGHLIGHT_COLOR_NAMES, HIGHLIGHT_SWATCH, highlightColor } from "~/lib/highlight-colors"
import { extractLinkIds, type LinkTargets } from "~/lib/note-links"
import {
	DEFAULT_NOTEBOOK_VIEW,
	NOTEBOOK_FILTERS,
	NOTEBOOK_VIEW_COOKIE,
	NOTEBOOK_VIEWS,
	type NotebookFilter,
	type NotebookState,
	type NotebookView,
	notebookHref,
	notebookKeep,
	notebookViewFromCookie,
	parseNotebookFilter,
	parseNotebookView,
} from "~/lib/notebook-filters"
import type { PageBarHandle } from "~/lib/page-bar"
import { cursorFields, isCursorTime, isUuid } from "~/lib/page-cursor"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import { sourceLabel } from "~/lib/site-label"
import { cn } from "~/lib/utils"
import type { HighlightListItem } from "~/services/highlights.server"
import { linkTargetStatus } from "~/services/links.server"
import {
	activeTopicName,
	countNotebook,
	dealNotebook,
	listNotebookArticles,
	listNotebookStream,
	listNotebookTags,
	listNotebookTopics,
	type NotebookArticle,
	type NotebookCounts,
	type NotebookItem,
	type NotebookTag,
	type NotebookTopicGroup,
} from "~/services/notebook.server"
import { getTag } from "~/services/tags.server"
import { topicsInUse } from "~/services/topics.server"
import type { Route } from "./+types/notebook"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.notebook") }]
}

/** A cursor this page wrote, or null: a bad one shows the first page. */
function decodeCursor(value: string | null) {
	const c = value ? cursorFields(value) : null
	return c && isCursorTime(c.at) && isUuid(c.id) ? { at: c.at, id: c.id } : null
}

const encodeCursor = (cursor: { at: string; id: string } | null) =>
	cursor ? Buffer.from(JSON.stringify(cursor)).toString("base64url") : null

/** A Shuffle hand's seed, as the address carries it. */
const SEED = /^[a-z0-9]{1,16}$/

export const handle: PageBarHandle = {
	pageBar: {
		titleKey: "common:nav.notebook",
		search: {
			action: "/notebook",
			clearTo: "/notebook",
			placeholderKey: "reader:notebook.search.placeholder",
			labelKey: "reader:notebook.search.label",
			clearKey: "reader:notebook.search.clear",
		},
	},
}

/** An article note as the page gets it: its save time exact to the millisecond, as a string. */
type WireNote = Extract<NotebookItem, { kind: "note" }> & ArticleNoteCardNote
type Card = Extract<NotebookItem, { kind: "highlight" }> | WireNote
type Article = Omit<NotebookArticle, "noteUpdatedAt"> & { noteUpdatedAt: string | null }
type TopicGroup = Omit<NotebookTopicGroup, "items"> & { items: Card[] }

type Board =
	| { kind: "articles"; articles: Article[]; nextCursor: string | null }
	| { kind: "stream"; items: Card[]; nextCursor: string | null }
	| { kind: "topics"; groups: TopicGroup[] }
	| { kind: "shuffle"; items: Card[] }

const toCard = (item: NotebookItem): Card =>
	item.kind === "note"
		? ({ ...item, noteUpdatedAt: item.noteUpdatedAt?.toISOString() ?? null } as WireNote)
		: item

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	const params = url.searchParams
	const q = params.get("q")?.trim() ?? ""
	const filter = parseNotebookFilter(params.get("show"))
	const [topicsOn, tags] = await Promise.all([topicsInUse(user.id), listNotebookTags(user.id)])
	// By topic only while the reader's topics are in use: otherwise by article.
	const usable = (v: NotebookView | null) => (v === "topics" && !topicsOn ? null : v)
	const asked = usable(parseNotebookView(params.get("view")))
	const saved = usable(notebookViewFromCookie(request.headers.get("cookie")))
	const view = asked ?? saved ?? DEFAULT_NOTEBOOK_VIEW
	// A view in the URL is a choice: remember it on this device. Not a topic group's "See all",
	// which is a look at one topic: its chip goes back to the view remembered.
	const headers: HeadersInit =
		asked && asked !== saved && !params.get("topic")
			? {
					"Set-Cookie": `${NOTEBOOK_VIEW_COOKIE}=${asked}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
				}
			: {}
	// A tag or topic that is not the reader's (or not any more) narrows nothing. A tag of theirs
	// whose last highlight or note just went stays chosen, with none.
	const askedTag = params.get("tag")
	const ownTag =
		askedTag && isUuid(askedTag) && !tags.some((t) => t.id === askedTag)
			? await getTag(user.id, askedTag)
			: null
	if (ownTag) tags.push({ id: ownTag.id, name: ownTag.name, count: 0 })
	const tag = tags.find((t) => t.id === askedTag)?.id ?? null
	const askedTopic = view === "topics" || !topicsOn ? null : params.get("topic")
	const topicName =
		askedTopic && askedTopic !== "none" && isUuid(askedTopic)
			? await activeTopicName(user.id, askedTopic)
			: null
	const topic = askedTopic === "none" ? "none" : topicName ? askedTopic : null
	const state: NotebookState = { q, filter, view, tag, topic }

	const shuffle = params.get("shuffle")
	if (shuffle === "new")
		throw redirect(notebookHref(state, { shuffle: Math.random().toString(36).slice(2, 10) }), {
			headers,
		})
	const seed = shuffle && SEED.test(shuffle) ? shuffle : null

	const matching = { userId: user.id, q, filter, scope: { tagId: tag, topic } }
	const cursor = decodeCursor(params.get("cursor"))
	const [counts, board] = await Promise.all([
		countNotebook(user.id, q, matching.scope),
		((): Promise<Board> => {
			if (seed)
				return dealNotebook({ ...matching, seed }).then((items) => ({
					kind: "shuffle",
					items: items.map(toCard),
				}))
			if (view === "topics")
				return listNotebookTopics(matching).then((groups) => ({
					kind: "topics",
					groups: groups.map((g) => ({ ...g, items: g.items.map(toCard) })),
				}))
			if (view === "stream")
				return listNotebookStream({ ...matching, cursor }).then(({ items, nextCursor }) => ({
					kind: "stream",
					items: items.map(toCard),
					nextCursor: encodeCursor(nextCursor),
				}))
			return listNotebookArticles({ ...matching, cursor }).then(({ articles, nextCursor }) => ({
				kind: "articles",
				articles: articles.map((a) => ({
					...a,
					noteUpdatedAt: a.noteUpdatedAt?.toISOString() ?? null,
				})),
				nextCursor: encodeCursor(nextCursor),
			}))
		})(),
	])
	// The notes' links say whether their articles are still there.
	const linkTargets = await linkTargetStatus(user.id, extractLinkIds(notesOf(board).join("\n")))
	return data(
		{ ...state, savedView: saved, topicsOn, topicName, tags, counts, board, seed, linkTargets },
		{ headers },
	)
}

function notesOf(board: Board): string[] {
	if (board.kind === "articles")
		return board.articles.flatMap((a) => [a.note ?? "", ...a.highlights.map((h) => h.note ?? "")])
	const cards = board.kind === "topics" ? board.groups.flatMap((g) => g.items) : board.items
	return cards.map((c) => c.note ?? "")
}

function isEmpty(board: Board): boolean {
	if (board.kind === "articles") return board.articles.length === 0
	if (board.kind === "topics") return board.groups.length === 0
	return board.items.length === 0
}

export default function Notebook({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("reader")
	const { t: tc } = useTranslation()
	const { q, filter, view, tag, topic, board, linkTargets, counts } = loaderData
	const state: NotebookState = { q, filter, view, tag, topic }
	const empty = isEmpty(board)
	// Nothing kept at all yet: no search or narrowing could find anything.
	const blank = !q && !tag && !topic && counts.all === 0
	const title = q ? t("notebook.search.results", { q }) : tc("nav.notebook")

	return (
		<main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-3 pb-6 md:pt-4 md:pb-8">
			<div className="hidden min-h-10 flex-wrap items-center justify-between gap-3 md:flex">
				<h1 className="page-title">{title}</h1>
				{blank ? null : (
					<SearchField
						action="/notebook"
						value={q}
						clearTo={notebookHref(state, { q: "" })}
						keep={notebookKeep(state)}
						placeholder={t("notebook.search.placeholder")}
						label={t("notebook.search.label")}
						clearLabel={t("notebook.search.clear")}
					/>
				)}
			</div>
			{blank ? null : (
				<PinnedControls title={title}>
					<Controls
						state={state}
						counts={counts}
						tags={loaderData.tags}
						topicsOn={loaderData.topicsOn}
						topicName={loaderData.topicName}
						savedView={loaderData.savedView}
						shuffling={board.kind === "shuffle"}
					/>
				</PinnedControls>
			)}
			{board.kind === "shuffle" && !empty ? (
				<div className="mt-3 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 md:mt-5">
					<h2 className="font-serif text-xl italic">{t("notebook.shuffle.title")}</h2>
					<Link
						to={notebookHref(state, { shuffle: "new" })}
						className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm text-accent-fg hover:opacity-90"
					>
						<Shuffle className="size-3.5" aria-hidden />
						{t("notebook.shuffle.again")}
					</Link>
					<Link
						to={notebookHref(state)}
						className="rounded-full px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg"
					>
						{t("notebook.shuffle.done")}
					</Link>
				</div>
			) : null}
			{blank ? (
				<EmptyNotebook />
			) : empty ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<ListFilter className="size-10" aria-hidden />
					<h2 className="text-lg font-medium text-fg">
						{q ? t("notebook.search.empty") : t("notebook.filters.empty")}
					</h2>
				</div>
			) : board.kind === "articles" ? (
				<>
					<div className="flex flex-col gap-12 md:mt-4">
						{board.articles.map((article) => (
							<ArticleSection
								key={article.documentId}
								article={article}
								linkTargets={linkTargets}
							/>
						))}
					</div>
					<More state={state} cursor={board.nextCursor} />
				</>
			) : board.kind === "topics" ? (
				<div className="flex flex-col gap-10 md:mt-4">
					{board.groups.map((group, i) => (
						<TopicSection
							key={group.topicId ?? "none"}
							group={group}
							state={state}
							linkTargets={linkTargets}
							shownAbove={notesIn(board.groups.slice(0, i))}
						/>
					))}
				</div>
			) : (
				<>
					<Cards items={board.items} linkTargets={linkTargets} dealt={board.kind === "shuffle"} />
					{board.kind === "stream" ? <More state={state} cursor={board.nextCursor} /> : null}
				</>
			)}
		</main>
	)
}

/** The articles whose notes these groups show: an article in two topics shows its note twice. */
function notesIn(groups: TopicGroup[]): Set<string> {
	return new Set(
		groups.flatMap((g) => g.items.flatMap((c) => (c.kind === "note" ? [c.documentId] : []))),
	)
}

function More({ state, cursor }: { state: NotebookState; cursor: string | null }) {
	const { t } = useTranslation("reader")
	if (!cursor) return null
	return (
		<div className="mt-8 flex justify-center">
			<Link
				to={notebookHref(state, { cursor })}
				className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
			>
				{t("notebook.loadMore")}
			</Link>
		</div>
	)
}

/**
 * The board: cards in columns, each as tall as its quote or note, like cards pinned to a wall.
 * A highlight is its quote; an article's note, its article with the note stuck on it.
 */
function Cards({
	items,
	linkTargets,
	withArticle = true,
	dealt = false,
	readOnlyNotes,
	className = "sm:columns-2 lg:columns-3",
}: {
	items: Array<Card | HighlightListItem>
	linkTargets: LinkTargets
	withArticle?: boolean
	dealt?: boolean
	/** Article notes written on elsewhere on the page: shown, not edited, here. */
	readOnlyNotes?: Set<string>
	className?: string
}) {
	return (
		<ul className={cn("columns-1 gap-5 pt-2 md:mt-2", className)}>
			{items.map((c, i) =>
				"kind" in c && c.kind === "note" ? (
					<ArticleNoteCard
						// A note saved since (elsewhere, or here before a search) starts its editor over.
						key={`note:${c.documentId}:${c.noteUpdatedAt}`}
						n={c}
						linkTargets={linkTargets}
						dealt={dealt ? i : undefined}
						readOnly={readOnlyNotes?.has(c.documentId)}
					/>
				) : (
					<QuoteCard
						key={(c as HighlightListItem).id}
						h={c as HighlightListItem}
						linkTargets={linkTargets}
						withArticle={withArticle}
						dealt={dealt ? i : undefined}
					/>
				),
			)}
		</ul>
	)
}

const CHIP = "flex shrink-0 items-center gap-1.5 chip aria-[current]:marked"
const CHIP_ON = "marked"

/**
 * The filter row: All, Notes, Highlights and the colors (with counts; empty ones hide unless
 * chosen), the tag, the topic a group's "See all" chose; then Shuffle and the view switch.
 */
function Controls({
	state,
	counts,
	tags,
	topicsOn,
	topicName,
	savedView,
	shuffling,
}: {
	state: NotebookState
	counts: NotebookCounts
	tags: NotebookTag[]
	topicsOn: boolean
	topicName: string | null
	/** The view remembered on this device: where the topic chip's × goes back to. */
	savedView: NotebookView | null
	shuffling: boolean
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const { filter, view } = state
	const shown = NOTEBOOK_FILTERS.filter((f) => f === filter || counts[f] > 0)
	const chip = (f: NotebookFilter | null) => {
		const count = counts[f ?? "all"]
		const color = f && f !== "notes" && f !== "highlights" ? HIGHLIGHT_COLOR_NAMES.indexOf(f) : null
		const label =
			f === null
				? t("notebook.filters.all")
				: f === "notes" || f === "highlights"
					? t(`notebook.filters.${f}`)
					: t(`highlights.colors.${f}`)
		return (
			<Link
				key={f ?? "all"}
				to={notebookHref(state, { filter: f })}
				aria-current={f === filter ? "true" : undefined}
				aria-label={
					color === null ? undefined : t("notebook.filters.colorCount", { color: label, count })
				}
				{...(color === null ? {} : { ...tooltip(label), ...highlightColor(color) })}
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
	const views = NOTEBOOK_VIEWS.filter((v) => v !== "topics" || topicsOn)
	return (
		<div className="mt-1 mb-3 flex items-center gap-2 md:my-0">
			<nav
				aria-label={t("notebook.filters.label")}
				className="-ml-4 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pr-8 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:ml-0 md:pl-0"
			>
				{chip(null)}
				{shown.map((f) => chip(f))}
				{tags.length > 0 ? <TagChoice state={state} tags={tags} /> : null}
				{state.topic ? (
					<Link
						to={notebookHref(state, { topic: null, view: savedView ?? view })}
						aria-label={tl("topicFilter.clear")}
						{...tooltip(tl("topicFilter.clear"))}
						data-testid="topic-chip"
						className={cn(CHIP, CHIP_ON)}
					>
						<span className="max-w-48 truncate">
							{tl("topicFilter.chosen", {
								topic: state.topic === "none" ? t("notebook.topics.other") : topicName,
							})}
						</span>
						<X className="size-3.5 shrink-0" aria-hidden />
					</Link>
				) : null}
			</nav>
			<Link
				to={notebookHref(state, { shuffle: "new" })}
				aria-current={shuffling ? "true" : undefined}
				aria-label={t("notebook.shuffle.action")}
				{...tooltip(t("notebook.shuffle.action"))}
				className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border p-1.5 text-sm text-muted-fg hover:text-fg aria-[current]:bg-fg/10 aria-[current]:text-fg md:px-2.5"
			>
				<Shuffle className="size-4" aria-hidden />
				<span className="hidden md:inline">{t("notebook.shuffle.action")}</span>
			</Link>
			<fieldset
				aria-label={t("notebook.views.label")}
				className="flex shrink-0 rounded-lg border border-border p-0.5"
			>
				{views.map((v) => {
					const label = t(`notebook.views.${v}`)
					const Icon = v === "stream" ? Rows3 : v === "articles" ? Newspaper : Shapes
					return (
						<Link
							key={v}
							to={notebookHref(state, { view: v })}
							aria-label={label}
							aria-current={v === view && !shuffling ? "true" : undefined}
							{...tooltip(label)}
							className="rounded-md p-1.5 text-muted-fg hover:text-fg aria-[current]:bg-fg/10 aria-[current]:text-fg"
						>
							<Icon className="size-4" aria-hidden />
						</Link>
					)
				})}
			</fieldset>
		</div>
	)
}

/** The tag the page keeps to: a menu of the tags whose articles have something kept; × shows all. */
function TagChoice({ state, tags }: { state: NotebookState; tags: NotebookTag[] }) {
	const { t } = useTranslation("reader")
	const chosen = tags.find((x) => x.id === state.tag)?.name
	return (
		<span data-testid="tag-choice" className="flex shrink-0 items-center">
			<MoreMenu
				label={
					chosen
						? t("notebook.filters.tagChosen", { tag: chosen })
						: t("notebook.filters.tagChoose")
				}
				align="start"
				className={cn(CHIP, chosen && CHIP_ON, chosen && "rounded-r-none! pr-2")}
				icon={
					<>
						<span className="max-w-40 truncate">
							{chosen ? `#${chosen}` : t("notebook.filters.tag")}
						</span>
						<ChevronDown className="size-3.5 shrink-0" aria-hidden />
					</>
				}
			>
				<div className="flex max-h-80 w-60 max-w-[80vw] flex-col overflow-y-auto">
					{tags.map((x) => (
						<MenuNavLink
							key={x.id}
							to={notebookHref(state, { tag: x.id })}
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
					to={notebookHref(state, { tag: null })}
					aria-label={t("notebook.filters.tagClear")}
					{...tooltip(t("notebook.filters.tagClear"))}
					className={cn(CHIP, CHIP_ON, "self-stretch rounded-l-none! px-2")}
				>
					<X className="size-3.5" aria-hidden />
				</Link>
			) : null}
		</span>
	)
}

/** Long articles show their first few highlights until opened up. */
const COLLAPSED = 6

/**
 * An article and what was kept from it. On wide screens, two columns: the article and its note on
 * the left, staying in view while its highlights scroll by on the right. On phones, one after the
 * other: the title, the note, the highlights.
 */
function ArticleSection({ article, linkTargets }: { article: Article; linkTargets: LinkTargets }) {
	const { t } = useTranslation("reader")
	const location = useLocation()
	const [open, setOpen] = useState(false)
	const count = article.highlights.length
	const shown = open ? article.highlights : article.highlights.slice(0, COLLAPSED)
	const title = article.documentTitle || article.sourceUrl
	return (
		<section
			aria-label={title}
			data-testid="notebook-article"
			className="grid gap-x-10 gap-y-5 border-border border-t pt-8 first:border-t-0 first:pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
		>
			<div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
				<div>
					<Cover article={article} />
					<div className="flex items-center gap-3">
						<ArticleThumb
							color={article.highlights[0]?.color ?? 0}
							image={article.image}
							sourceUrl={article.sourceUrl}
							siteName={article.siteName}
							className={cn("size-12", article.image && "lg:hidden")}
						/>
						<div className="min-w-0">
							<h2 className="font-serif text-xl leading-snug">
								<Link
									to={`/read/${article.documentId}`}
									state={{ from: location.pathname + location.search }}
									className="hover:underline"
								>
									{title}
								</Link>
							</h2>
							<p className="text-sm text-muted-fg">
								{[
									sourceLabel(article),
									article.author,
									count ? t("notebook.article.count", { count }) : null,
								]
									.filter(Boolean)
									.join(" · ")}
							</p>
						</div>
					</div>
				</div>
				<div className="pr-2 pl-1">
					<NotebookNote
						// A note saved since (elsewhere, or here before a search) starts its editor over.
						key={article.noteUpdatedAt}
						documentId={article.documentId}
						title={title}
						note={article.note ?? ""}
						noteUpdatedAt={article.noteUpdatedAt}
						linkTargets={linkTargets}
						tilt={tiltFor(article.documentId)}
						large
					/>
				</div>
			</div>
			<div className="min-w-0">
				{count ? (
					<Cards
						items={shown}
						linkTargets={linkTargets}
						withArticle={false}
						className="sm:columns-2 lg:columns-1 xl:columns-2"
					/>
				) : null}
				{count > COLLAPSED ? (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						className="rounded-md px-2 py-1 text-sm text-link hover:bg-muted"
					>
						{open ? t("notebook.article.showLess") : t("notebook.article.showAll", { count })}
					</button>
				) : null}
			</div>
		</section>
	)
}

/** The article's cover, wide, above its title on wide screens; nothing when it has none. */
function Cover({ article }: { article: Article }) {
	const [broken, setBroken] = useState(false)
	if (!article.image || broken) return null
	return (
		<img
			src={article.image}
			alt=""
			loading="lazy"
			referrerPolicy="no-referrer"
			onError={() => setBroken(true)}
			className="mb-4 hidden aspect-[5/2] w-full rounded-xl bg-fg/5 object-cover lg:block"
		/>
	)
}

/** A topic's newest cards, and the way to all of them: the stream, narrowed to the topic. */
function TopicSection({
	group,
	state,
	linkTargets,
	shownAbove,
}: {
	group: TopicGroup
	state: NotebookState
	linkTargets: LinkTargets
	/** Article notes an earlier group shows, and writes on. */
	shownAbove: Set<string>
}) {
	const { t } = useTranslation("reader")
	const name = group.name ?? t("notebook.topics.other")
	const total = group.highlights + group.notes
	return (
		<section aria-label={name}>
			<div className="mb-3 flex flex-wrap items-baseline gap-x-3">
				<h2 className="font-serif text-2xl leading-snug">{name}</h2>
				<p className="text-sm text-muted-fg">
					{[
						group.highlights ? t("notebook.count.highlights", { count: group.highlights }) : null,
						group.notes ? t("notebook.count.notes", { count: group.notes }) : null,
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
				{total > group.items.length ? (
					<Link
						to={notebookHref(state, { view: "stream", topic: group.topicId ?? "none" })}
						className="ml-auto text-sm text-link hover:underline"
					>
						{t("notebook.topics.seeAll", { count: total })}
					</Link>
				) : null}
			</div>
			<Cards items={group.items} linkTargets={linkTargets} readOnlyNotes={shownAbove} />
		</section>
	)
}

/** Nothing kept yet: a blank post-it, and where to start. */
function EmptyNotebook() {
	const { t } = useTranslation("reader")
	return (
		<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
			<BlankPostIt />
			<h2 className="mt-2 text-lg font-medium text-fg">{t("notebook.empty.title")}</h2>
			<p className="max-w-sm text-sm">{t("notebook.empty.description")}</p>
			<Link
				to="/library"
				className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
			>
				{t("notebook.empty.action")}
			</Link>
		</div>
	)
}

/** A small drawing of a post-it with nothing on it yet, taped on and leaning, in the notes' paper. */
function BlankPostIt() {
	return (
		<svg
			viewBox="0 0 120 112"
			aria-hidden
			data-testid="blank-post-it"
			className="h-24 w-auto -rotate-3 drop-shadow-[0_8px_10px_rgb(0_0_0/0.18)]"
		>
			{/* The paper, its bottom corner lifting off the page. */}
			<path d="M14 14 H106 V92 Q104 100 92 102 H14 Z" className="fill-note" />
			<path d="M106 92 Q104 100 92 102 Q98 96 106 92 Z" className="fill-note-fg/15" />
			{/* Faint lines, nothing written on them. */}
			{[44, 60, 76].map((y) => (
				<line
					key={y}
					x1="28"
					x2="92"
					y1={y}
					y2={y}
					strokeWidth="1.5"
					strokeLinecap="round"
					className="stroke-note-fg/15"
				/>
			))}
			<rect
				x="40"
				y="4"
				width="40"
				height="16"
				rx="1"
				transform="rotate(-4 60 12)"
				className="fill-note-tape"
			/>
		</svg>
	)
}
