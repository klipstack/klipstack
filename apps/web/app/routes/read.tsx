import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	ExternalLink,
	EyeOff,
	Link2,
	Loader2,
	MessagesSquare,
	Newspaper,
	PanelRightClose,
	PanelRightOpen,
	RotateCcw,
	Star,
	Tag,
	Trash2,
} from "lucide-react"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	data,
	isRouteErrorResponse,
	Link,
	redirect,
	type ShouldRevalidateFunctionArgs,
	useLocation,
	useNavigate,
} from "react-router"
import { openArticle } from "~/commands/articles.server"
import { failureKey, safeHost } from "~/components/document-card"
import { EditableTitle } from "~/components/editable-title"
import { ErrorContent } from "~/components/error-content"
import { ReaderArticle } from "~/components/reader-article"
import { ReaderEnd } from "~/components/reader-end"
import type { SidebarTab } from "~/components/reader-sidebar"
import { ReaderTopBar } from "~/components/reader-top-bar"
import { TopicKicker, TopicShelf } from "~/components/reader-topics"
import { SharedLinkBlocked, SharedVia } from "~/components/shared-via"
import { TagChips, TagDialog } from "~/components/tag-dialog"
import { tooltip } from "~/components/tooltip-host"
import { useClientValue } from "~/hooks/use-client-value"
import { type StateIntent, useDocumentState } from "~/hooks/use-document-state"
import { useFinishOnLeave } from "~/hooks/use-finish-on-leave"
import { liveRefreshSkips } from "~/hooks/use-live-updates"
import { useReaderBar } from "~/hooks/use-reader-bar"
import { useReadingProgress } from "~/hooks/use-reading-progress"
import {
	type AiBriefView,
	type AiThreadWithMessages,
	briefView,
	messageView,
	threadView,
} from "~/lib/ai-threads"
import { ai as aiModule, topicModels } from "~/lib/ai.server"
import { warnAboutBacklinks } from "~/lib/backlink-warning.client"
import { useCommands } from "~/lib/commands"
import { copyLink } from "~/lib/copy-link"
import { formatDay, timeZoneFromCookie } from "~/lib/date-groups"
import { hasFeature } from "~/lib/features.server"
import { supportsHighlightApi } from "~/lib/highlights.client"
import { getLocale } from "~/lib/i18n.server"
import { aiAllowance } from "~/lib/limits.server"
import { extractLinkIds } from "~/lib/note-links"
import { isUuid } from "~/lib/page-cursor"
import { resolvePrefs } from "~/lib/prefs"
import { requireUser } from "~/lib/session.server"
import {
	type ArticleShortcut,
	articleShortcut,
	CHAT_HINT,
	HIGHLIGHTS_HINT,
	SHORTCUT_HINTS,
} from "~/lib/shortcuts"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import { getBrief, listDocumentThreads } from "~/services/ai-threads.server"
import { getDocumentForReader, joinedArticleId, savedLinksIn } from "~/services/documents.server"
import { listDocumentHighlights } from "~/services/highlights.server"
import { linkTargetStatus, listBacklinks, listContentLinks } from "~/services/links.server"
import { type ReaderTopics, readerTopics } from "~/services/topics.server"
import type { Route } from "./+types/read"

export function meta({ loaderData }: Route.MetaArgs) {
	return [{ title: `${loaderData?.document.title ?? "Reading"} · Klipstack` }]
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const result = isUuid(params.id) ? await getDocumentForReader(user.id, params.id) : null
	if (!result) {
		// A save of a post that joined the article it shared, saved before.
		const joined = isUuid(params.id) ? await joinedArticleId(user.id, params.id) : null
		if (joined) throw redirect(`/read/${joined}`)
		throw data({ message: "not_found" }, { status: 404 })
	}
	// A new capture being processed leaves the current version readable.
	const readable = Boolean(result.version)
	// The service worker warms articles for offline reading; that is not the user opening them.
	const warming = request.headers.get("x-klipstack-warm") === "1"
	// A new article stops being new once the reader shows real interest (see `useMarkOpened`).
	if (readable && !warming && result.document.firstOpenedAt) {
		// Reopening can start a new reading cycle. Return that state to the client so its scroll
		// saves use the right cycle, and delayed saves from older tabs can be ignored.
		Object.assign(result.document, await openArticle(user.id, params.id))
	}
	const highlights = readable ? await listDocumentHighlights(user.id, params.id) : []
	// AI answers: with the feature, a provider set up, and the article's text to ask about.
	const aiEnabled =
		readable &&
		result.document.status === "ready" &&
		aiModule.available &&
		(await hasFeature(user.id, "ai"))
	const versionId = result.document.currentVersionId
	const [listed, kept, allowance] = aiEnabled
		? await Promise.all([
				listDocumentThreads(user.id, params.id, versionId),
				versionId ? getBrief(user.id, versionId) : null,
				aiAllowance(user.id),
			])
		: [[], null, null]
	const threads: AiThreadWithMessages[] = listed.map((thread) => ({
		...threadView(thread),
		messages: thread.messages.map(messageView),
	}))
	const brief: AiBriefView | null = kept ? briefView(kept) : null
	const html = result.version?.html ?? null
	const savedLinks = html
		? await savedLinksIn(user.id, params.id, html, result.document.sourceUrl)
		: {}
	// Chips need to know whether their target is still there, and this article needs to know who
	// links to it.
	const linked = extractLinkIds(
		[result.document.note ?? "", ...highlights.map((h) => h.note ?? "")].join("\n"),
	)
	// Its topics, and what to read next in them: with the feature, and topics to open. Not for an
	// offline copy, whose shelf would go stale and lead to articles it doesn't have.
	const topicsShown =
		readable && !warming && topicModels.available && (await hasFeature(user.id, "topics"))
	const noTopics: ReaderTopics = { topics: [], shelf: null }
	const [linkTargets, backlinks, contentLinks, topics] = await Promise.all([
		linkTargetStatus(user.id, linked),
		listBacklinks(user.id, params.id),
		listContentLinks(user.id, params.id),
		topicsShown ? readerTopics(user.id, params.id) : noTopics,
	])
	const { publishedAt } = result.document
	const day = (at: Date) =>
		formatDay(at, getLocale(context), timeZoneFromCookie(request.headers.get("cookie")))
	return {
		document: result.document,
		published: publishedAt ? day(publishedAt) : null,
		via: result.via.map(({ publishedAt: at, ...via }) => ({
			...via,
			published: at ? day(at) : null,
		})),
		html,
		prefs: resolvePrefs(user.prefs),
		highlights,
		ai: {
			enabled: aiEnabled,
			threads,
			brief,
			allowance,
			// Midnight UTC on the 1st, as Settings → Usage writes it.
			resetsOn: allowance ? formatDay(allowance.resetsAt, getLocale(context), "UTC") : null,
		},
		savedLinks,
		linkTargets,
		backlinks,
		contentLinks,
		topics,
	}
}

export type ReaderData = Route.ComponentProps["loaderData"]

/** Article changes the page shows without its loader: it keeps the server's answer. */
const SHOWN_STATE = new Set([
	"star",
	"unstar",
	"shortlist",
	"unshortlist",
	"archive",
	"unarchive",
	"finish",
	"unread",
	"progress",
])
/** Highlight changes the same way. A note can link to articles, which only the loader looks up. */
const SHOWN_HIGHLIGHT = new Set(["create", "delete", "resize"])

/**
 * The article loads again only when it may have changed: resending it costs the whole HTML and
 * about seven queries. Not after this page's own changes, whose answers it already shows, nor for
 * live events about other articles.
 */
export function shouldRevalidate({
	currentParams,
	currentUrl,
	nextUrl,
	formMethod,
	formAction,
	formData,
	json,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	// Deleting makes this route unreadable; leave before React Router asks its loader for it again.
	if (formData?.get("intent") === "delete") return false
	if (formMethod && formAction) {
		const body = (json && typeof json === "object" ? json : {}) as Record<string, unknown>
		const intent = String(formData?.get("intent") ?? body.intent)
		const path = new URL(formAction, currentUrl).pathname
		const own = `/documents/${currentParams.id}`
		if (path === `${own}/state` && SHOWN_STATE.has(intent)) return false
		if (path === `${own}/highlights`) {
			if (SHOWN_HIGHLIGHT.has(intent) || (intent === "update" && !("note" in body))) return false
		}
	}
	if (!formMethod && currentUrl.href === nextUrl.href && liveRefreshSkips(currentParams.id))
		return false
	return defaultShouldRevalidate
}

export default function Read(props: Route.ComponentProps) {
	return (
		<Reader
			key={`${props.loaderData.document.id}:${props.loaderData.document.currentVersionId}`}
			{...props}
		/>
	)
}

function Reader({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const { t: tc } = useTranslation()
	const { document: doc, html } = loaderData
	const [prefs, setPrefs] = useState(loaderData.prefs)
	// On screen whenever there is a version, also while a new capture is processed (`updating`):
	// the server takes no new highlights or resizes until it lands.
	const ready = typeof html === "string" && html !== ""
	const updating = ready && (doc.status === "queued" || doc.status === "processing")
	const location = useLocation()
	const navigate = useNavigate()
	// Opened directly, the article's own list, as it was on opening: finishing archives the article
	// before the reader leaves, and must not send an inbox article's reader to the archive.
	const [openedIn] = useState(() => (doc.archivedAt ? "/archive" : "/library"))
	// Where the reader was opened from (list views pass it); finishing goes back there, with the
	// list's cursor on this article.
	const back = {
		to: (location.state as { from?: string } | null)?.from ?? openedIn,
		state: { selected: doc.id },
	}
	const leave = () => void navigate(back.to, { replace: true, state: back.state })
	// Finished means archived; unread and deleted would be undone by reopening: leave.
	const state = useDocumentState(doc.id, doc, leave)
	const { engage, progress } = useReadingProgress(doc, ready)
	// Opened where it was left off (useReadingProgress), or at the top.
	const [openedAt] = useState(() =>
		doc.readingPosition >= 0.05 && doc.readingPosition <= 0.95 ? doc.readingPosition : 0,
	)
	const ending = useFinishOnLeave({
		documentId: doc.id,
		ready,
		finished: state.finished,
		archived: state.archived,
		readingMinutes: doc.readingMinutes,
		openedAt,
		leave,
	})
	// Moved back to the library, marked unread or deleted here: leaving keeps it that way.
	const change = (intent: StateIntent) => {
		if (intent === "unarchive" || intent === "unread" || intent === "delete") ending.keep(true)
		state.change(intent)
	}
	const { titleRef, headerRef, titleAway, barHidden } = useReaderBar(ready)
	const [tagging, setTagging] = useState(false)
	const highlightsPaint = useClientValue(supportsHighlightApi, true)
	const [sidebarOpen, setSidebarOpen] = useState(false)
	const [sidebarTab, setSidebarTab] = useState<SidebarTab>("notes")
	// Each tab has its own button and key: one opens the sidebar on its tab, or closes it when that
	// tab is already showing.
	const showSidebarTab = (tab: SidebarTab) => {
		if (sidebarOpen && sidebarTab === tab) return setSidebarOpen(false)
		setSidebarTab(tab)
		setSidebarOpen(true)
	}
	const toggleSidebar = () => showSidebarTab("notes")
	// The same test as the reader's (`aiEnabled`): AI needs the browser's highlight painting.
	const chatting = ready && loaderData.ai.enabled && highlightsPaint

	const deleteArticle = () => {
		warnAboutBacklinks(doc.id, (count) => tl("toast.deletedLinked", { count }), tl("toast.undo"))
		showToast({
			message: tl("toast.deleted"),
			undo: { action: `/documents/${doc.id}/state`, intent: "restore", label: tl("toast.undo") },
		})
		change("delete")
	}

	// ---- keyboard shortcuts: the same keys as in the list views, acting on this article ----
	const act = (shortcut: ArticleShortcut): boolean => {
		switch (shortcut) {
			case "star":
				state.change(state.starred ? "unstar" : "star")
				return true
			case "shortlist":
				state.change(state.shortlisted ? "unshortlist" : "shortlist")
				return true
			case "archive":
				change(state.archived ? "unarchive" : "archive")
				return true
			case "unread":
				change("unread")
				return true
			case "delete":
				deleteArticle()
				return true
			case "tags":
				if (!ready) return false
				setTagging(true)
				return true
			default:
				return false
		}
	}
	const actRef = useRef(act)
	useInsertionEffect(() => {
		actRef.current = act
	})
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const shortcut = articleShortcut(e)
			if (shortcut && actRef.current(shortcut)) e.preventDefault()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [])

	// ---- command palette: this article's actions ----
	useCommands(() => ({
		heading: tc("palette.article"),
		commands: [
			{
				id: "article-star",
				label: state.starred ? t("actions.unstar") : t("actions.star"),
				icon: Star,
				shortcut: SHORTCUT_HINTS.star,
				run: () => act("star"),
			},
			{
				id: "article-shortlist",
				label: state.shortlisted ? t("actions.unshortlist") : t("actions.shortlist"),
				icon: Newspaper,
				shortcut: SHORTCUT_HINTS.shortlist,
				run: () => act("shortlist"),
			},
			{
				id: "article-archive",
				label: state.archived ? t("actions.unarchive") : t("actions.archive"),
				icon: state.archived ? ArchiveRestore : Archive,
				shortcut: SHORTCUT_HINTS.archive,
				run: () => act("archive"),
			},
			...(ready
				? [
						{
							id: "article-sidebar",
							label: sidebarOpen ? tc("palette.hideSidebar") : tc("palette.showSidebar"),
							icon: sidebarOpen ? PanelRightClose : PanelRightOpen,
							shortcut: HIGHLIGHTS_HINT,
							run: toggleSidebar,
						},
						...(chatting
							? [
									{
										id: "article-chat",
										label: t("ai.chat.open"),
										icon: MessagesSquare,
										shortcut: CHAT_HINT,
										run: () => showSidebarTab("chat"),
									},
								]
							: []),
						{
							id: "article-unread",
							label: tl("card.markUnread"),
							icon: EyeOff,
							shortcut: SHORTCUT_HINTS.unread,
							run: () => act("unread"),
						},
						{
							id: "article-tags",
							label: tl("tags.editCommand"),
							icon: Tag,
							shortcut: SHORTCUT_HINTS.tags,
							keywords: ["label"],
							run: () => act("tags"),
						},
					]
				: []),
			{
				id: "article-original",
				label: t("original"),
				icon: ExternalLink,
				run: () => window.open(doc.sourceUrl, "_blank", "noopener,noreferrer"),
			},
			{
				id: "article-copy-link",
				label: tc("palette.copyLink"),
				icon: Link2,
				keywords: ["url", "share"],
				run: () => copyLink(doc.sourceUrl, tc("palette.copied")),
			},
			{
				id: "article-delete",
				label: tl("card.delete"),
				icon: Trash2,
				shortcut: SHORTCUT_HINTS.delete,
				danger: true,
				run: () => act("delete"),
			},
		],
	}))

	return (
		// With the sidebar open (lg+), the whole page becomes the column left of it; everything in it
		// (top bar, article, finish bar) centers in that column.
		<div className={cn("min-h-screen", sidebarOpen && "lg:pr-80")}>
			<ReaderTopBar
				headerRef={headerRef}
				ready={ready}
				hidden={barHidden}
				progress={progress}
				title={doc.title ?? safeHost(doc.sourceUrl)}
				titleShown={titleAway}
				sourceUrl={doc.sourceUrl}
				back={back}
				prefs={prefs}
				onPrefs={setPrefs}
				starred={state.starred}
				shortlisted={state.shortlisted}
				archived={state.archived}
				onChange={change}
				onDelete={deleteArticle}
				sidebarOpen={sidebarOpen}
				sidebarTab={sidebarTab}
				onSidebar={toggleSidebar}
				onChat={chatting ? () => showSidebarTab("chat") : undefined}
				onTags={() => setTagging(true)}
			/>
			{ready ? (
				<ReaderArticle
					data={loaderData}
					prefs={prefs}
					updating={updating}
					headerRef={headerRef}
					sidebarOpen={sidebarOpen}
					setSidebarOpen={setSidebarOpen}
					sidebarTab={sidebarTab}
					showSidebarTab={showSidebarTab}
					engage={engage}
					header={
						<header ref={titleRef} className="mb-8">
							<TopicKicker topics={loaderData.topics.topics} />
							<EditableTitle title={doc.title} action={`/documents/${doc.id}/state`} />
							<p className="mt-3 text-sm text-muted-fg">
								{[doc.siteName ?? safeHost(doc.sourceUrl), doc.author].filter(Boolean).join(" · ")}
								{loaderData.published ? ` · ${loaderData.published}` : null}
								{doc.readingMinutes
									? ` · ${t("meta.minutes", { count: doc.readingMinutes })}`
									: null}
							</p>
							<div data-testid="reader-tags" className="mt-3 flex flex-wrap items-center gap-1">
								<TagChips tags={doc.tags} links />
								<button
									type="button"
									onClick={() => setTagging(true)}
									{...tooltip(tl("tags.add"), SHORTCUT_HINTS.tags)}
									aria-label={tl("tags.add")}
									className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-fg hover:bg-fg/10 hover:text-fg"
								>
									<Tag className="size-3" aria-hidden />
									{doc.tags.length === 0 ? tl("tags.add") : null}
								</button>
							</div>
							<SharedVia documentId={doc.id} posts={loaderData.via} />
							{doc.type === "post" && doc.sharedUrl ? (
								<SharedLinkBlocked url={doc.sharedUrl} />
							) : null}
						</header>
					}
					footer={
						<>
							<ReaderEnd
								key={doc.id}
								documentId={doc.id}
								editionNote={doc.editionNote}
								state={ending.state}
								archived={state.archived}
								starred={state.starred}
								shortlisted={state.shortlisted}
								onReached={ending.reached}
								onChange={change}
								onKeep={ending.keep}
								onFinish={ending.finish}
								back={back}
							/>
							<TopicShelf shelf={loaderData.topics.shelf} from={back.to} />
						</>
					}
				/>
			) : doc.status === "failed" ? (
				<div className="mx-auto max-w-lg px-4 py-24 text-center">
					<h1 className="text-xl font-semibold">{t("failed.title")}</h1>
					<p className="mt-2 text-muted-fg">{tl(failureKey(doc.failureReason))}</p>
					<p className="mt-1 text-sm text-muted-fg">{tl("failure.hint")}</p>
					<p className="mt-4 break-all text-sm text-muted-fg">{doc.sourceUrl}</p>
					<button
						type="button"
						onClick={() => state.change("retry")}
						className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
					>
						<RotateCcw className="size-4" aria-hidden />
						{t("failed.retry")}
					</button>
				</div>
			) : (
				<div className="mx-auto max-w-lg px-4 py-24 text-center">
					<Loader2 className="mx-auto size-8 animate-spin text-muted-fg" aria-hidden />
					<h1 className="mt-4 text-xl font-semibold">{t("pending.title")}</h1>
					<p className="mt-2 text-muted-fg">{t("pending.description")}</p>
					<p className="mt-4 break-all text-sm text-muted-fg">{doc.sourceUrl}</p>
				</div>
			)}
			{tagging ? (
				<TagDialog
					documentId={doc.id}
					title={doc.title ?? doc.sourceUrl}
					tags={doc.tags}
					onClose={() => setTagging(false)}
				/>
			) : null}
		</div>
	)
}

/** Missing article, offline, or a crash: the reader's back link stays available. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const { t } = useTranslation("reader")
	const notFound = isRouteErrorResponse(error) && error.status === 404
	return (
		<div className="min-h-screen">
			<header className="safe-top sticky top-0 z-20 border-b border-border/60 bg-bg/90 backdrop-blur">
				<div className="mx-auto flex max-w-5xl items-center px-3 py-2">
					<Link
						to="/library"
						className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-fg hover:bg-muted hover:text-fg"
					>
						<ArrowLeft className="size-4" aria-hidden />
						{t("back")}
					</Link>
				</div>
			</header>
			{notFound ? (
				<main className="mx-auto max-w-lg px-4 py-24 text-center">
					<h1 className="text-xl font-semibold">{t("notFound")}</h1>
				</main>
			) : (
				<ErrorContent error={error} />
			)}
		</div>
	)
}
