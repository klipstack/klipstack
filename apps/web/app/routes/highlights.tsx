import { Highlighter, ListFilter, Newspaper, Rows3, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, type FetcherWithComponents, Link, useFetcher } from "react-router"
import { NoteText } from "~/components/note-text"
import { PinnedControls } from "~/components/pinned-controls"
import { SearchField } from "~/components/search-field"
import { tooltip } from "~/components/tooltip-host"
import { HIGHLIGHT_SWATCH } from "~/lib/highlight-colors"
import {
	DEFAULT_HIGHLIGHT_VIEW,
	HIGHLIGHT_VIEW_COOKIE,
	HIGHLIGHT_VIEWS,
	type HighlightFilter,
	type HighlightView,
	highlightsSearch,
	highlightViewFromCookie,
	parseHighlightFilter,
	parseHighlightView,
} from "~/lib/highlight-filters"
import type { PageBarHandle } from "~/lib/page-bar"
import { cursorFields, isCursorTime, isUuid } from "~/lib/page-cursor"
import { pageTitle } from "~/lib/page-title"
import { requireUser } from "~/lib/session.server"
import { LONG_UNDO_MS, showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import {
	countHighlightFilters,
	type HighlightArticle,
	type HighlightListItem,
	listHighlightArticles,
	listUserHighlights,
} from "~/services/highlights.server"
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

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	const q = url.searchParams.get("q")?.trim() ?? ""
	const filter = parseHighlightFilter(url.searchParams.get("show"))
	const asked = parseHighlightView(url.searchParams.get("view"))
	const saved = highlightViewFromCookie(request.headers.get("cookie"))
	const view = asked ?? saved ?? DEFAULT_HIGHLIGHT_VIEW
	// A view in the URL is a choice: remember it on this device.
	const headers: HeadersInit =
		asked && asked !== saved
			? {
					"Set-Cookie": `${HIGHLIGHT_VIEW_COOKIE}=${asked}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
				}
			: {}
	const counts = await countHighlightFilters(user.id, q)
	if (view === "articles") {
		const articles = await listHighlightArticles({ userId: user.id, q, filter })
		return data({ view, q, filter, counts, items: [], articles, nextCursor: null }, { headers })
	}
	const cursor = decodeCursor(url.searchParams.get("cursor"))
	const { items, nextCursor } = await listUserHighlights({ userId: user.id, cursor, q, filter })
	return data(
		{
			view,
			q,
			filter,
			counts,
			items,
			articles: [] as HighlightArticle[],
			nextCursor: nextCursor ? Buffer.from(JSON.stringify(nextCursor)).toString("base64url") : null,
		},
		{ headers },
	)
}

export default function Highlights({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("reader")
	const { t: tc } = useTranslation()
	const { t: tl } = useTranslation("library")
	const fetcher = useFetcher()
	const { q, filter, view, counts } = loaderData
	const empty =
		view === "articles" ? loaderData.articles.length === 0 : loaderData.items.length === 0
	const anyHighlights = q || filter || !empty

	return (
		<main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-3 pb-6 md:pt-4 md:pb-8">
			<div className="hidden min-h-10 flex-wrap items-center justify-between gap-3 md:flex">
				<h1 className="text-2xl font-semibold">
					{q ? t("highlights.search.results", { q }) : tc("nav.highlights")}
				</h1>
				<div className="flex items-center gap-2">
					<SearchField
						action="/highlights"
						value={q}
						clearTo={`/highlights${highlightsSearch({ filter, view, q: "" })}`}
						keep={{ ...(filter ? { show: filter } : {}), view }}
						placeholder={t("highlights.search.placeholder")}
						label={t("highlights.search.label")}
						clearLabel={t("highlights.search.clear")}
					/>
				</div>
			</div>
			{anyHighlights ? (
				<PinnedControls title={q ? t("highlights.search.results", { q }) : tc("nav.highlights")}>
					<Controls filter={filter} view={view} q={q} counts={counts} />
				</PinnedControls>
			) : null}
			{empty ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					{filter ? (
						<ListFilter className="size-10" aria-hidden />
					) : (
						<Highlighter className="size-10" aria-hidden />
					)}
					<h2 className="text-lg font-medium text-fg">
						{q
							? t("highlights.search.empty")
							: filter
								? t("highlights.filters.empty")
								: t("highlights.pageEmpty.title")}
					</h2>
					{q || filter ? null : (
						<p className="max-w-sm text-sm">{t("highlights.pageEmpty.description")}</p>
					)}
				</div>
			) : view === "articles" ? (
				<div className="flex flex-col gap-8 md:mt-2">
					{loaderData.articles.map((article) => (
						<ArticleGroup key={article.documentId} article={article} fetcher={fetcher} />
					))}
				</div>
			) : (
				<>
					<ul className="flex flex-col gap-2 md:mt-2">
						{loaderData.items.map((h) => (
							<HighlightCard key={h.id} h={h} fetcher={fetcher} withArticle />
						))}
					</ul>
					{loaderData.nextCursor ? (
						<div className="mt-6 flex justify-center">
							<Link
								to={`/highlights${highlightsSearch({ filter, view, q }) || "?"}${
									highlightsSearch({ filter, view, q }) ? "&" : ""
								}cursor=${loaderData.nextCursor}`}
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

/** Filter chips (with counts; empty ones hide unless selected) and the stream / by article switch. */
function Controls({
	filter,
	view,
	q,
	counts,
}: {
	filter: HighlightFilter | null
	view: HighlightView
	q: string
	counts: Record<HighlightFilter, number>
}) {
	const { t } = useTranslation("reader")
	const chip = (f: HighlightFilter | null) => {
		const count = f ? counts[f] : 0
		return (
			<Link
				key={f ?? "all"}
				to={`/highlights${highlightsSearch({ filter: f, view, q })}`}
				aria-current={f === filter ? "true" : undefined}
				className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg"
			>
				{f === null ? t("highlights.filters.all") : t("highlights.filters.notes")}
				{count ? <span className="tabular-nums">{count}</span> : null}
			</Link>
		)
	}
	return (
		<div className="mt-1 mb-3 flex items-center gap-2 md:my-0">
			<nav
				aria-label={t("highlights.filters.label")}
				className="-ml-4 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pr-8 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:ml-0 md:pl-0"
			>
				{chip(null)}
				{filter === "notes" || counts.notes > 0 ? chip("notes") : null}
			</nav>
			<fieldset
				aria-label={t("highlights.views.label")}
				className="flex shrink-0 rounded-lg border border-border p-0.5"
			>
				{HIGHLIGHT_VIEWS.map((v) => {
					const label = t(`highlights.views.${v}`)
					return (
						<Link
							key={v}
							to={`/highlights${highlightsSearch({ filter, view: v, q })}`}
							aria-label={label}
							aria-current={v === view ? "true" : undefined}
							{...tooltip(label)}
							className="rounded-md p-1.5 text-muted-fg hover:text-fg aria-[current]:bg-selected aria-[current]:text-selected-fg"
						>
							{v === "stream" ? (
								<Rows3 className="size-4" aria-hidden />
							) : (
								<Newspaper className="size-4" aria-hidden />
							)}
						</Link>
					)
				})}
			</fieldset>
		</div>
	)
}

/** Long articles show their first few highlights until opened up. */
const COLLAPSED = 3

function ArticleGroup({
	article,
	fetcher,
}: {
	article: HighlightArticle
	fetcher: FetcherWithComponents<unknown>
}) {
	const { t } = useTranslation("reader")
	const [open, setOpen] = useState(false)
	const count = article.highlights.length
	const shown = open ? article.highlights : article.highlights.slice(0, COLLAPSED)
	return (
		<section>
			<div className="mb-3">
				<h2 className="text-base font-medium leading-snug">
					<Link to={`/read/${article.documentId}`} className="hover:underline">
						{article.documentTitle ?? article.sourceUrl}
					</Link>
				</h2>
				<p className="text-sm text-muted-fg">
					{[article.siteName, article.author, t("highlights.article.count", { count })]
						.filter(Boolean)
						.join(" · ")}
				</p>
			</div>
			<ul className="flex flex-col gap-2">
				{shown.map((h) => (
					<HighlightCard key={h.id} h={h} fetcher={fetcher} />
				))}
			</ul>
			{count > COLLAPSED ? (
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="mt-2 rounded-md px-2 py-1 text-sm text-link hover:bg-muted"
				>
					{open ? t("highlights.article.showLess") : t("highlights.article.showAll", { count })}
				</button>
			) : null}
		</section>
	)
}

/** One highlight; the whole card opens it in the reader. `withArticle` adds the source line. */
function HighlightCard({
	h,
	fetcher,
	withArticle = false,
}: {
	h: HighlightListItem
	fetcher: FetcherWithComponents<unknown>
	withArticle?: boolean
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const deleting = fetcher.formData?.get("id") === h.id
	return (
		<li
			className={cn(
				"group relative isolate flex gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-muted-fg/40",
				deleting && "opacity-40",
			)}
		>
			<span className={cn("mt-1 h-auto w-1 shrink-0 rounded", HIGHLIGHT_SWATCH)} aria-hidden />
			<div className="min-w-0 flex-1">
				<Link
					to={`/read/${h.documentId}#h=${h.id}`}
					className="block text-[0.95rem] leading-relaxed after:absolute after:inset-0 after:content-['']"
				>
					{h.exact}
				</Link>
				{h.note ? (
					<p className="mt-2 text-sm text-muted-fg">
						<NoteText text={h.note} />
					</p>
				) : null}
				{h.orphaned ? <p className="mt-1 text-xs text-danger">{t("highlights.orphaned")}</p> : null}
				{withArticle ? (
					<p className="mt-2 line-clamp-1 text-xs text-muted-fg">
						<Link
							to={`/read/${h.documentId}`}
							className="relative z-10 hover:text-fg hover:underline"
						>
							{h.documentTitle ?? h.sourceUrl}
						</Link>
						{h.siteName ? ` · ${h.siteName}` : null}
					</p>
				) : null}
			</div>
			<fetcher.Form
				method="post"
				action={`/documents/${h.documentId}/highlights`}
				className="relative z-10"
				onSubmit={() =>
					showToast({
						message: t(h.note ? "highlights.toast.removedWithNote" : "highlights.toast.removed"),
						ms: h.note ? LONG_UNDO_MS : undefined,
						undo: {
							action: `/documents/${h.documentId}/highlights`,
							intent: "restore",
							fields: { id: h.id },
							label: tl("toast.undo"),
						},
					})
				}
			>
				<input type="hidden" name="intent" value="delete" />
				<input type="hidden" name="id" value={h.id} />
				<button
					type="submit"
					className="rounded-md p-1.5 text-muted-fg opacity-100 hover:bg-muted hover:text-fg md:opacity-0 md:group-hover:opacity-100"
					aria-label={t("highlights.popover.delete")}
					{...tooltip(t("highlights.popover.delete"))}
				>
					<Trash2 className="size-4" aria-hidden />
				</button>
			</fetcher.Form>
		</li>
	)
}
