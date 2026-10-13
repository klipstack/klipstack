import {
	addOperator,
	canSaveSearch,
	parseSearchQuery,
	removeOperator,
	findsEverything,
	renameTopicOperator,
	type SearchKey,
	type Token,
	textOnly,
} from "@klipstack/api-contract/search-query"
import { Bookmark, BookmarkCheck, ChevronDown, CircleAlert, SearchX, X } from "lucide-react"
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	Link,
	useFetcher,
	useLoaderData,
	useLocation,
	useNavigate,
	useRouteLoaderData,
} from "react-router"
import { DocumentList } from "~/components/document-list"
import { LayoutToggle } from "~/components/layout-toggle"
import { MenuNavLink, MoreMenu } from "~/components/more-menu"
import { PinnedControls } from "~/components/pinned-controls"
import { PostIt } from "~/components/post-it"
import { SaveLinkDialog } from "~/components/save-link-dialog"
import {
	SavedSearchDialog,
	type SavedSearchItem,
	SavedSearchMenuItems,
} from "~/components/saved-search-dialog"
import { SearchField } from "~/components/search-field"
import { SelectButton } from "~/components/select-button"
import { SelectionBar } from "~/components/selection-bar"
import { useListCursor } from "~/hooks/use-list-cursor"
import { useCommands } from "~/lib/commands"
import { timeZoneFromCookie } from "~/lib/date-groups"
import { HIGHLIGHT_SWATCH, highlightColor } from "~/lib/highlight-colors"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { awaitsWords, searchOrigin, searchPath } from "~/lib/search-page"
import type { Snippet } from "~/lib/search-snippet"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { countTopicClick, countTopicSearch } from "~/lib/topic-use"
import { cn } from "~/lib/utils"
import {
	ANNOTATION_GROUP_LIMIT,
	ANNOTATION_GROUP_MAX,
	type Group,
	type HighlightHit,
	type NoteHit,
	searchHighlights,
	searchNotes,
} from "~/services/annotation-search.server"
import { keepsArchived, SEARCH_LIMIT, searchDocuments } from "~/services/search.server"
import { missingTopics, topicNames, topicsInUse } from "~/services/topics.server"
import type { Route } from "./+types/search"
import type { loader as layoutLoader } from "./app-layout"

export function meta({ loaderData, matches }: Route.MetaArgs) {
	const q = loaderData?.q.trim()
	const title = pageTitle(matches, "common:nav.search")
	return [{ title: q ? `${q} · ${title}` : title }]
}

const FIELD = {
	action: "/search",
	clearTo: "/search",
	placeholderKey: "library:search.placeholder",
	labelKey: "library:search.label",
	clearKey: "library:search.clear",
} as const

/** On phones the top bar is the search field. */
export const handle: PageBarHandle = {
	pageBar: { titleKey: "library:search.title", search: { ...FIELD, always: true } },
}

type ResultGroup = "highlights" | "notes"

/** More topics than a library holds: the chip lists them all. */
const TOPICS_LISTED = 500

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const url = new URL(request.url)
	// As typed: a query that ends with a space awaits its words, and the field takes the keyboard.
	const q = url.searchParams.get("q") ?? ""
	const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1))
	const timeZone = timeZoneFromCookie(request.headers.get("cookie"))
	// `all=highlights` or `all=notes` shows all of that group, not its first few.
	const all = url.searchParams.get("all")
	const limit = (group: ResultGroup) =>
		all === group ? ANNOTATION_GROUP_MAX : ANNOTATION_GROUP_LIMIT
	// Highlights and notes come with the first page of articles.
	const none = { items: [], total: 0 }
	const [result, [missing = []], highlights, notes] = await Promise.all([
		searchDocuments({ userId: user.id, q, offset: (page - 1) * SEARCH_LIMIT, timeZone }),
		missingTopics(user.id, [q.trim()]),
		page === 1
			? searchHighlights({ userId: user.id, q, timeZone, limit: limit("highlights") })
			: none,
		page === 1 ? searchNotes({ userId: user.id, q, timeZone, limit: limit("notes") }) : none,
	])
	// The Topic chip's names, most articles first, for a reader whose topics are in use.
	const topics = (await topicsInUse(user.id)) ? await topicNames(user.id, "", TOPICS_LISTED) : null
	return {
		q,
		items: result.items,
		nextPage: result.nextOffset === null ? null : page + 1,
		ignored: result.ignored,
		trash: result.trash,
		highlights: highlights as Group<HighlightHit>,
		notes: notes as Group<NoteHit>,
		/** The group shown in full (`all=`), and how many that is at most. */
		expanded: all === "highlights" || all === "notes" ? (all as ResultGroup) : null,
		groupMax: ANNOTATION_GROUP_MAX,
		keepsArchived: keepsArchived(q),
		/** Topics the query names that the reader no longer has. */
		missing,
		topics,
	}
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const { q, items, ignored, trash, highlights, notes } = loaderData
	const query = q.trim()
	const grouped = highlights.total > 0 || notes.total > 0
	const words = textOnly(query)
	const cards = useMemo(() => [...items, ...(trash?.items ?? [])], [items, trash?.items])
	const ids = useMemo(() => cards.map((d) => d.id), [cards])
	// "Select all" keeps the trash apart: nothing acts on both.
	const sections = useMemo(
		() => [items.map((d) => d.id), (trash?.items ?? []).map((d) => d.id)],
		[items, trash?.items],
	)
	const { cursorId, listRef, onVanish, selection } = useListCursor(ids, sections)
	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
			<h1 className="sr-only">{t("search.title")}</h1>
			<div className="hidden min-h-10 items-center gap-2 md:flex">
				<SearchField
					// A chip or a link changed the query: the field shows the new one.
					key={q}
					{...FIELD}
					value={q}
					escapeTo={searchOrigin(location.state)}
					placeholder={t("search.placeholder")}
					label={t("search.label")}
					clearLabel={t("search.clear")}
					autoFocus={awaitsWords(q)}
					slashFocus
					operators
					onSearch={countTopicSearch}
					className="min-w-0 flex-1"
					inputClassName="w-full focus:w-full sm:w-full sm:focus:w-full"
				/>
				<LayoutToggle />
				<SaveLinkDialog />
			</div>
			<PinnedControls title={t("search.title")}>
				<div className="flex items-center gap-2">
					<Chips q={query} topics={loaderData.topics} />
					<SaveSearch q={query} />
					{/* Phones: the top bar is the search field, so Select is here. */}
					{cards.length > 0 ? <SelectButton className="md:hidden" /> : null}
				</div>
			</PinnedControls>
			{loaderData.missing.map((name) => (
				<MissingTopic key={name} q={query} name={name} />
			))}
			{ignored.length > 0 ? (
				<p data-testid="search-ignored" className="mt-3 text-sm text-muted-fg">
					{t("search.ignored", { tokens: ignored.join(" ") })}{" "}
					<Link to="/search" state={location.state} className="text-link hover:underline">
						{t("search.tips")}
					</Link>
				</p>
			) : null}
			{grouped ? <GroupLinks highlights={highlights.total} notes={notes.total} /> : null}
			{query === "" ? (
				<Tips />
			) : items.length === 0 && grouped ? null : items.length === 0 ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<SearchX className="size-10" aria-hidden />
					<h2 className="text-lg font-medium text-fg">{t("search.empty")}</h2>
					{words && words !== query ? (
						<Link
							to={searchPath(words)}
							state={location.state}
							className="text-sm text-link hover:underline"
						>
							{t("search.everywhere")}
						</Link>
					) : null}
				</div>
			) : (
				<>
					{grouped ? (
						<GroupHeading id="search-articles" label={t("search.groups.articles")} />
					) : null}
					<DocumentList
						items={items}
						listRef={listRef}
						cursorId={cursorId}
						onVanish={onVanish}
						selection={selection}
						keepsArchived={loaderData.keepsArchived}
					/>
				</>
			)}
			{loaderData.nextPage ? (
				<div className="mt-6 flex justify-center">
					<Link
						to={`${searchPath(query)}&page=${loaderData.nextPage}`}
						state={location.state}
						className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
					>
						{t("loadMore")}
					</Link>
				</div>
			) : null}
			{highlights.total > 0 ? <HighlightGroup group={highlights} q={q} /> : null}
			{notes.total > 0 ? <NoteGroup group={notes} q={q} /> : null}
			{trash ? (
				<section
					data-testid="search-trash"
					aria-labelledby="search-trash-heading"
					className="mt-10"
				>
					<div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
						<h2 id="search-trash-heading" className="text-sm font-medium text-muted-fg">
							{t("search.trash.heading")}
						</h2>
						{trash.total > trash.items.length ? (
							<Link
								to={searchPath(addOperator(query, "in", "trash"))}
								state={location.state}
								className="text-sm text-link hover:underline"
							>
								{t("search.trash.all", { count: trash.total })}
							</Link>
						) : null}
					</div>
					<DocumentList
						items={trash.items}
						cursorId={cursorId}
						onVanish={onVanish}
						selection={selection}
					/>
				</section>
			) : null}
			<SelectionBar items={cards} selection={selection} />
		</main>
	)
}

/** Where the other groups are, under a long list of articles. */
function GroupLinks({ highlights, notes }: { highlights: number; notes: number }) {
	const { t } = useTranslation("library")
	const link = "rounded-full border border-border px-3 py-1 hover:bg-muted"
	return (
		<nav
			aria-label={t("search.groups.label")}
			data-testid="search-groups"
			className="mt-3 flex flex-wrap gap-2 text-sm"
		>
			{highlights > 0 ? (
				<a href="#search-highlights" className={link}>
					{t("search.groups.highlightsCount", { count: highlights })}
				</a>
			) : null}
			{notes > 0 ? (
				<a href="#search-notes" className={link}>
					{t("search.groups.notesCount", { count: notes })}
				</a>
			) : null}
		</nav>
	)
}

function GroupHeading({ id, label, more }: { id: string; label: string; more?: ReactNode }) {
	return (
		<div className="mt-6 mb-3 flex items-baseline justify-between gap-3 border-b border-border pb-2">
			<h2 id={id} className="scroll-mt-20 text-sm font-medium text-muted-fg">
				{label}
			</h2>
			{more}
		</div>
	)
}

/** A snippet with the words the search found in bold. */
/** A snippet's text, for the size of its paper. */
const snippetText = (runs: Snippet) => runs.map((run) => run.text).join("")

function Marked({ runs }: { runs: Snippet }) {
	let at = 0
	return runs.map((run) => {
		// Where the run starts in the snippet: unique, and stable for the same snippet.
		const key = at
		at += run.text.length
		return run.match ? (
			<mark key={key} className="bg-transparent font-semibold text-fg">
				{run.text}
			</mark>
		) : (
			<Fragment key={key}>{run.text}</Fragment>
		)
	})
}

/** "Show all", while the group shows only its first few. */
function ShowAll({
	q,
	group,
	shown,
	total,
}: {
	q: string
	group: ResultGroup
	shown: number
	total: number
}) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const { expanded, groupMax } = useLoaderData<typeof loader>()
	if (shown >= total) return null
	// Shown in full already, up to the most a group shows.
	if (expanded === group)
		return (
			<span className="text-sm text-muted-fg">
				{t("search.groups.shownOf", { shown, count: total })}
			</span>
		)
	return (
		<Link
			to={`${searchPath(q)}&all=${group}#search-${group}`}
			state={location.state}
			className="text-sm text-link hover:underline"
		>
			{total > groupMax
				? t("search.groups.showFirst", { count: groupMax })
				: t("search.groups.showAll", { count: total })}
		</Link>
	)
}

const RESULT_CARD =
	"relative isolate flex gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-muted-fg/40"

function HighlightGroup({ group, q }: { group: Group<HighlightHit>; q: string }) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const from = location.pathname + location.search
	return (
		<section data-testid="search-highlights" aria-labelledby="search-highlights">
			<GroupHeading
				id="search-highlights"
				label={t("search.groups.highlights")}
				more={<ShowAll q={q} group="highlights" shown={group.items.length} total={group.total} />}
			/>
			<ul className="flex flex-col gap-2">
				{group.items.map((h) => (
					<li key={h.id} {...highlightColor(h.color)} className={RESULT_CARD}>
						<span
							data-testid="highlight-swatch"
							className={cn("mt-1 h-auto w-1 shrink-0 rounded", HIGHLIGHT_SWATCH)}
							aria-hidden
						/>
						<div className="min-w-0 flex-1">
							<Link
								to={`/read/${h.documentId}#h=${h.id}`}
								state={{ from }}
								className="block text-[0.95rem] leading-relaxed after:absolute after:inset-0 after:content-['']"
							>
								{/* The quote as it is marked in the article: in its color. */}
								<span className="box-decoration-clone bg-(--hl) px-0.5">
									<Marked runs={h.quote} />
								</span>
							</Link>
							{h.note ? (
								<PostIt variant="compact" fit={snippetText(h.note)} className="mt-2 text-sm">
									<Marked runs={h.note} />
								</PostIt>
							) : null}
							<p className="mt-2 line-clamp-1 text-xs text-muted-fg">
								{h.title}
								{h.siteName ? ` · ${h.siteName}` : null}
							</p>
						</div>
					</li>
				))}
			</ul>
		</section>
	)
}

function NoteGroup({ group, q }: { group: Group<NoteHit>; q: string }) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const from = location.pathname + location.search
	return (
		<section data-testid="search-notes" aria-labelledby="search-notes">
			<GroupHeading
				id="search-notes"
				label={t("search.groups.notes")}
				more={<ShowAll q={q} group="notes" shown={group.items.length} total={group.total} />}
			/>
			{/* Each note on its paper, the article it is about beneath. */}
			<ul className="grid items-start gap-x-6 gap-y-4 sm:grid-cols-2">
				{group.items.map((n) => (
					<li key={n.documentId} className="relative isolate">
						<PostIt variant="compact" fit={snippetText(n.note)} className="text-sm leading-relaxed">
							<Marked runs={n.note} />
						</PostIt>
						<Link
							to={`/read/${n.documentId}#note`}
							state={{ from }}
							aria-label={t("search.groups.noteOf", { title: n.title })}
							className="mt-2 line-clamp-1 block text-xs text-muted-fg after:absolute after:inset-0 after:content-[''] hover:text-fg hover:underline"
						>
							<span className="font-medium text-fg">{n.title}</span>
							{n.siteName ? ` · ${n.siteName}` : null}
						</Link>
					</li>
				))}
			</ul>
		</section>
	)
}

/**
 * The query names a topic the reader no longer has, so it finds nothing in it. A saved search
 * offers to drop the topic from it, or to go; any other query, to search without it.
 */
function MissingTopic({ q, name }: { q: string; name: string }) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const location = useLocation()
	const navigate = useNavigate()
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const fetcher = useFetcher<{ ok: boolean; saved?: SavedSearchItem }>()
	const saved = layout?.savedSearches.find((s) => s.query === q)
	const rest = renameTopicOperator(q, name, [])
	// Without the topic it would find everything: deleting is the way out.
	const keeps = !findsEverything(rest)
	const changed = fetcher.data?.ok ? fetcher.data.saved : undefined
	useEffect(() => {
		if (changed) void navigate(searchPath(changed.query), { replace: true, state: location.state })
	}, [changed, navigate, location.state])
	const button =
		"rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
	return (
		<div
			role="status"
			data-testid="search-missing-topic"
			className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border p-3 text-sm"
		>
			<p className="flex min-w-0 flex-1 basis-64 items-start gap-2">
				<CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-fg" aria-hidden />
				{t(saved ? "search.missingTopic.saved" : "search.missingTopic.unsaved", { name })}
			</p>
			{saved ? (
				<fetcher.Form method="post" action="/saved-searches" className="flex flex-wrap gap-2">
					<input type="hidden" name="id" value={saved.id} />
					<input type="hidden" name="topic" value={name} />
					{keeps ? (
						<button
							type="submit"
							name="intent"
							value="drop-topic"
							disabled={fetcher.state !== "idle"}
							className={button}
						>
							{t("search.missingTopic.remove")}
						</button>
					) : null}
					<button
						type="submit"
						name="intent"
						value="delete"
						disabled={fetcher.state !== "idle"}
						onClick={() =>
							showToast({
								message: tc("savedSearches.deleted", { name: saved.name }),
								undo: {
									action: "/saved-searches",
									intent: "create",
									label: tc("savedSearches.undo"),
									fields: { name: saved.name, query: saved.query },
								},
							})
						}
						className={button}
					>
						{t("search.missingTopic.delete")}
					</button>
				</fetcher.Form>
			) : keeps ? (
				<Link
					to={searchPath(rest)}
					replace
					state={location.state}
					className="text-link hover:underline"
				>
					{t("search.missingTopic.without")}
				</Link>
			) : null}
		</div>
	)
}

/** What each chip writes into the query. One place at a time; the rest add up. */
const CHIPS = [
	{ name: "library", key: "in", value: "library" },
	{ name: "archive", key: "in", value: "archive" },
	{ name: "trash", key: "in", value: "trash" },
	{ name: "starred", key: "is", value: "starred" },
	{ name: "unread", key: "is", value: "unread" },
	{ name: "finished", key: "is", value: "finished" },
	{ name: "highlights", key: "has", value: "highlights" },
	{ name: "note", key: "has", value: "note" },
] as const satisfies ReadonlyArray<{ name: string; key: SearchKey; value: string }>

/** The chips edit the query, as typing the operator would: the query is all the state there is. */
function Chips({ q, topics }: { q: string; topics: string[] | null }) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const { filters } = useMemo(() => parseSearchQuery(q), [q])
	const navRef = useRef<HTMLElement>(null)
	// Follow the active chip
	useEffect(() => {
		navRef.current
			?.querySelector("[aria-current]")
			?.scrollIntoView({ inline: "nearest", block: "nearest" })
	}, [q])
	return (
		<nav
			ref={navRef}
			data-testid="search-chips"
			aria-label={t("search.chips.label")}
			className="-ml-4 flex min-w-0 gap-2 overflow-x-auto py-1 pr-8 pl-4 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:ml-0 md:pl-0"
		>
			{topics ? (
				<>
					<TopicChip q={q} topics={topics} />
					<span aria-hidden className="my-1 w-px shrink-0 self-stretch bg-border" />
				</>
			) : null}
			{CHIPS.map(({ name, key, value }) => {
				const on = filters.some((f) => f.key === key && f.value === value && !f.negated)
				// A place replaces the place; a negated twin would cancel the chip out.
				const rest = key === "in" ? removeOperator(q, "in") : removeOperator(q, key, value)
				return (
					<Link
						key={name}
						to={searchPath(on ? rest : addOperator(rest, key, value))}
						state={location.state}
						replace
						data-testid={`search-chip-${name}`}
						aria-current={on ? "true" : undefined}
						className="flex shrink-0 items-center rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg aria-[current]:border-selected aria-[current]:bg-selected aria-[current]:text-selected-fg"
					>
						{t(`search.chips.${name}`)}
					</Link>
				)
			})}
		</nav>
	)
}

const CHIP =
	"flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg"
const CHIP_ON =
	"border-selected bg-selected text-selected-fg hover:bg-selected hover:text-selected-fg"

/** The query's `topic:` and `has:topic` tokens, which the Topic chip sets. */
const isTopicToken = (token: Token) =>
	(token.key === "topic" && !token.raw.startsWith("-")) ||
	(token.key === "has" && token.value?.toLowerCase() === "topic")

/**
 * The Library's topic choice, in the search: a topic writes `topic:`, No topic `-has:topic`, in
 * place of the ones the query had. A query naming several shows the first; × takes them all out.
 */
function TopicChip({ q, topics }: { q: string; topics: string[] }) {
	const { t } = useTranslation("library")
	const location = useLocation()
	const tokens = parseSearchQuery(q).tokens
	const rest = tokens
		.filter((token) => !isTopicToken(token))
		.map((token) => token.raw)
		.join(" ")
	const first = tokens.find(isTopicToken)
	// No topic is its own choice: a topic may be called the same.
	const none = first?.key === "has" && first.raw.startsWith("-")
	const topic = first?.key === "topic" ? (first.value ?? null) : null
	const chosen = none ? t("topicFilter.none") : topic
	const to = (query: string) => searchPath(query)
	return (
		<span data-testid="search-topic-chip" className="flex shrink-0 items-center">
			<MoreMenu
				label={chosen ? t("topicFilter.chosen", { topic: chosen }) : t("topicFilter.choose")}
				align="start"
				className={cn(CHIP, chosen && CHIP_ON, chosen && "rounded-r-none border-r-0 pr-2")}
				icon={
					<>
						<span className="max-w-48 truncate">{chosen ?? t("topicFilter.label")}</span>
						<ChevronDown className="size-3.5 shrink-0" aria-hidden />
					</>
				}
			>
				<div className="flex max-h-80 w-64 max-w-[80vw] flex-col overflow-y-auto">
					{topics.map((name) => (
						<MenuNavLink
							key={name}
							to={to(addOperator(rest, "topic", name))}
							state={location.state}
							replace
							current={name === topic}
							onChoose={name === topic ? undefined : () => countTopicClick("topic_filter_search")}
						>
							<span className="min-w-0 truncate">{name}</span>
						</MenuNavLink>
					))}
				</div>
				<div className="mt-1 border-t border-border pt-1">
					<MenuNavLink
						to={to(`${rest} -has:topic`.trim())}
						state={location.state}
						replace
						current={none}
						onChoose={none ? undefined : () => countTopicClick("topic_filter_search")}
					>
						{t("topicFilter.none")}
					</MenuNavLink>
				</div>
			</MoreMenu>
			{chosen ? (
				<Link
					to={to(rest)}
					state={location.state}
					replace
					aria-label={t("topicFilter.clear")}
					className={cn(CHIP, CHIP_ON, "self-stretch rounded-l-none border-l-0 px-2")}
				>
					<X className="size-3.5" aria-hidden />
				</Link>
			) : null}
		</span>
	)
}

const SAVE_BUTTON =
	"flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg"

/**
 * Gives the query a name, so the sidebar opens it. A query saved already (the same text) says so,
 * and its menu renames or deletes it. The saved ones come with the layout's data, which is read
 * again after every change.
 */
function SaveSearch({ q }: { q: string }) {
	const { t } = useTranslation()
	const { t: tl } = useTranslation("library")
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const fetcher = useFetcher()
	const [dialog, setDialog] = useState<{ rename?: SavedSearchItem } | null>(null)
	const closeDialog = useCallback(() => setDialog(null), [])
	const deleting = fetcher.formData?.get("intent") === "delete" ? fetcher.formData.get("id") : null
	const saved = layout?.savedSearches.find((s) => s.query === q && s.id !== deleting)
	const savable = !saved && canSaveSearch(q)
	useCommands(() =>
		savable
			? {
					heading: tl("search.title"),
					commands: [
						{
							id: "save-search",
							label: t("savedSearches.saveCommand"),
							icon: Bookmark,
							keywords: ["pin", "sidebar"],
							run: () => setDialog({}),
						},
					],
				}
			: null,
	)
	return (
		<>
			{saved ? (
				<MoreMenu
					label={t("savedSearches.savedAs", { name: saved.name })}
					icon={
						<>
							<BookmarkCheck className="size-4 text-accent" aria-hidden />
							<span className="hidden sm:inline">{t("savedSearches.saved")}</span>
						</>
					}
					className={`${SAVE_BUTTON} text-fg`}
				>
					<SavedSearchMenuItems
						saved={saved}
						fetcher={fetcher}
						onRename={() => setDialog({ rename: saved })}
					/>
				</MoreMenu>
			) : savable ? (
				<button
					type="button"
					onClick={() => setDialog({})}
					aria-haspopup="dialog"
					aria-label={t("savedSearches.save")}
					data-testid="save-search"
					className={SAVE_BUTTON}
				>
					<Bookmark className="size-4" aria-hidden />
					{/* The short word: with the long one the last chip no longer fits its row. */}
					<span className="hidden sm:inline">{t("actions.save")}</span>
				</button>
			) : null}
			{dialog ? <SavedSearchDialog saved={dialog.rename} query={q} onClose={closeDialog} /> : null}
		</>
	)
}

/** One example per operator; each runs. */
const TIPS = [
	{ row: "phrase", example: '"exact phrase"' },
	{ row: "in", example: "in:archive" },
	{ row: "is", example: "is:unread" },
	{ row: "has", example: "has:highlights" },
	{ row: "tag", example: "tag:later" },
	{ row: "topic", example: "-has:topic" },
	{ row: "site", example: "site:wikipedia.org" },
	{ row: "author", example: 'author:"Paul Graham"' },
	{ row: "title", example: "title:schedule" },
	{ row: "via", example: "via:feed" },
	{ row: "saved", example: "saved:7d" },
	{ row: "published", example: "published:2026" },
	{ row: "before", example: "before:2026-01-01" },
	{ row: "sort", example: "in:library sort:longest" },
	{ row: "not", example: "in:library -is:finished" },
] as const satisfies ReadonlyArray<{ row: string; example: string }>

function Tips() {
	const { t } = useTranslation("library")
	const location = useLocation()
	// `topic:` is for readers who have topics, as the sidebar's link is.
	const topics = !!useRouteLoaderData<typeof layoutLoader>("routes/app-layout")?.topics
	return (
		<section data-testid="search-tips" aria-labelledby="search-tips-heading" className="mt-8">
			<h2 id="search-tips-heading" className="text-lg font-medium">
				{t("search.tipsTitle")}
			</h2>
			<p className="mt-1 text-sm text-muted-fg">{t("search.tipsIntro")}</p>
			<dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
				{TIPS.filter(({ row }) => topics || row !== "topic").map(({ row, example }) => (
					<div key={row} className="contents">
						<dt>
							<Link
								to={searchPath(example)}
								state={location.state}
								className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-fg hover:underline"
							>
								{example}
							</Link>
						</dt>
						<dd className="text-muted-fg">{t(`search.tipRows.${row}`)}</dd>
					</div>
				))}
			</dl>
		</section>
	)
}
