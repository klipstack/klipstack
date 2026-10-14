import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import type { RenderableHighlight } from "~/lib/highlights.client"
import type { LinkTargets } from "~/lib/note-links"
import { cn } from "~/lib/utils"
import { LinkArticleButton } from "./link-article-button"
import type { NoteEditorApi } from "./note-editor"
import { NoteField } from "./note-field"
import { ArticleNoteLabel, NoteStatus } from "./note-status"
import { NoteText } from "./note-text"
import { PostIt, tiltFor, useGrowingFit } from "./post-it"

interface Props {
	note: {
		value: string
		status: NoteSaveStatus
		onChange: (text: string) => void
		onFlush: () => void
	}
	items: Array<RenderableHighlight & { exact: string; orphaned?: boolean }>
	activeId: string | null
	/** The article being read: its own note, and the one article the link menu never offers. */
	documentId: string
	/** Every article linked from this one's notes, and whether it is still readable. */
	linkTargets: LinkTargets
	/** Articles whose notes link here, most recently written first. */
	backlinks: Backlink[]
	/** Library articles this one's content links to, and the ones whose content links here. */
	contentLinks: { to: ContentLink[]; from: ContentLink[] }
	/** Where Back should return to, for the links inside notes. */
	from: string
	onSelect: (id: string) => void
	onClose: () => void
	/** The article's chat (AI accounts): a second tab beside notes and highlights. */
	chat?: React.ReactNode
	tab?: SidebarTab
	onTab?: (tab: SidebarTab) => void
}

export type SidebarTab = "notes" | "chat"

export interface Backlink {
	documentId: string
	title: string | null
	sourceUrl: string
	highlightId: string | null
	/** The quote of the highlight whose note holds the link; null for an article note. */
	exact: string | null
}

/** An article at the other end of a link in an article's content, not in a note. */
export interface ContentLink {
	documentId: string
	title: string | null
	sourceUrl: string
}

const NEXT = new Set(["j", "ArrowDown"])
const PREV = new Set(["k", "ArrowUp"])

/**
 * The article's note on top, its highlights below. Takes keyboard focus when it opens, with no
 * highlight picked yet. j/k or the arrows move between highlights, Home/End jump to the ends, Enter
 * goes to one, Escape closes. While typing the note, Escape only leaves the note.
 */
export function ReaderSidebar({
	note,
	items,
	activeId,
	documentId,
	linkTargets,
	backlinks,
	contentLinks,
	from,
	onSelect,
	onClose,
	chat,
	tab = "notes",
	onTab,
}: Props) {
	const { t } = useTranslation("reader")
	const [noteApi, setNoteApi] = useState<NoteEditorApi | null>(null)
	// An empty note is as wide as its placeholder.
	const noteFit = useGrowingFit(note.value || t("highlights.sidebar.notePlaceholder"), documentId)
	const asideRef = useRef<HTMLElement>(null)
	const listRef = useRef<HTMLOListElement>(null)

	const buttons = () =>
		Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-id]") ?? [])

	// The sidebar itself takes focus when it opens; the first j/↓ lands on the first highlight. The
	// chat's field takes it there instead.
	useEffect(() => {
		if (tab === "notes") asideRef.current?.focus()
	}, [tab])
	const chatting = !!chat && tab === "chat"

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return
		// On the chat, Escape closes the sidebar, from the question field too.
		if (chatting && e.key === "Escape") {
			e.preventDefault()
			onClose()
			return
		}
		// Typing the note: every key is the note's, except Escape, which leaves it.
		if ((e.target as Element).closest?.('[contenteditable="true"], textarea')) {
			if (e.key !== "Escape") return
			e.preventDefault()
			asideRef.current?.focus()
			return
		}
		if (e.key === "Escape") {
			e.preventDefault()
			onClose()
			return
		}
		if (chatting) return
		const all = buttons()
		if (all.length === 0) return
		const at = all.indexOf(document.activeElement as HTMLButtonElement)
		let next: number | null = null
		if (NEXT.has(e.key)) next = at < 0 ? 0 : Math.min(at + 1, all.length - 1)
		else if (PREV.has(e.key)) next = at < 0 ? 0 : Math.max(at - 1, 0)
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = all.length - 1
		if (next === null) return
		e.preventDefault()
		all[next]?.focus()
	}

	return (
		<aside
			ref={asideRef}
			tabIndex={-1}
			aria-label={t("highlights.sidebar.title")}
			onKeyDown={onKeyDown}
			className="fixed inset-y-0 right-0 z-20 flex w-80 max-w-[90vw] flex-col border-l outline-none border-border bg-card shadow-xl"
		>
			{/* Same height as the reader header (safe-top + 52px row), so the bottom borders line up. */}
			<div className="safe-top flex items-center justify-between border-b border-border px-4">
				<div className="flex h-13 flex-1 items-center justify-between">
					{chat ? (
						<div role="tablist" aria-label={t("highlights.sidebar.title")} className="flex gap-1">
							{(["notes", "chat"] as const).map((name) => (
								<button
									key={name}
									type="button"
									role="tab"
									aria-selected={tab === name}
									onClick={() => onTab?.(name)}
									className={cn(
										"rounded-md px-2 py-1 text-sm font-semibold",
										tab === name ? "bg-muted text-fg" : "text-muted-fg hover:text-fg",
									)}
								>
									{name === "notes" ? t("highlights.sidebar.title") : t("ai.chat.tab")}
								</button>
							))}
						</div>
					) : (
						<h2 className="text-sm font-semibold">{t("highlights.sidebar.title")}</h2>
					)}
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-muted-fg hover:bg-muted"
						aria-label={t("highlights.toolbar.close")}
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>
			</div>
			{/* Kept while Notes shows, so a question being typed and the scroll stay. */}
			{chat ? (
				<div className={cn("flex min-h-0 flex-1 flex-col", !chatting && "hidden")}>{chat}</div>
			) : null}
			<div className={cn("flex-1 overflow-y-auto", chatting && "hidden")}>
				<section className="border-b border-border p-4">
					<div className="mb-2 flex items-center justify-between gap-2 text-xs">
						<ArticleNoteLabel />
						<NoteStatus status={note.status} onRetry={note.onFlush} />
					</div>
					{/* Written straight on the paper: the editor is the note. */}
					<PostIt
						variant="compact"
						fit={noteFit}
						className="text-base leading-snug focus-within:ring-2 focus-within:ring-ring"
					>
						<NoteField
							key={documentId}
							id="article-note"
							aria-label={t("highlights.sidebar.note")}
							value={note.value}
							maxLength={NOTE_MAX}
							onChange={note.onChange}
							onBlur={note.onFlush}
							documentId={documentId}
							linkTargets={linkTargets}
							placeholder={t("highlights.sidebar.notePlaceholder")}
							className="block max-h-[50vh] min-h-20 w-full overflow-y-auto"
							onApi={setNoteApi}
						/>
					</PostIt>
					<LinkArticleButton api={noteApi} className="-ml-2 mt-1" />
				</section>
				<h3 className="px-4 pt-4 text-xs font-medium text-muted-fg">
					{items.length > 0
						? t("highlights.sidebar.highlights", { count: items.length })
						: t("highlights.sidebar.highlights")}
				</h3>
				{items.length === 0 ? (
					<p className="px-4 py-2 text-sm text-muted-fg">{t("highlights.sidebar.empty")}</p>
				) : (
					<ol ref={listRef} className="p-2">
						{items.map((h) => (
							<li key={h.id}>
								{/* The whole row goes to the highlight — quote and note together. The note's links
								    are text here, so there is nothing else inside to click. */}
								<button
									type="button"
									data-id={h.id}
									onClick={() => onSelect(h.id)}
									className={cn(
										"flex w-full gap-2 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
										activeId === h.id ? "bg-fg/10" : "hover:bg-muted",
									)}
								>
									<span className="min-w-0 flex-1">
										{/* Marked as it is in the article, in its color. */}
										<span className="line-clamp-3 px-0.5 text-sm">
											<span
												{...highlightColor(h.color)}
												data-testid="highlight-quote"
												className="marker"
											>
												{h.exact}
											</span>
										</span>
										{h.note ? (
											<PostIt
												as="span"
												variant="compact"
												fit={h.note}
												color={highlightColorName(h.color)}
												tilt={tiltFor(h.id)}
												className="mt-3 mb-1 text-base leading-snug"
											>
												<NoteText text={h.note} linkTargets={linkTargets} plainLinks />
											</PostIt>
										) : null}
										{h.orphaned ? (
											<span className="mt-1 block text-xs text-danger">
												{t("highlights.orphaned")}
											</span>
										) : null}
									</span>
								</button>
							</li>
						))}
					</ol>
				)}
				<LinkSection
					testId="backlinks"
					title={t("highlights.sidebar.backlinks")}
					links={backlinks}
					from={from}
				/>
				<LinkSection
					testId="content-links-from"
					title={t("highlights.sidebar.contentLinksFrom")}
					links={contentLinks.from}
					from={from}
				/>
				<LinkSection
					testId="content-links-to"
					title={t("highlights.sidebar.contentLinksTo")}
					links={contentLinks.to}
					from={from}
				/>
			</div>
		</aside>
	)
}

/** A titled list of articles connected to this one; nothing when the list is empty. */
function LinkSection({
	testId,
	title,
	links,
	from,
}: {
	testId: string
	title: string
	links: Array<ContentLink & { highlightId?: string | null; exact?: string | null }>
	from: string
}) {
	if (links.length === 0) return null
	return (
		<section data-testid={testId} className="border-t border-border p-4">
			<h3 className="mb-2 text-xs font-medium text-muted-fg">{title}</h3>
			<ul className="space-y-1">
				{links.map((l) => (
					<li key={`${l.documentId}:${l.highlightId ?? ""}`}>
						<Link
							to={
								l.highlightId ? `/read/${l.documentId}#h=${l.highlightId}` : `/read/${l.documentId}`
							}
							state={{ from }}
							className="block rounded-lg px-2 py-1.5 hover:bg-muted"
						>
							<span className="line-clamp-2 block text-sm">{l.title ?? l.sourceUrl}</span>
							{l.exact ? (
								<span className="mt-0.5 line-clamp-1 block text-xs text-muted-fg">{l.exact}</span>
							) : null}
						</Link>
					</li>
				))}
			</ul>
		</section>
	)
}
