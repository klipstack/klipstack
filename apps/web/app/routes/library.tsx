// The subpath is client-safe (constants only); the package root pulls in pg-boss.
import { TRASH_RETENTION_DAYS } from "@klipstack/api-contract/names"
import {
	Archive,
	ArrowDownUp,
	Check,
	History,
	ListFilter as FilterIcon,
	LibraryBig,
	LayoutGrid,
	List,
	Search,
} from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, redirect, useFetcher, useLocation, useNavigate } from "react-router"
import { archiveFinished, undoArchive } from "~/commands/articles.server"
import { saveArticle } from "~/commands/saving.server"
import { DocumentList } from "~/components/document-list"
import { LayoutToggle } from "~/components/layout-toggle"
import { MenuButton, MenuNavLink, MoreMenu } from "~/components/more-menu"
import { PinnedControls } from "~/components/pinned-controls"
import { SaveLinkDialog } from "~/components/save-link-dialog"
import { SelectionBar } from "~/components/selection-bar"
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
import { type LibraryView, viewFromPath, viewPath, viewSearchPath } from "~/lib/library-views"
import { setListLayout } from "~/lib/list-layout"
import { warmOffline } from "~/lib/offline.client"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { isSearchShortcut, SEARCH_HINT } from "~/lib/shortcuts"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import { answer, refused } from "~/lib/web-action.server"
import {
	countFilters,
	countPending,
	decodeCursor,
	listDocuments,
} from "~/services/documents.server"
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
		titleKey: `common:nav.${viewFromPath(pathname)}`,
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
	const [{ items, nextCursor }, pending, counts] = await Promise.all([
		listDocuments({ userId: user.id, view, filter, sort, cursor }),
		countPending(user.id),
		filterable ? countFilters(user.id, filterable) : null,
	])
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
	return { view, items, nextCursor, pending, filter, sort, counts, groups }
}

export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const intent = form.get("intent")
	if (intent === "archive-read")
		return { ok: true as const, archived: await archiveFinished(user.id) }
	if (intent === "unarchive-many") {
		const ids = String(form.get("ids") ?? "")
			.split(",")
			.filter(Boolean)
		return answer(async () => ({ archived: [], moved: await undoArchive(user.id, ids) }))
	}
	const url = String(form.get("url") ?? "").trim()
	// No redirect: the save dialog posts here from any page (Home, the library, the phone bar), and
	// saving must leave the reader where they were. The page's data reloads with the new article.
	try {
		await saveArticle(user.id, { url, source: "web" })
		return { ok: true as const, saved: true as const }
	} catch (error) {
		if (error instanceof AppError) return refused(error, { url })
		throw error
	}
}

export default function Library({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const navigate = useNavigate()
	const { filter, sort } = loaderData
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
						.map((f) => `/library${filterSearch(loaderData.filter, f, loaderData.sort)}`)
						.filter((url) => url !== "/library")
				: []
		warmOffline(["/library", "/starred"], ready, lists)
	}, [loaderData.view, loaderData.items, loaderData.counts, loaderData.sort, loaderData.filter])

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
				<h1 className="text-2xl font-semibold">{t(`views.${loaderData.view}`)}</h1>
				<div className="flex items-center gap-2">
					{/* First, where the search page's field ends: the other buttons stay where they are. */}
					<SearchLink view={loaderData.view} label={t("search.label")} />
					<LayoutToggle />
					{loaderData.view === "trash" ? null : <SaveLinkDialog />}
				</div>
			</div>
			{loaderData.view === "trash" ? (
				<p className="mt-2 text-sm text-muted-fg md:mt-4">
					{t("trash.banner", { days: TRASH_RETENTION_DAYS })}
				</p>
			) : null}
			{filterable &&
			loaderData.counts &&
			(filter || Object.values(loaderData.counts).some((n) => (n ?? 0) > 0)) ? (
				<PinnedControls title={t(`views.${loaderData.view}`)}>
					<ListControls view={filterable} filter={filter} sort={sort} counts={loaderData.counts} />
				</PinnedControls>
			) : null}
			{loaderData.items.length === 0 && filter ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<FilterIcon className="size-10" aria-hidden />
					<h2 className="text-lg font-medium text-fg">{t("filters.empty")}</h2>
					<Link
						to={`${viewPath(loaderData.view)}${listSearch(null, sort)}`}
						className="text-sm text-link hover:underline"
					>
						{t("filters.clear")}
					</Link>
				</div>
			) : loaderData.items.length === 0 ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<LibraryBig className="size-10" aria-hidden />
					<h2 className="text-lg font-medium text-fg">
						{t(`empty.${loaderData.view}.title`, { days: TRASH_RETENTION_DAYS })}
					</h2>
					<p className="max-w-sm text-sm">
						{t(`empty.${loaderData.view}.description`, { days: TRASH_RETENTION_DAYS })}
					</p>
				</div>
			) : (
				<DocumentList
					items={loaderData.items}
					groups={loaderData.groups}
					listRef={listRef}
					cursorId={cursorId}
					onVanish={onVanish}
					selection={selection}
				/>
			)}
			{loaderData.nextCursor ? (
				<div className="mt-6 flex justify-center">
					<Link
						to={`${viewPath(loaderData.view)}${nextPageSearch(filter, sort, loaderData.nextCursor)}`}
						className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
					>
						{t("loadMore")}
					</Link>
				</div>
			) : null}
			<SelectionBar items={loaderData.items} selection={selection} />
		</main>
	)
}

function nextPageSearch(filter: ListFilter | null, sort: ListSort, cursor: string) {
	const base = listSearch(filter, sort)
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
}: {
	view: FilterableView
	filter: ListFilter | null
	sort: ListSort
	counts: Partial<Record<ListFilter, number>>
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
			to={`${path}${filterSearch(filter, f, sort)}`}
			aria-current={f === filter ? "true" : undefined}
			className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg"
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
								onClick={() => void navigate(`/library${listSearch(filter, s)}`)}
							>
								{t(`sort.${s}`)}
							</MenuButton>
						))}
					</MoreMenu>
				) : null}
				{/* Always here, never a badge: Home's card for it is only an occasional reminder. */}
				{view === "inbox" ? (
					<MoreMenu label={t("review.libraryMenu")} className="shrink-0 p-2">
						<MenuNavLink to="/library/review" icon={<History className="size-4" aria-hidden />}>
							{t("review.open")}
						</MenuNavLink>
					</MoreMenu>
				) : null}
			</div>
			{view === "inbox" && filter === "read" && (counts.read ?? 0) > 0 ? (
				<fetcher.Form method="post" action="/library" className="mt-2 flex justify-end">
					<input type="hidden" name="intent" value="archive-read" />
					<button
						type="submit"
						disabled={fetcher.state !== "idle"}
						className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
					>
						<Archive className="size-4" aria-hidden />
						{t("filters.archiveRead")}
					</button>
				</fetcher.Form>
			) : null}
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
			className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
		>
			<Search className="size-5" aria-hidden />
		</Link>
	)
}
