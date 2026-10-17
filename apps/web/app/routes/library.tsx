// The subpath is client-safe (constants only); the package root pulls in pg-boss.
import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import { addOperator } from "@klipstack/api-contract/search-query"
import { fallbackLanguage, isLocale } from "@klipstack/i18n/languages"
import {
	Archive,
	ArrowDownUp,
	Check,
	ChevronDown,
	History,
	Inbox,
	ListFilter as FilterIcon,
	LayoutGrid,
	List,
	Search,
	Star,
	Trash2,
	X,
} from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, redirect, useFetcher, useLocation, useNavigate } from "react-router"
import { archiveFinished, undoArchive } from "~/commands/articles.server"
import { saveArticle, saveLinks } from "~/commands/saving.server"
import { DocumentList } from "~/components/document-list"
import { EmptyDrawing, type EmptyDrawingName } from "~/components/empty-drawing"
import { LayoutToggle } from "~/components/layout-toggle"
import { MenuButton, MenuNavLink, MoreMenu } from "~/components/more-menu"
import { PinnedControls } from "~/components/pinned-controls"
import { SaveLinkButton } from "~/components/save-link-dialog"
import { SelectionBar } from "~/components/selection-bar"
import { StarterOffer } from "~/components/starter-texts"
import { tooltip } from "~/components/tooltip-host"
import { useListCursor } from "~/hooks/use-list-cursor"
import { AppError } from "~/lib/app-error"
import { useCommands } from "~/lib/commands"
import { dateGroup, timeZoneFromCookie } from "~/lib/date-groups"
import {
	type FilterableView,
	filterSearch,
	filtersFor,
	INBOX_FILTERS,
	LIST_SORTS,
	type ListFilter,
	type ListSort,
	listSearch,
	parseFilter,
	parseSort,
} from "~/lib/inbox-filters"
import {
	LIBRARY_VIEWS,
	type LibraryView,
	viewFromPath,
	viewPath,
	viewSearchPath,
} from "~/lib/library-views"
import { splitLinks } from "~/lib/links"
import { setListLayout } from "~/lib/list-layout"
import { warmOffline } from "~/lib/offline.client"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { searchPath } from "~/lib/search-page"
import { requireUser } from "~/lib/session.server"
import { isSearchShortcut, SEARCH_HINT } from "~/lib/shortcuts"
import { showToast } from "~/lib/toast"
import { countTopicClick } from "~/lib/topic-use"
import { cn } from "~/lib/utils"
import { answer, refused } from "~/lib/web-action.server"
import {
	countFilters,
	countPending,
	decodeCursor,
	listDocuments,
	type TopicScope,
} from "~/services/documents.server"
import { offeredStarterTexts } from "~/services/starter-texts.server"
import { type ListTopics, listTopics, topicLabels, topicsInUse } from "~/services/topics.server"
import type { Route } from "./+types/library"

const VIEW_TITLES = {
	inbox: "common:nav.inbox",
	archive: "common:nav.archive",
	starred: "common:nav.starred",
	trash: "common:nav.trash",
} as const

export function meta({ matches, loaderData }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, VIEW_TITLES[loaderData?.view ?? "inbox"]) }]
}

export const handle: PageBarHandle = {
	pageBar: ({ pathname }) => ({
		titleKey: "common:nav.library",
		layoutToggle: true,
		search: {
			to: viewSearchPath(viewFromPath(pathname)),
			labelKey: "library:search.label",
		},
		// Nothing is saved into the trash.
		save: viewFromPath(pathname) !== "trash",
		select: true,
	}),
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	const view = viewFromPath(url.pathname)
	const cursor = decodeCursor(url.searchParams.get("cursor"))
	// Searches used to live here, and were never about one view.
	const q = url.searchParams.get("q")?.trim()
	if (q) throw redirect(`/search?q=${encodeURIComponent(q)}`)
	const filterable = view === "trash" ? null : view
	const filter = filterable ? parseFilter(url.searchParams.get("show"), filterable) : null
	// The archive and starred have one order: by when things got there, grouped by how long ago.
	const sort = view === "inbox" ? parseSort(url.searchParams.get("sort"), filter) : "newest"
	// A topic, or none (`?topic=`): one of the reader's topics in use. Any other shows every topic.
	const topics =
		filterable && (await topicsInUse(user.id))
			? await listTopics(user.id, filterable, filter)
			: null
	const asked = url.searchParams.get("topic")
	const topic: TopicScope | null =
		!topics || !asked
			? null
			: asked === "none" || topics.topics.some((t) => t.id === asked)
				? asked
				: null
	const [{ items, nextCursor }, pending, counts] = await Promise.all([
		listDocuments({ userId: user.id, view, filter, sort, cursor, topic }),
		countPending(user.id),
		filterable ? countFilters(user.id, filterable, topic) : null,
	])
	// Each card's topic, when the list is not one topic's already.
	const labels =
		topics && topic === null
			? await topicLabels(
					user.id,
					items.map((d) => d.id),
				)
			: {}
	const language = isLocale(user.locale) ? user.locale : fallbackLanguage
	const zone = timeZoneFromCookie(request.headers.get("cookie"))
	const now = new Date()
	const since = (d: (typeof items)[number]) =>
		view === "archive" ? d.archivedAt : view === "starred" ? d.starredAt : null
	const groups =
		view === "archive" || view === "starred"
			? items.map((d) => {
					const at = since(d)
					return at ? dateGroup(at, now, zone) : "today"
				})
			: null
	return {
		view,
		items,
		nextCursor,
		pending,
		filter,
		sort,
		counts,
		groups,
		topics,
		topic,
		// A topic asked for that is not one of the reader's now: it ended, or was never theirs.
		topicGone: !!topics && !!asked && topic === null,
		labels,
		// Nothing to read: something to start with instead.
		language,
		starter:
			view === "inbox" && !items.length && !cursor && !filter && !topic
				? await offeredStarterTexts(user.id, language)
				: null,
	}
}

export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const intent = form.get("intent")
	if (intent === "archive-read")
		return { ok: true as const, archived: (await archiveFinished(user.id)).archived }
	if (intent === "unarchive-many") {
		const ids = String(form.get("ids") ?? "")
			.split(",")
			.filter(Boolean)
		return answer(async () => ({ archived: [], moved: await undoArchive(user.id, ids) }))
	}
	const links = splitLinks(String(form.get("url") ?? ""))
	// Several links: each one's outcome, for the dialog to show.
	if (links.length > 1) {
		try {
			return { ok: true as const, batch: await saveLinks(user.id, links) }
		} catch (error) {
			// Too many: the dialog keeps what was typed, with the refusal.
			if (error instanceof AppError) return refused(error, { url: links.join("\n") })
			throw error
		}
	}
	const url = links[0] ?? ""
	// No redirect: the save dialog and a pasted link post here from any page (Home, the library, the
	// phone bar, the reader), and saving must leave the reader where they were. The page's data
	// reloads with the new article.
	try {
		const { article, created } = await saveArticle(user.id, { url, source: "web" })
		return { ok: true as const, saved: true as const, id: article.id, created }
	} catch (error) {
		if (error instanceof AppError) return refused(error, { url })
		throw error
	}
}

const VIEW_ICONS = {
	inbox: Inbox,
	archive: Archive,
	starred: Star,
	trash: Trash2,
} as const satisfies Record<LibraryView, typeof Inbox>

/** The library's views, one page: tabs where the sidebar used to list them. */
function ViewTabs({ view }: { view: LibraryView }) {
	const { t } = useTranslation("library")
	return (
		<nav
			aria-label={t("tabs.label")}
			className="-mx-4 flex gap-5 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] md:mx-0 md:mt-2 md:px-0"
		>
			{LIBRARY_VIEWS.map((v) => {
				const Icon = VIEW_ICONS[v]
				const name = t(`views.${v}`)
				// The trash, rarely opened, is an icon apart at the end: its name is for screen readers.
				const trash = v === "trash"
				return (
					<Link
						key={v}
						to={viewPath(v)}
						prefetch="intent"
						aria-current={v === view ? "page" : undefined}
						{...(trash ? { "aria-label": name, ...tooltip(name) } : {})}
						className={cn(
							"-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-2 text-sm",
							trash && "ml-auto px-1",
							v === view
								? "border-fg font-medium text-fg"
								: "border-transparent text-muted-fg hover:text-fg",
						)}
					>
						<Icon className="size-4" aria-hidden />
						{trash ? null : name}
					</Link>
				)
			})}
		</nav>
	)
}

const VIEW_DRAWINGS = {
	inbox: "bookcase",
	archive: "box",
	starred: "stickers",
	trash: "basket",
} as const satisfies Record<LibraryView, EmptyDrawingName>

export default function Library({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const navigate = useNavigate()
	const { filter, sort, topic } = loaderData
	const filterable = loaderData.view === "trash" ? null : loaderData.view
	useCommands(() => ({
		heading: t(`views.${loaderData.view}`),
		commands: [
			{ id: "layout-list", label: t("layout.list"), icon: List, run: () => setListLayout("list") },
			{
				id: "layout-grid",
				label: t("layout.grid"),
				icon: LayoutGrid,
				run: () => setListLayout("grid"),
			},
		],
	}))
	// Inbox and starred articles are kept readable offline (the archive and the trash are not).
	useEffect(() => {
		if (loaderData.view === "archive" || loaderData.view === "trash") return
		const ready = loaderData.items.filter((d) => d.status === "ready").map((d) => `/read/${d.id}`)
		// The inbox filter chips on screen, so switching between them works offline too.
		const counts = loaderData.counts
		const lists =
			counts && loaderData.view === "inbox"
				? [null, ...INBOX_FILTERS.filter((f) => (counts[f] ?? 0) > 0)]
						.map((f) => `/library${filterSearch(loaderData.filter, f, loaderData.sort, topic)}`)
						.filter((url) => url !== "/library")
				: []
		warmOffline(["/library", "/starred"], ready, lists)
	}, [
		loaderData.view,
		loaderData.items,
		loaderData.counts,
		loaderData.sort,
		loaderData.filter,
		topic,
	])

	const ids = useMemo(() => loaderData.items.map((d) => d.id), [loaderData.items])
	const { cursorId, listRef, onVanish, selection } = useListCursor(ids)
	// "/" searches this view
	const searchPath = viewSearchPath(loaderData.view)
	const from = location.pathname + location.search
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!isSearchShortcut(e)) return
			e.preventDefault()
			void navigate(searchPath, { state: { from } })
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [navigate, searchPath, from])

	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
			<div className="hidden min-h-10 flex-wrap items-center justify-between gap-3 md:flex">
				<h1 className="page-title">{t("heading")}</h1>
				<div className="flex items-center gap-2">
					{/* First, where the search page's field ends: the other buttons stay where they are. */}
					<SearchLink view={loaderData.view} label={t("search.label")} />
					<LayoutToggle />
					{loaderData.view === "trash" ? null : <SaveLinkButton />}
				</div>
			</div>
			<ViewTabs view={loaderData.view} />
			{loaderData.view === "trash" ? (
				<p className="mt-2 text-sm text-muted-fg md:mt-4">
					{t("trash.banner", { days: TRASH_RETENTION_DAYS })}
				</p>
			) : null}
			{filterable &&
			loaderData.counts &&
			(filter ||
				topic ||
				loaderData.topics?.topics.length ||
				Object.values(loaderData.counts).some((n) => (n ?? 0) > 0)) ? (
				<PinnedControls title={t(`views.${loaderData.view}`)}>
					<ListControls
						view={filterable}
						filter={filter}
						sort={sort}
						counts={loaderData.counts}
						topics={loaderData.topics}
						topic={topic}
					/>
				</PinnedControls>
			) : null}
			{filterable && loaderData.topics && topic ? (
				<TopicLine view={filterable} topics={loaderData.topics} topic={topic} />
			) : null}
			{loaderData.topicGone ? (
				<p data-testid="topic-gone" className="mt-2 text-sm text-muted-fg">
					{t("topicFilter.gone")}
				</p>
			) : null}
			{loaderData.items.length === 0 && (filter || topic) ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<FilterIcon className="size-10" aria-hidden />
					<h2 className="text-lg font-medium text-fg">{t("filters.empty")}</h2>
					{/* Each way out keeps the other choice: the filter, or the topic. */}
					<p className="flex flex-wrap justify-center gap-x-4 text-sm">
						{filter ? (
							<Link
								to={`${viewPath(loaderData.view)}${listSearch(null, sort, topic)}`}
								className="text-link hover:underline"
							>
								{t("filters.clear")}
							</Link>
						) : null}
						{topic ? (
							<Link
								to={`${viewPath(loaderData.view)}${listSearch(filter, sort)}`}
								className="text-link hover:underline"
							>
								{t("topicFilter.clear")}
							</Link>
						) : null}
					</p>
				</div>
			) : loaderData.items.length === 0 ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					{/* The place itself, empty, or for Starred the stars still unused. */}
					<EmptyDrawing name={VIEW_DRAWINGS[loaderData.view]} className="mb-1 w-40" />
					<h2 className="text-lg font-medium text-fg">
						{t(`empty.${loaderData.view}.title`, { days: TRASH_RETENTION_DAYS })}
					</h2>
					<p className="max-w-sm text-sm">
						{t(`empty.${loaderData.view}.description`, { days: TRASH_RETENTION_DAYS })}
					</p>
					{loaderData.starter ? (
						<StarterOffer
							offer={loaderData.starter}
							language={loaderData.language}
							className="mt-8 w-full max-w-xl"
						/>
					) : null}
				</div>
			) : (
				<DocumentList
					items={loaderData.items}
					groups={loaderData.groups}
					topics={loaderData.labels}
					listRef={listRef}
					cursorId={cursorId}
					onVanish={onVanish}
					selection={selection}
					keepsArchived={loaderData.view === "starred"}
				/>
			)}
			{loaderData.nextCursor ? (
				<div className="mt-6 flex justify-center">
					<Link
						to={`${viewPath(loaderData.view)}${nextPageSearch(filter, sort, loaderData.nextCursor, topic)}`}
						className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-hover"
					>
						{t("loadMore")}
					</Link>
				</div>
			) : null}
			<SelectionBar items={loaderData.items} selection={selection} />
		</main>
	)
}

function nextPageSearch(
	filter: ListFilter | null,
	sort: ListSort,
	cursor: string,
	topic: string | null,
) {
	const base = listSearch(filter, sort, topic)
	return `${base ? `${base}&` : "?"}cursor=${cursor}`
}

/**
 * Filter chips (with counts) for the inbox or the archive. The inbox also gets the sort menu, and
 * its "Read" chip offers to archive them all.
 */
function ListControls({
	view,
	filter,
	sort,
	counts,
	topics,
	topic,
}: {
	view: FilterableView
	filter: ListFilter | null
	sort: ListSort
	counts: Partial<Record<ListFilter, number>>
	/** The reader's topics, when the list can narrow to one. */
	topics: ListTopics | null
	topic: string | null
}) {
	const path = viewPath(view)
	const { t } = useTranslation("library")
	const navigate = useNavigate()
	const fetcher = useFetcher<{ archived: string[] }>()
	const archived = fetcher.data?.archived
	const navRef = useRef<HTMLElement>(null)
	// Follow the active chip
	useEffect(() => {
		navRef.current
			?.querySelector("[aria-current]")
			?.scrollIntoView({ inline: "nearest", block: "nearest" })
	}, [filter])
	useEffect(() => {
		if (!archived?.length) return
		showToast({
			message: t("filters.archivedRead", { count: archived.length }),
			undo: {
				action: "/library",
				intent: "unarchive-many",
				label: t("toast.undo"),
				fields: { ids: archived.join(",") },
			},
		})
	}, [archived, t])
	const chip = (f: ListFilter | null, count?: number) => (
		<Link
			key={f ?? "all"}
			to={`${path}${filterSearch(filter, f, sort, topic)}`}
			aria-current={f === filter ? "true" : undefined}
			className="flex shrink-0 items-center gap-1.5 chip aria-[current]:marked"
		>
			{t(`filters.${f ?? "all"}`)}
			{count ? <span className="tabular-nums">{count}</span> : null}
		</Link>
	)
	return (
		<div className="mt-1 mb-2 md:my-0">
			<div className="flex items-center gap-2">
				<nav
					ref={navRef}
					aria-label={t("filters.label")}
					className="-ml-4 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pr-8 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:ml-0 md:pl-0"
				>
					{topics ? (
						<>
							<TopicChoice view={view} filter={filter} sort={sort} topics={topics} topic={topic} />
							<span aria-hidden className="my-1 w-px shrink-0 self-stretch bg-border" />
						</>
					) : null}
					{chip(null)}
					{filtersFor(view)
						.filter((f) => (counts[f] ?? 0) > 0 || f === filter)
						.map((f) => chip(f, counts[f]))}
				</nav>
				{view === "inbox" ? (
					<MoreMenu
						label={`${t("sort.label")}: ${t(`sort.${sort}`)}`}
						icon={<ArrowDownUp className="size-4" aria-hidden />}
						className="shrink-0 p-2"
					>
						{LIST_SORTS.map((s) => (
							<MenuButton
								key={s}
								icon={<Check className={cn("size-4", s !== sort && "invisible")} aria-hidden />}
								onClick={() => void navigate(`/library${listSearch(filter, s, topic)}`)}
							>
								{t(`sort.${s}`)}
							</MenuButton>
						))}
					</MoreMenu>
				) : null}
				{/* Always here, never a badge: Home's card for it is only an occasional reminder. */}
				{view === "inbox" ? (
					<Link
						to="/library/review"
						aria-label={t("review.open")}
						{...tooltip(t("review.open"))}
						className="shrink-0 rounded-md p-2 text-muted-fg hover:bg-hover hover:text-fg"
					>
						<History className="size-4" aria-hidden />
					</Link>
				) : null}
			</div>
			{/* It archives every read article, not only the topic's. */}
			{view === "inbox" && filter === "read" && !topic && (counts.read ?? 0) > 0 ? (
				<fetcher.Form method="post" action="/library" className="mt-2 flex justify-end">
					<input type="hidden" name="intent" value="archive-read" />
					<button
						type="submit"
						disabled={fetcher.state !== "idle"}
						className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
					>
						<Archive className="size-4" aria-hidden />
						{t("filters.archiveRead")}
					</button>
				</fetcher.Form>
			) : null}
		</div>
	)
}

const CHIP = "flex shrink-0 items-center gap-1.5 chip"
const CHIP_ON = "marked"

/**
 * The topic the list shows, first in the row: a menu of the reader's topics, with how many of the
 * list's articles each holds (those with none last), and No topic. Chosen, it names the topic, and
 * its × shows every topic again. The filters keep to the topic.
 */
function TopicChoice({
	view,
	filter,
	sort,
	topics,
	topic,
}: {
	view: FilterableView
	filter: ListFilter | null
	sort: ListSort
	topics: ListTopics
	topic: string | null
}) {
	const { t } = useTranslation("library")
	const path = viewPath(view)
	const chosen =
		topic === "none" ? t("topicFilter.none") : topics.topics.find((x) => x.id === topic)?.name
	const to = (id: string | null) => `${path}${listSearch(filter, sort, id)}`
	const row = (id: string, name: string, count: number) => (
		<MenuNavLink
			key={id}
			to={to(id)}
			current={id === topic}
			onChoose={id === topic ? undefined : () => countTopicClick("topic_filter_library")}
		>
			<span className={cn("min-w-0 flex-1 truncate", count === 0 && "text-muted-fg")}>{name}</span>
			<span className="shrink-0 text-xs text-muted-fg tabular-nums">{count}</span>
		</MenuNavLink>
	)
	return (
		<span data-testid="topic-choice" className="flex shrink-0 items-center">
			<MoreMenu
				label={chosen ? t("topicFilter.chosen", { topic: chosen }) : t("topicFilter.choose")}
				align="start"
				className={cn(CHIP, chosen && CHIP_ON, chosen && "rounded-r-none! pr-2")}
				icon={
					<>
						<span className="max-w-48 truncate">{chosen ?? t("topicFilter.label")}</span>
						<ChevronDown className="size-3.5 shrink-0" aria-hidden />
					</>
				}
			>
				{/* A library can hold a hundred topics: the list scrolls. */}
				<div className="flex max-h-80 w-64 max-w-[80vw] flex-col overflow-y-auto">
					{topics.topics.map((x) => row(x.id, x.name, x.count))}
				</div>
				<div className="mt-1 border-t border-border pt-1">
					{row("none", t("topicFilter.none"), topics.none)}
				</div>
			</MoreMenu>
			{chosen ? (
				<Link
					to={to(null)}
					aria-label={t("topicFilter.clear")}
					{...tooltip(t("topicFilter.clear"))}
					className={cn(CHIP, CHIP_ON, "self-stretch rounded-l-none! px-2")}
				>
					<X className="size-3.5" aria-hidden />
				</Link>
			) : null}
		</span>
	)
}

/** What the chosen topic holds, and where else to look at it: the search, and its own page. */
function TopicLine({
	view,
	topics,
	topic,
}: {
	view: FilterableView
	topics: ListTopics
	topic: string
}) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const chosen = topics.topics.find((x) => x.id === topic)
	const scope = view === "archive" ? "in:archive" : view === "starred" ? "is:starred" : "in:library"
	const query = `${chosen ? addOperator("", "topic", chosen.name) : "-has:topic"} ${scope}`
	return (
		<div data-testid="topic-line" className="mt-2 flex flex-col gap-1 text-sm md:mt-3">
			<p className="max-w-3xl text-muted-fg">
				{chosen ? chosen.description : t("topicFilter.noneDescription")}
				{!chosen && topics.sorting > 0
					? ` ${t("topicFilter.sorting", { count: topics.sorting })}`
					: null}
			</p>
			<p className="flex flex-wrap gap-x-4">
				<Link
					to={searchPath(query)}
					state={{ from: location.pathname + location.search }}
					onClick={() => countTopicClick("topic_filter_search")}
					className="text-link hover:underline"
				>
					{t("topicFilter.search")}
				</Link>
				{chosen ? (
					<Link
						to={`/topics/${chosen.id}`}
						onClick={() => countTopicClick("topic_opened")}
						className="text-link hover:underline"
					>
						{t("topicFilter.page", { topic: chosen.name })}
					</Link>
				) : null}
			</p>
		</div>
	)
}

/** Searching happens on its own page, which opens looking where this view looks. */
function SearchLink({ view, label }: { view: LibraryView; label: string }) {
	const location = useLocation()
	return (
		<Link
			to={viewSearchPath(view)}
			state={{ from: location.pathname + location.search }}
			aria-label={label}
			{...tooltip(label, SEARCH_HINT)}
			className="rounded-md p-2.5 text-muted-fg hover:bg-hover hover:text-fg"
		>
			<Search className="size-5" aria-hidden />
		</Link>
	)
}
