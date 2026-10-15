import { rangeFromOffsets, type TextSelector } from "@klipstack/anchor"
import type { AiCitation, AiThreadAction } from "@klipstack/db"
import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { AiCard, type AiCardPlacement } from "~/components/ai-card"
import { BriefCard } from "~/components/brief-card"
import { ChatPanel } from "~/components/chat-panel"
import { HighlightInk } from "~/components/highlight-ink"
import { HighlightNoteEditor, type NoteEditorPlacement } from "~/components/highlight-note-editor"
import { HighlightResizeHandles } from "~/components/highlight-resize-handles"
import { HighlightToolbar } from "~/components/highlight-toolbar"
import { LinkPopover } from "~/components/link-popover"
import { type MarginCard, MarginNotes, useMarginRoom } from "~/components/margin-notes"
import { prefetchNoteEditor } from "~/components/note-field"
import { tiltFor } from "~/components/post-it"
import { type OutlineState, ReaderOutline } from "~/components/reader-outline"
import { ReaderSidebar, type SidebarTab } from "~/components/reader-sidebar"
import { SelectionToolbar } from "~/components/selection-toolbar"
import {
	type ArticleSelection,
	isHighlightable,
	SelectionWatcher,
} from "~/components/selection-watcher"
import { AiAllowanceContext, AiResetsOnContext, useAiAllowance } from "~/hooks/use-ai-allowance"
import { type AiCard as Card, type AiPassage, useAiThreads } from "~/hooks/use-ai-threads"
import { useArticleLinks } from "~/hooks/use-article-links"
import { useBrief } from "~/hooks/use-brief"
import { useClientValue } from "~/hooks/use-client-value"
import { useHighlightCopy } from "~/hooks/use-highlight-copy"
import { isTemporary, useHighlightList } from "~/hooks/use-highlight-list"
import { useHighlightResize } from "~/hooks/use-highlight-resize"
import { useMediaQuery } from "~/hooks/use-media-query"
import { type ArticleNote, useNoteAutosave } from "~/hooks/use-note-autosave"
import { useAlignForSheet } from "~/hooks/use-reader-bar"
import { copyText } from "~/lib/copy-link"
import { highlightColor } from "~/lib/highlight-colors"
import {
	clearHighlights,
	clearThreads,
	firstRect,
	flashCited,
	highlightsAtPoint,
	renderHighlights,
	renderThreads,
	scrollRangeIntoView,
	setActiveHighlight,
	setThreadFocus,
	supportsHighlightApi,
} from "~/lib/highlights.client"
import { readerClassNames, type resolvePrefs } from "~/lib/prefs"
import { rangeText } from "~/lib/range-text.client"
import { isChatShortcut, isHighlightsShortcut } from "~/lib/shortcuts"
import { LONG_UNDO_MS, showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { ReaderData } from "~/routes/read"

interface PopoverState {
	id: string
	rect: DOMRect
	/** The page's scroll offset when `rect` was measured: together they pin the toolbar to the page. */
	scrollY: number
}

interface SelectionState {
	selection: ArticleSelection
	rect: DOMRect
	scrollY: number
}

const popoverAt = (id: string, rect: DOMRect): PopoverState => ({
	id,
	rect,
	scrollY: window.scrollY,
})

function noteEditorPlacement(touch: boolean, range: Range | undefined): NoteEditorPlacement {
	const rect = range ? firstRect(range) : null
	if (touch || !rect) return { kind: "sheet" }
	return { kind: "floating", rect }
}

const RESIZE_ERRORS = [
	"version_changed",
	"highlight_changed",
	"not_found",
	"invalid_range",
	"no_match",
] as const
const resizeError = (failure: string) =>
	(RESIZE_ERRORS as readonly string[]).includes(failure)
		? (failure as (typeof RESIZE_ERRORS)[number])
		: "network"

/**
 * The article on screen, with everything done in it: the selection's toolbar, highlights (make,
 * note, resize, copy, remove), notes in the margin, the sidebar, and the links' cards. `header` and `footer`
 * go at the top and the bottom of the article; `footer` is handed the article's note, which the
 * sidebar edits too.
 */
export function ReaderArticle({
	data,
	prefs,
	updating,
	headerRef,
	sidebarOpen,
	setSidebarOpen,
	sidebarTab,
	showSidebarTab,
	engage,
	outline,
	header,
	footer,
}: {
	data: ReaderData
	prefs: ReturnType<typeof resolvePrefs>
	/** A new capture is being processed: no new highlights or resizes until it lands. */
	updating: boolean
	headerRef: React.RefObject<HTMLElement | null>
	sidebarOpen: boolean
	setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>
	sidebarTab: SidebarTab
	/** Opens the sidebar on a tab, or closes it when that tab is showing (its button and key). */
	showSidebarTab: (tab: SidebarTab) => void
	/** The reader shows real interest: the article is no longer new. */
	engage: () => void
	/** The article's contents, shared with the top bar's button. */
	outline: OutlineState
	header: React.ReactNode
	footer: (note: ArticleNote) => React.ReactNode
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const { document: doc, linkTargets } = data
	const html = data.html ?? ""
	const location = useLocation()
	const contentRef = useRef<HTMLDivElement>(null)
	// The text and its ink (HighlightInk).
	const inkRef = useRef<HTMLDivElement>(null)
	const articleRef = useRef<HTMLElement>(null)
	const supported = useClientValue(supportsHighlightApi, true)
	const touch = useMediaQuery("(pointer: coarse)")
	const highlights = useHighlightList(doc.id, data.highlights)
	const { items } = highlights
	const note = useNoteAutosave(doc.id, doc.note)
	const aiEnabled = data.ai.enabled && supported
	const allowance = useAiAllowance(data.ai.allowance)
	const ai = useAiThreads(doc.id, data.ai.threads, allowance)
	const brief = useBrief(doc.id, doc.currentVersionId, data.ai.brief, allowance)
	const threadRangesRef = useRef<Map<string, Range>>(new Map())
	const [hoveredThread, setHoveredThread] = useState<string | null>(null)

	const rangesRef = useRef<Map<string, Range>>(new Map())
	const [activeId, setActiveId] = useState<string | null>(null)
	const [popover, setPopover] = useState<PopoverState | null>(null)
	const latestShowTab = useRef(showSidebarTab)
	useInsertionEffect(() => {
		latestShowTab.current = showSidebarTab
	})
	const [selection, setSelection] = useState<SelectionState | null>(null)
	const [editingId, setEditingId] = useState<string | null>(null)
	// Where the note being edited belongs. Its highlight cannot be resized while the editor is open.
	const [editingRange, setEditingRange] = useState<Range | undefined>(undefined)
	const [hoveredId, setHoveredId] = useState<string | null>(null)
	// A hovered margin note marks its highlight in full (`klip-active`); hovered text does not.
	const [hoveredNote, setHoveredNote] = useState<string | null>(null)
	const [resizeFocus, setResizeFocus] = useState<string | null>(null)
	// A just-created highlight opens its toolbar once the server has given it an id.
	const pendingOpen = useRef<{ start: number; end: number } | null>(null)

	// The editor's chunk is fetched while the reader is idle, so the first `[[` never waits.
	useEffect(() => {
		const idle = window.requestIdleCallback
		if (idle) {
			const handle = idle(prefetchNoteEditor, { timeout: 2000 })
			return () => window.cancelIdleCallback?.(handle)
		}
		const timer = window.setTimeout(prefetchNoteEditor, 2000)
		return () => window.clearTimeout(timer)
	}, [])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const tab = isHighlightsShortcut(e) ? "notes" : aiEnabled && isChatShortcut(e) ? "chat" : null
			if (!tab) return
			e.preventDefault()
			latestShowTab.current(tab)
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [aiEnabled])

	// ---- painting ----
	useEffect(() => {
		const root = contentRef.current
		if (!root) return
		rangesRef.current = renderHighlights(root, items, doc.currentVersionId)
		return () => clearHighlights()
	}, [items, doc.currentVersionId])
	// AI threads' passages, underlined. Only where they are changes the paint, not their answers.
	const threadCards = useRef(ai.cards)
	useInsertionEffect(() => {
		threadCards.current = ai.cards
	})
	// The chat has no passage: it lives in the sidebar, not on the text or in the margin.
	const passageCards = ai.cards.filter((c) => c.action !== "chat")
	const chatCard = ai.cards.find((c) => c.action === "chat")
	const threadPlaces = passageCards
		.map((c) => `${c.id}:${c.start}:${c.end}:${c.versionId}:${c.orphaned}`)
		.join()
	useEffect(() => {
		const root = contentRef.current
		if (!root || !threadPlaces) {
			threadRangesRef.current = new Map()
			clearThreads()
			return
		}
		threadRangesRef.current = renderThreads(
			root,
			threadCards.current.filter((c) => c.action !== "chat"),
			doc.currentVersionId,
		)
		return () => clearThreads()
	}, [threadPlaces, doc.currentVersionId])
	const focusedThread = hoveredThread ?? ai.openId
	useEffect(() => {
		setThreadFocus(focusedThread ? (threadRangesRef.current.get(focusedThread) ?? null) : null)
	}, [focusedThread, threadPlaces])
	// Without a margin, the open card floats below its passage: where that is, once it is painted.
	const [openRect, setOpenRect] = useState<DOMRect | null>(null)
	useEffect(() => {
		const range = ai.openId ? threadRangesRef.current.get(ai.openId) : undefined
		setOpenRect(range ? firstRect(range) : null)
	}, [ai.openId, threadPlaces])
	// Re-rendering (a color change, a save) clears the active mark: put it back.
	useEffect(() => {
		if (activeId) setActiveHighlight(rangesRef.current.get(activeId) ?? null)
	}, [items, activeId])

	// Deep link: /read/:id#h=<highlightId>. Ranges are rebuilt whenever items change.
	const followedHash = useRef<string | null>(null)
	useEffect(() => {
		const id = /^#h=(.+)$/.exec(location.hash)?.[1]
		if (!id) {
			followedHash.current = null
			return
		}
		if (followedHash.current === location.hash) return
		const range = rangesRef.current.get(id)
		if (!range) return
		followedHash.current = location.hash
		scrollRangeIntoView(range)
		setActiveHighlight(range)
		setActiveId(id)
	}, [location.hash, items])

	useEffect(() => {
		const pending = pendingOpen.current
		if (!pending) return
		const match = items.find(
			(h) => h.startOffset === pending.start && h.endOffset === pending.end && !isTemporary(h.id),
		)
		if (!match) return
		const range = rangesRef.current.get(match.id)
		const rect = range ? firstRect(range) : null
		if (rect) {
			setActiveId(match.id)
			setActiveHighlight(range ?? null)
			setPopover(popoverAt(match.id, rect))
		}
		pendingOpen.current = null
	}, [items])

	const resize = useHighlightResize({
		documentId: doc.id,
		versionId: doc.currentVersionId,
		rootRef: contentRef,
		headerRef,
		rangesRef,
		items,
		toolbarId: popover?.id ?? null,
		editingId,
		mutationPending: highlights.pending,
		onSaved: highlights.confirm,
		onDismiss: () => {
			setPopover(null)
			setActiveId(null)
			setActiveHighlight(null)
		},
		onPosition: (id, rect) => setPopover((prev) => (prev?.id === id ? popoverAt(id, rect) : prev)),
	})
	const focusResize = (id: string) => {
		const range = rangesRef.current.get(id)
		const rect = range && firstRect(range)
		if (rect) {
			setPopover(popoverAt(id, rect))
			setActiveId(id)
			setActiveHighlight(range)
		}
	}
	useAlignForSheet(popover?.id ?? editingId, touch, rangesRef, headerRef)

	// ---- changes ----
	const createHighlight = (selector: TextSelector) => {
		engage()
		pendingOpen.current = { start: selector.start, end: selector.end }
		highlights.change({ intent: "create", tempId: `tmp-${Date.now()}`, selector })
	}
	const openNote = (id: string) => {
		if (resize.blocked(id)) return
		const range = rangesRef.current.get(id)
		setPopover(null)
		setHoveredId(null)
		setHoveredNote(null)
		setEditingId(id)
		setEditingRange(range)
		setActiveId(id)
		setActiveHighlight(range ?? null)
	}
	const closeNote = useCallback(() => {
		setEditingId(null)
		setHoveredId(null)
		setHoveredNote(null)
		setActiveHighlight(null)
		setActiveId(null)
	}, [])
	const saveNote = (id: string, text: string) => {
		if (resize.blocked(id)) return
		highlights.change({ intent: "update", id, note: text })
	}
	const setColor = (id: string, color: number) => {
		if (resize.blocked(id)) return
		highlights.change({ intent: "update", id, color })
	}
	const removeHighlight = (id: string) => {
		if (resize.blocked(id)) return
		const hadNote = Boolean(items.find((h) => h.id === id)?.note)
		setPopover(null)
		setEditingId(null)
		setActiveId(null)
		setActiveHighlight(null)
		highlights.change({ intent: "delete", id })
		showToast({
			message: t(hadNote ? "highlights.toast.removedWithNote" : "highlights.toast.removed"),
			ms: hadNote ? LONG_UNDO_MS : undefined,
			undo: {
				action: `/documents/${doc.id}/highlights`,
				intent: "restore",
				fields: { id },
				label: tl("toast.undo"),
			},
		})
	}
	const closePopover = useCallback(() => {
		setPopover(null)
		setActiveHighlight(null)
		setActiveId(null)
	}, [])

	// ---- selection ----
	// Stable: the selection watcher starts over whenever it changes.
	const onSelect = useCallback(
		(next: ArticleSelection) => {
			// One word can only be asked about.
			if (!aiEnabled && !isHighlightable(next.selector.exact)) return
			const rect = firstRect(next.range)
			if (!rect) return
			closePopover()
			setSelection({ selection: next, rect, scrollY: window.scrollY })
		},
		[closePopover, aiEnabled],
	)
	const highlightSelection = (selected: ArticleSelection) => {
		window.getSelection()?.removeAllRanges()
		setSelection(null)
		createHighlight(selected.selector)
	}
	// ---- AI ----
	const ask = (passage: Omit<AiPassage, "versionId">, action: AiThreadAction, typed = "") => {
		if (!doc.currentVersionId) return
		engage()
		closePopover()
		setSelection(null)
		window.getSelection()?.removeAllRanges()
		ai.start({ ...passage, versionId: doc.currentVersionId }, action, typed)
	}
	const askAboutSelection = (selected: ArticleSelection, action: AiThreadAction, typed = "") =>
		ask(selected.selector, action, typed)
	// With a selection, typing starts an Ask with what was typed ("Or just start typing").
	const typingSelection = aiEnabled ? selection?.selection : undefined
	const latestAsk = useRef(askAboutSelection)
	useInsertionEffect(() => {
		latestAsk.current = askAboutSelection
	})
	useEffect(() => {
		if (!typingSelection) return
		const onKey = (e: KeyboardEvent) => {
			// A printable key starts a question; Space still scrolls.
			if (e.key.length !== 1 || e.key === " " || e.metaKey || e.ctrlKey || e.altKey) return
			if (e.isComposing) return
			const target = e.target as HTMLElement | null
			if (target?.closest("input, textarea, [contenteditable='true']")) return
			e.preventDefault()
			e.stopImmediatePropagation()
			latestAsk.current(typingSelection, "ask", e.key)
		}
		window.addEventListener("keydown", onKey, true)
		return () => window.removeEventListener("keydown", onKey, true)
	}, [typingSelection])
	const citeIn = (card: Pick<Card, "versionId">) => (citation: AiCitation) => {
		const root = contentRef.current
		if (!root || card.versionId !== doc.currentVersionId) return
		const range = rangeFromOffsets(root, citation.start, citation.end)
		if (!range) return
		scrollRangeIntoView(range)
		flashCited(range)
	}
	const clearChat = (id: string) =>
		ai.remove(id, () =>
			showToast({
				message: t("ai.chat.cleared"),
				undo: {
					action: `/documents/${doc.id}/ai`,
					intent: "restore",
					fields: { id },
					label: tl("toast.undo"),
				},
			}),
		)
	const deleteThread = (id: string) =>
		ai.remove(id, () =>
			showToast({
				message: t("ai.deleted"),
				undo: {
					action: `/documents/${doc.id}/ai`,
					intent: "restore",
					fields: { id },
					label: tl("toast.undo"),
				},
			}),
		)
	const aiCard = (card: Card, placement: AiCardPlacement) => (
		<AiCard
			key={card.id}
			card={card}
			written={ai.written}
			open={card.id === ai.openId}
			placement={placement}
			canCite={card.versionId === doc.currentVersionId}
			hovered={hoveredThread === card.id}
			onOpen={() => {
				closePopover()
				ai.open(card.id)
			}}
			onClose={ai.close}
			onSend={(text) => ai.send(card.id, text)}
			onRetry={() => ai.retry(card.id)}
			onDelete={() => deleteThread(card.id)}
			onCopy={(text) => copyText(text, t("highlights.popover.copied"))}
			onCite={citeIn(card)}
			onHover={(on) => setHoveredThread(on ? card.id : null)}
		/>
	)

	const copySelection = (selected: ArticleSelection) => {
		copyText(rangeText(selected.range), t("highlights.popover.copied"))
		setSelection(null)
	}

	// ---- links ----
	const links = useArticleLinks(
		contentRef,
		data.savedLinks,
		() => popover !== null || resize.guard.current,
	)

	// ---- pointer ----
	const onContentClick = (e: React.MouseEvent) => {
		if (resize.guard.current) {
			e.preventDefault()
			return
		}
		if (links.onClick(e)) {
			setPopover(null)
			return
		}
		if (window.getSelection()?.isCollapsed === false) return
		const hits = highlightsAtPoint(rangesRef.current, e.clientX, e.clientY)
		const id = hits.find((id) => !isTemporary(id))
		if (!id) {
			// An underlined passage opens its thread's card.
			const thread = highlightsAtPoint(threadRangesRef.current, e.clientX, e.clientY)[0]
			if (thread) {
				e.preventDefault()
				closePopover()
				ai.open(thread)
			}
			return
		}
		const range = rangesRef.current.get(id)
		const rect = range ? firstRect(range) : null
		if (!rect || !range) return
		e.preventDefault()
		setActiveId(id)
		setActiveHighlight(range)
		setPopover(popoverAt(id, rect))
	}
	const selectFromSidebar = (id: string) => {
		if (resize.guard.current) return
		const range = rangesRef.current.get(id)
		if (!range) return
		scrollRangeIntoView(range)
		setActiveHighlight(range)
		setActiveId(id)
		focusResize(id)
		setResizeFocus(id)
		// Below lg the sidebar covers the article: get it out of the way once it has navigated.
		if (!window.matchMedia("(min-width: 64rem)").matches) {
			note.flush()
			setSidebarOpen(false)
		}
	}

	const popoverItem = popover ? items.find((h) => h.id === popover.id) : null
	const editingItem = editingId ? items.find((h) => h.id === editingId) : null
	const focusItem = popoverItem ?? editingItem

	// ⌘C with nothing selected copies the highlight in focus: the one just made (a temporary item
	// while its request is on its way; its selection went the moment it became a highlight), the
	// one whose toolbar is open, or the one reached from the sidebar or a link.
	const inFocus =
		items.find((h) => isTemporary(h.id)) ??
		popoverItem ??
		(activeId ? items.find((h) => h.id === activeId) : null)
	const copyHighlight = useHighlightCopy(
		rangesRef,
		inFocus ? { id: inFocus.id, exact: inFocus.exact } : null,
	)

	// The highlight that stands out: the one hovered, else the one in focus.
	const outlinedId = resize.state === "pointer" ? null : (hoveredId ?? activeId)
	const outlined = outlinedId ? items.find((h) => h.id === outlinedId) : null
	// The mark at full strength while one is in focus: a hovered note's highlight, else the one in focus.
	const marked = (hoveredNote ? items.find((h) => h.id === hoveredNote) : null) ?? focusItem

	// ---- notes in the margin, next to their highlights ----
	const marginRoom = useMarginRoom(articleRef, supported)
	const marginItems = marginRoom
		? items.filter((h) => (h.note || h.id === editingId) && !isTemporary(h.id))
		: []
	const shownCards = passageCards.filter((c) => !c.orphaned && c.versionId === doc.currentVersionId)
	const briefCard = (
		<BriefCard
			brief={brief.brief}
			writing={brief.writing}
			failure={brief.failure}
			open={brief.open}
			written={brief.written}
			onOpen={brief.setOpen}
			onMake={() => void brief.make()}
			onCopy={(text) => copyText(text, t("highlights.popover.copied"))}
			onCite={citeIn({ versionId: doc.currentVersionId ?? "" })}
		/>
	)
	const marginCards: MarginCard[] = marginRoom
		? shownCards.map((card) => ({
				id: card.id,
				start: card.start,
				front: card.id === ai.openId,
				node: aiCard(card, { kind: "margin" }),
			}))
		: []
	const openCard = ai.openId ? shownCards.find((c) => c.id === ai.openId) : undefined
	const openCardPlacement = (): AiCardPlacement =>
		touch || !openRect ? { kind: "sheet" } : { kind: "floating", rect: openRect }
	// Hovering a note marks its highlight; hovering a highlight marks its note.
	const hoverNote = (id: string | null) => {
		if (resize.guard.current) return
		setHoveredId(id)
		setHoveredNote(id)
		const shown = id ?? activeId
		setActiveHighlight(shown ? (rangesRef.current.get(shown) ?? null) : null)
	}
	// Match the handles' pointer events: text exit must run before handle entry cancels the timer.
	const onContentPointerMove = (e: React.PointerEvent) => {
		if (resize.guard.current || touch || e.pointerType !== "mouse") return
		const hits = highlightsAtPoint(rangesRef.current, e.clientX, e.clientY)
		resize.hover(hits.find((id) => !isTemporary(id)) ?? null)
		if (marginRoom) {
			setHoveredId(hits.find((hit) => items.find((h) => h.id === hit)?.note) ?? null)
			setHoveredThread(highlightsAtPoint(threadRangesRef.current, e.clientX, e.clientY)[0] ?? null)
		}
	}
	const noteEditor = (
		item: { id: string; note?: string | null; color?: number },
		placement: NoteEditorPlacement,
	) => (
		<HighlightNoteEditor
			key={item.id}
			initial={item.note ?? ""}
			color={item.color}
			tilt={tiltFor(item.id)}
			placement={placement}
			// In the margin, against the article, as the note it edits.
			className={placement.kind === "margin" ? "mr-auto" : undefined}
			documentId={doc.id}
			linkTargets={linkTargets}
			onSave={(text) => {
				saveNote(item.id, text)
				closeNote()
			}}
			onCancel={closeNote}
		/>
	)

	return (
		<AiAllowanceContext.Provider value={allowance.allowance}>
			<AiResetsOnContext.Provider value={data.ai.resetsOn}>
				<article
					ref={articleRef}
					className={cn("reader relative mx-auto px-4 pt-8 pb-32 sm:px-6", readerClassNames(prefs))}
					lang={doc.language ?? undefined}
				>
					{header}
					{!supported ? (
						<p className="mb-6 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-fg">
							{t("highlights.errors.unsupported")}
						</p>
					) : null}
					{updating ? (
						<p
							role="status"
							className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-fg"
						>
							<Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
							{t("pending.updating")}
						</p>
					) : null}
					{/* Between the header and the text: it doesn't take the margin's top from the cards. */}
					{aiEnabled ? briefCard : null}
					{/* The text and its ink, which goes under it: isolated, so the ink stays above the page. */}
					<div ref={inkRef} className="relative isolate">
						<div
							ref={contentRef}
							onClick={onContentClick}
							onPointerMove={onContentPointerMove}
							onPointerLeave={(e) => {
								if (e.pointerType !== "mouse") return
								resize.hover(null)
								setHoveredThread(null)
								if (!resize.guard.current) setHoveredId(null)
							}}
							// While a highlight's toolbar or note editor is open, the others dim (app.css).
							data-focus={resize.state !== "pointer" && focusItem ? "true" : undefined}
							data-resizing={resize.state === "pointer" ? "true" : undefined}
							// Its color, for the mark in focus (`klip-active`).
							{...(marked ? highlightColor(marked.color) : {})}
							className="reader-content prose max-w-none"
							dangerouslySetInnerHTML={{ __html: html }}
						/>
						{supported ? (
							<HighlightInk
								rootRef={contentRef}
								containerRef={inkRef}
								outlined={outlined && !isTemporary(outlined.id) ? outlined.id : null}
							/>
						) : null}
					</div>
					{!touch && supported ? (
						<HighlightResizeHandles
							resize={resize}
							articleRef={articleRef}
							rootRef={contentRef}
							headerRef={headerRef}
							disabled={updating || highlights.pending}
							onFocus={focusResize}
							focusId={resizeFocus}
							onFocused={() => setResizeFocus(null)}
						/>
					) : null}
					{marginRoom ? (
						<MarginNotes
							articleRef={articleRef}
							paused={resize.state === "pointer"}
							rangesRef={rangesRef}
							items={marginItems}
							editingId={editingId}
							hoveredId={hoveredId}
							linkTargets={linkTargets}
							from={location.pathname}
							onOpen={openNote}
							onHover={hoverNote}
							renderEditor={(item) => noteEditor(item, { kind: "margin" })}
							cards={marginCards}
							cardRangesRef={threadRangesRef}
						/>
					) : null}
					{footer(note)}
				</article>
				<ReaderOutline
					contentRef={contentRef}
					articleRef={articleRef}
					headerRef={headerRef}
					html={html}
					pinned={prefs.outline === "on"}
					state={outline}
				/>
				<SelectionWatcher
					rootRef={contentRef}
					onSelect={onSelect}
					disabled={!supported || updating || resize.state !== "idle"}
					interactionGuard={resize.guard}
				/>
				{selection && !popover && resize.state === "idle" ? (
					<SelectionToolbar
						rect={selection.rect}
						scrollY={selection.scrollY}
						disabled={updating || highlights.pending}
						onHighlight={() => highlightSelection(selection.selection)}
						canHighlight={isHighlightable(selection.selection.selector.exact)}
						onAsk={
							aiEnabled ? (action) => askAboutSelection(selection.selection, action) : undefined
						}
						onCopy={() => copySelection(selection.selection)}
						onClose={() => setSelection(null)}
					/>
				) : null}
				{links.card ? (
					<LinkPopover
						link={links.card}
						previews={links.previews}
						from={location.pathname}
						onSaved={links.onSaved}
						onClose={links.close}
						hover={links.hover}
						onPin={links.pin}
					/>
				) : null}
				{popover && popoverItem && resize.state !== "pointer" ? (
					<HighlightToolbar
						highlight={popoverItem}
						disabled={resize.blocked(popoverItem.id)}
						rect={popover.rect}
						scrollY={popover.scrollY}
						onColor={(color) => setColor(popoverItem.id, color)}
						onNote={() => openNote(popoverItem.id)}
						onCopy={() => copyHighlight(popoverItem.id, popoverItem.exact)}
						onDelete={() => removeHighlight(popoverItem.id)}
						onAsk={
							aiEnabled
								? (action) =>
										ask(
											{
												exact: popoverItem.exact,
												prefix: popoverItem.prefix,
												suffix: popoverItem.suffix,
												start: popoverItem.startOffset,
												end: popoverItem.endOffset,
												highlightId: popoverItem.id,
											},
											action,
										)
								: undefined
						}
						onClose={() => {
							resize.dismiss()
							closePopover()
						}}
					/>
				) : null}
				{openCard && !marginRoom ? aiCard(openCard, openCardPlacement()) : null}
				{editingItem && !marginRoom
					? noteEditor(editingItem, noteEditorPlacement(touch, editingRange))
					: null}
				{sidebarOpen ? (
					<ReaderSidebar
						note={{
							value: note.value,
							status: note.status,
							onChange: note.change,
							onFlush: note.flush,
						}}
						items={items}
						activeId={activeId}
						documentId={doc.id}
						linkTargets={linkTargets}
						backlinks={data.backlinks}
						contentLinks={data.contentLinks}
						from={location.pathname}
						font={prefs.font}
						onSelect={selectFromSidebar}
						onClose={() => {
							note.flush()
							setSidebarOpen(false)
						}}
						tab={sidebarTab}
						onTab={(tab) => tab !== sidebarTab && showSidebarTab(tab)}
						chat={
							aiEnabled ? (
								<ChatPanel
									active={sidebarTab === "chat"}
									chat={chatCard}
									written={ai.written}
									canCite={chatCard?.versionId === doc.currentVersionId}
									onAsk={(text) => ai.chat(text, doc.currentVersionId ?? "")}
									onRetry={() => chatCard && ai.retry(chatCard.id)}
									onClear={() => chatCard && clearChat(chatCard.id)}
									onCopy={(text) => copyText(text, t("highlights.popover.copied"))}
									onCite={chatCard ? citeIn(chatCard) : () => {}}
								/>
							) : undefined
						}
					/>
				) : null}
				<div role="status" aria-live="polite" className="sr-only">
					{resize.status}
				</div>
				{resize.failure ? (
					<div
						role="alert"
						className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-danger px-4 py-3 text-sm text-danger-fg shadow-lg"
					>
						{t(`highlights.resize.errors.${resizeError(resize.failure)}`)}
						<button
							type="button"
							className="ml-3 underline"
							disabled={resize.refreshing}
							onClick={resize.retry}
						>
							{t("highlights.resize.retry")}
						</button>
					</div>
				) : null}
				{highlights.error ? (
					<output className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-danger px-3 py-2 text-sm text-danger-fg shadow-lg">
						{t(`highlights.errors.${highlights.error}`)}
					</output>
				) : null}
			</AiResetsOnContext.Provider>
		</AiAllowanceContext.Provider>
	)
}
