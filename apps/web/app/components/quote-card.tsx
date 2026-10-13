import { StickyNote, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { highlightColor } from "~/lib/highlight-colors"
import type { LinkTargets } from "~/lib/note-links"
import { safeHost, sourceLabel } from "~/lib/site-label"
import { LONG_UNDO_MS, showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { HighlightListItem } from "~/services/highlights.server"
import { HighlightNoteEditor } from "./highlight-note-editor"
import { NoteText } from "./note-text"
import { PostIt, tiltFor } from "./post-it"
import { tooltip } from "./tooltip-host"

/** Short quotes read large; long ones step down so a card stays a card. */
function quoteSize(text: string): string {
	if (text.length <= 90) return "text-2xl leading-snug"
	if (text.length <= 220) return "text-xl leading-snug"
	return "line-clamp-[14] text-lg leading-normal"
}

/** A dealt hand lies a little askew, as cards on a table do. */
const DEALT = ["-rotate-1", "rotate-[0.7deg]", "-rotate-[0.4deg]", "rotate-1", "rotate-[0.3deg]"]

/**
 * The highlights board's card: the quote large, in its highlight's color, the note a post-it stuck
 * on it and written on in place, and the article it came from. The whole card opens the highlight in
 * the reader. `withArticle` adds the article's line (not under the article's own heading); `dealt`
 * tilts the card by its place in a Shuffle hand.
 */
export function QuoteCard({
	h,
	linkTargets,
	withArticle = true,
	dealt,
}: {
	h: HighlightListItem
	linkTargets: LinkTargets
	withArticle?: boolean
	dealt?: number
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const fetcher = useFetcher<{ ok: boolean }>()
	const [editing, setEditing] = useState(false)
	const action = `/documents/${h.documentId}/highlights`
	const intent = fetcher.formData?.get("intent")
	const deleting = intent === "delete"
	// The note as saved, or as being saved: it shows at once.
	const note = intent === "update" ? String(fetcher.formData?.get("note") ?? "").trim() : h.note
	// What the last submission was: a note that was not saved says so, and its draft comes back.
	const [submitted, setSubmitted] = useState<{ intent: string; note?: string } | null>(null)
	const [draft, setDraft] = useState<string | null>(null)
	const [failures, setFailures] = useState(0)
	if (fetcher.state === "idle" && fetcher.data?.ok === false && submitted?.intent === "update") {
		setDraft(submitted.note ?? "")
		setEditing(true)
		setSubmitted(null)
		setFailures((n) => n + 1)
	}
	useEffect(() => {
		if (failures) showToast({ message: t("highlights.sidebar.noteFailed"), warn: true })
	}, [failures, t])

	const saveNote = (text: string) => {
		setEditing(false)
		setDraft(null)
		if (text.trim() === (h.note ?? "").trim()) return
		setSubmitted({ intent: "update", note: text })
		void fetcher.submit({ intent: "update", id: h.id, note: text }, { method: "post", action })
	}

	return (
		<li
			{...highlightColor(h.color)}
			data-testid="quote-card"
			className={cn(
				"group relative isolate mb-5 break-inside-avoid rounded-2xl border border-border bg-card px-5 pt-4 pb-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-[box-shadow,transform,opacity] hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.3)]",
				dealt !== undefined && cn(DEALT[dealt % DEALT.length], "hover:rotate-0"),
				deleting && "opacity-40",
			)}
		>
			<span
				aria-hidden
				data-testid="highlight-swatch"
				className="-mb-3 block h-10 font-serif text-6xl leading-none text-(--hl-solid)"
			>
				“
			</span>
			<Link
				to={`/read/${h.documentId}#h=${h.id}`}
				className={cn(
					"block font-serif text-fg after:absolute after:inset-0 after:rounded-2xl after:content-['']",
					quoteSize(h.exact),
				)}
			>
				{/* Marked as it is in the article, line by line. */}
				<span className="rounded-sm bg-(--hl) box-decoration-clone px-0.5">{h.exact}</span>
			</Link>
			{h.orphaned ? <p className="mt-2 text-xs text-danger">{t("highlights.orphaned")}</p> : null}
			{editing ? (
				<div className="relative z-10 mt-5 -mr-2 text-base leading-snug">
					<HighlightNoteEditor
						initial={draft ?? note ?? ""}
						color={h.color}
						variant="full"
						tilt={tiltFor(h.id)}
						placement={{ kind: "margin" }}
						className="ml-auto"
						documentId={h.documentId}
						linkTargets={linkTargets}
						onSave={saveNote}
						onCancel={() => {
							setEditing(false)
							setDraft(null)
						}}
					/>
				</div>
			) : note ? (
				// Not a <button>: a note holds links, and a link inside a button is invalid HTML.
				<PostIt
					fit={note}
					tilt={tiltFor(h.id)}
					role="button"
					tabIndex={0}
					aria-label={t("highlights.popover.editNote")}
					onClick={(e) => {
						// A chip opens its article; only the note itself opens the editor.
						if ((e.target as Element).closest("a")) return
						if (window.getSelection()?.isCollapsed === false) return
						setEditing(true)
					}}
					onKeyDown={(e) => {
						if (e.key !== "Enter" && e.key !== " ") return
						if ((e.target as Element).closest("a")) return
						e.preventDefault()
						setEditing(true)
					}}
					className="z-10 mt-5 -mr-2 ml-auto cursor-text text-base leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<NoteText text={note} linkTargets={linkTargets} />
				</PostIt>
			) : null}
			{withArticle ? <ArticleLine h={h} /> : null}
			<div className="absolute top-2 right-2 z-10 flex gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
				{note || editing ? null : (
					<button
						type="button"
						onClick={() => setEditing(true)}
						aria-label={t("highlights.popover.addNote")}
						{...tooltip(t("highlights.popover.addNote"))}
						className="rounded-md bg-card/80 p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
					>
						<StickyNote className="size-4" aria-hidden />
					</button>
				)}
				<fetcher.Form
					method="post"
					action={action}
					onSubmit={() => {
						setSubmitted({ intent: "delete" })
						showToast({
							message: t(note ? "highlights.toast.removedWithNote" : "highlights.toast.removed"),
							ms: note ? LONG_UNDO_MS : undefined,
							undo: {
								action,
								intent: "restore",
								fields: { id: h.id },
								label: tl("toast.undo"),
							},
						})
					}}
				>
					<input type="hidden" name="intent" value="delete" />
					<input type="hidden" name="id" value={h.id} />
					<button
						type="submit"
						className="rounded-md bg-card/80 p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
						aria-label={t("highlights.popover.delete")}
						{...tooltip(t("highlights.popover.delete"))}
					>
						<Trash2 className="size-4" aria-hidden />
					</button>
				</fetcher.Form>
			</div>
		</li>
	)
}

/** Where the quote comes from: the article's cover (or its site's initial), title and site. */
function ArticleLine({ h }: { h: HighlightListItem }) {
	return (
		<div className="mt-5 flex items-center gap-3 border-t border-border pt-3">
			<ArticleThumb image={h.image} sourceUrl={h.sourceUrl} siteName={h.siteName} />
			<div className="min-w-0 flex-1">
				<Link
					to={`/read/${h.documentId}`}
					className="relative z-10 line-clamp-2 text-sm leading-snug font-medium hover:underline"
				>
					{h.documentTitle ?? h.sourceUrl}
				</Link>
				<p className="truncate text-xs text-muted-fg">{sourceLabel(h)}</p>
			</div>
		</div>
	)
}

/**
 * An article's cover, small, or the first letter of its site on the highlight's wash when it has
 * none. Klipstack keeps no favicons, and fetching one from elsewhere would tell a third party what
 * the reader reads.
 */
export function ArticleThumb({
	image,
	sourceUrl,
	siteName,
	color,
	className,
}: {
	image: string | null
	/** The wash behind the initial; without, the color in hand (`highlightColor`). */
	color?: number
	sourceUrl: string
	siteName: string | null
	className?: string
}) {
	const [broken, setBroken] = useState(false)
	const letter = (siteName?.trim() || safeHost(sourceUrl)).charAt(0).toUpperCase()
	return image && !broken ? (
		<img
			src={image}
			alt=""
			loading="lazy"
			referrerPolicy="no-referrer"
			onError={() => setBroken(true)}
			className={cn("size-10 shrink-0 rounded-lg bg-fg/5 object-cover", className)}
		/>
	) : (
		<span
			{...(color === undefined ? {} : highlightColor(color))}
			aria-hidden
			data-testid="article-monogram"
			className={cn(
				"flex size-10 shrink-0 items-center justify-center rounded-lg bg-(--hl) font-serif text-lg text-fg/80",
				className,
			)}
		>
			{letter}
		</span>
	)
}
