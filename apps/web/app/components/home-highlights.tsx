import { EyeOff, StickyNote } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useFetchers } from "react-router"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import type { LinkTargets } from "~/lib/note-links"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { ResurfacedHighlight } from "~/services/resurfacing.server"
import { HighlightNoteEditor } from "./highlight-note-editor"
import { MARGIN_NOTE } from "./margin-notes"
import { NoteText } from "./note-text"
import { PostIt } from "./post-it"

const ACTION = "/home/highlights"

/** An article without a title or a site name goes by its address's host. */
function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "")
	} catch {
		return url
	}
}

/** Highlights on their way out ("Not useful anymore" pressed, not yet answered). */
function useLeaving(): Set<string> {
	return new Set(
		useFetchers()
			.filter((f) => f.formAction === ACTION && f.formData?.get("intent") === "dismiss")
			.map((f) => String(f.formData?.get("id"))),
	)
}

/**
 * "From your highlights": a few of the reader's highlights a day (`dailyHighlights`), each with its
 * note and its article. A note is written or changed in place, on its post-it; "Not useful anymore"
 * stops a highlight coming back, with undo. Nothing to show, no card.
 */
export function HomeHighlights({
	items,
	linkTargets,
}: {
	items: ResurfacedHighlight[]
	linkTargets: LinkTargets
}) {
	const { t } = useTranslation("library")
	const leaving = useLeaving()
	const shown = items.filter((h) => !leaving.has(h.id))
	if (!shown.length) return null
	return (
		<section aria-labelledby="home-highlights" data-testid="home-highlights">
			<h2 id="home-highlights" className="section-title">
				{t("home.highlights.title")}
			</h2>
			<p className="mt-1 mb-5 text-sm text-muted-fg">{t("home.highlights.description")}</p>
			<ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{shown.map((h) => (
					<HighlightCard key={h.id} h={h} linkTargets={linkTargets} />
				))}
			</ul>
		</section>
	)
}

function HighlightCard({ h, linkTargets }: { h: ResurfacedHighlight; linkTargets: LinkTargets }) {
	const { t } = useTranslation("library")
	const [editing, setEditing] = useState(false)
	const save = useFetcher({ key: `home-highlight-note-${h.id}` })
	const dismiss = useFetcher({ key: `home-highlight-${h.id}` })
	// The note being saved shows at once.
	const pending = save.formData?.get("note")
	const note = typeof pending === "string" ? pending.trim() || null : h.note
	const title = h.documentTitle || h.siteName || hostOf(h.sourceUrl)
	// A note that did not save says so.
	const answer = save.data as { ok?: boolean } | undefined
	useEffect(() => {
		if (save.state !== "idle" || !answer || answer.ok) return
		showToast({ message: t("home.highlights.noteFailed"), warn: true })
	}, [save.state, answer, t])
	const href = `/read/${h.documentId}#h=${h.id}`
	const saveNote = (text: string) => {
		setEditing(false)
		void save.submit(
			{ intent: "update", id: h.id, note: text },
			{ method: "post", action: `/documents/${h.documentId}/highlights` },
		)
	}
	const open = () => {
		// Selecting text in the note is not a request to edit it.
		if (window.getSelection()?.isCollapsed === false) return
		setEditing(true)
	}

	return (
		<li
			data-testid="home-highlight"
			{...highlightColor(h.color)}
			className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4"
		>
			<Link
				to={href}
				state={{ from: "/home" }}
				className="group block font-serif text-[1.05rem] leading-relaxed text-fg"
			>
				<span
					data-testid="home-highlight-quote"
					className="line-clamp-8 [&>span]:box-decoration-clone"
				>
					<span className="marker group-hover:underline group-hover:decoration-(--hl-solid)">
						{h.exact}
					</span>
				</span>
			</Link>
			{editing ? (
				<HighlightNoteEditor
					initial={note ?? ""}
					color={h.color}
					placement={{ kind: "margin" }}
					documentId={h.documentId}
					linkTargets={linkTargets}
					onSave={saveNote}
					onCancel={() => setEditing(false)}
				/>
			) : note ? (
				// Not a <button>: a note holds links, and a link inside a button is invalid HTML.
				<PostIt
					variant="compact"
					fit={note}
					color={highlightColorName(h.color)}
					role="button"
					tabIndex={0}
					data-testid="home-highlight-note"
					onClick={(e) => {
						// A chip opens its article; only the note itself opens the editor.
						if ((e.target as Element).closest("a")) return
						open()
					}}
					onKeyDown={(e) => {
						if (e.key !== "Enter" && e.key !== " ") return
						if ((e.target as Element).closest("a")) return
						e.preventDefault()
						setEditing(true)
					}}
					className={cn(
						MARGIN_NOTE,
						"cursor-text select-text text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					)}
				>
					<span className="line-clamp-6">
						<NoteText text={note} linkTargets={linkTargets} from="/home" />
					</span>
				</PostIt>
			) : null}
			<div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
				<p className="min-w-0 flex-1 basis-40 truncate text-xs text-muted-fg">
					<Link
						to={href}
						state={{ from: "/home" }}
						aria-label={t("home.highlights.openLabel", { title })}
						className="hover:text-fg hover:underline"
					>
						{title}
					</Link>
					{h.siteName && h.siteName !== title ? ` · ${h.siteName}` : null}
				</p>
				<div className="-mr-1.5 flex items-center gap-1">
					{note || editing ? null : (
						<button
							type="button"
							onClick={() => setEditing(true)}
							className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg"
						>
							<StickyNote className="size-3.5" aria-hidden />
							{t("home.highlights.addNote")}
						</button>
					)}
					<dismiss.Form
						method="post"
						action={ACTION}
						onSubmit={() =>
							showToast({
								message: t("home.highlights.dismissed"),
								undo: {
									action: ACTION,
									intent: "restore",
									fields: { id: h.id },
									label: t("toast.undo"),
								},
							})
						}
					>
						<input type="hidden" name="intent" value="dismiss" />
						<input type="hidden" name="id" value={h.id} />
						<button
							type="submit"
							className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-fg hover:bg-muted hover:text-fg"
						>
							<EyeOff className="size-3.5" aria-hidden />
							{t("home.highlights.dismiss")}
						</button>
					</dismiss.Form>
				</div>
			</div>
		</li>
	)
}
