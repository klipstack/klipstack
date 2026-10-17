import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { EndState } from "@klipstack/api-contract/reading"
import { Check, Newspaper, NotebookPen, Star } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import { EditionTextField } from "~/components/edition-text-field"
import { NoteField } from "~/components/note-field"
import { ArticleNoteLabel, NoteStatus } from "~/components/note-status"
import { PostIt, tiltFor, useGrowingFit } from "~/components/post-it"
import { ReadStamp } from "~/components/read-stamp"
import { tooltip } from "~/components/tooltip-host"
import { useAutosaveText } from "~/hooks/use-autosave-text"
import type { StateIntent } from "~/hooks/use-document-state"
import type { ArticleNote } from "~/hooks/use-note-autosave"
import { editionNoteFromNote } from "~/lib/edition-text"
import { fitsKeepalive } from "~/lib/keepalive"
import type { LinkTargets } from "~/lib/note-links"
import { SHORTCUT_HINTS, SUBMIT_HINT } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

/**
 * The end of the article, in the page after its last paragraph: in one line, that it is the end
 * and whether leaving finishes it, with a way to keep it as it is. Then the reader's own note, on
 * its post-it, asking what they take from the article (the sidebar's note: one text, either editor),
 * and the star and the mark for the next edition, with their names. Marked, it says so, and offers
 * a rough note for the edition's readers while the article is fresh in mind, which can start from
 * the private one, and Done, to leave; marked with its button here, the page scrolls to them.
 * With editions off, only the star. `onReached` once it comes into view. Give it a `key` per article: the edition note is read once.
 */
export function ReaderEnd({
	documentId,
	note,
	linkTargets,
	editions,
	editionNote,
	state,
	archived,
	starred,
	shortlisted,
	onReached,
	onChange,
	onKeep,
	onFinish,
	back,
}: {
	documentId: string
	/** The reader's private note on the article, shared with the sidebar's editor. */
	note: ArticleNote
	linkTargets: LinkTargets
	/** Editions are turned on for the account: the mark and the edition note show. */
	editions: boolean
	/** What the user wrote for the edition's readers so far. */
	editionNote: string | null
	state: EndState
	/** In the archive already: leaving only marks it finished. */
	archived: boolean
	starred: boolean
	/** Marked for the next edition. */
	shortlisted: boolean
	onReached: () => void
	onChange: (intent: StateIntent) => void
	onKeep: (keep: boolean) => void
	onFinish: () => void
	/** Where Done goes: back where the reader came from, as the back button does. */
	back: { to: string; state: unknown }
}) {
	const { t } = useTranslation("reader")
	const ref = useRef<HTMLElement>(null)
	const reached = useRef(onReached)
	useEffect(() => {
		reached.current = onReached
	})
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				reached.current()
				observer.disconnect()
			}
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	// An empty note is as wide as its question.
	const noteFit = useGrowingFit(note.value || t("end.notePlaceholder"), documentId)

	// Kept while unmarked, so marking again shows what was typed.
	const edition = useAutosaveText(editionNote ?? "", async (text, { keepalive }) => {
		const body = JSON.stringify({ note: text })
		const res = await fetch(`/documents/${documentId}/edition-note`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			keepalive: keepalive && fitsKeepalive(body),
		})
		if (!res.ok) throw new Error(`edition note save failed: ${res.status}`)
	})

	// ⌘↵ in the note is Done: the note goes out on the way back, as with the link.
	const navigate = useNavigate()
	const leave = () => {
		edition.flush()
		void navigate(back.to, { state: back.state })
	}

	// Marked with the button below: what it opened scrolls into view, rather than wait below the
	// window.
	const marked = useRef<HTMLDivElement>(null)
	const scrollToMarked = useRef(false)
	useEffect(() => {
		if (!shortlisted || !scrollToMarked.current) return
		scrollToMarked.current = false
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
		marked.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" })
	}, [shortlisted])

	// "Start from my note": the private note goes into the edition's, to edit there. The editor reads
	// its text once, so it starts over with the new text, ready to type.
	const fromNote = editionNoteFromNote(edition.value, note.value, NOTE_MAX)
	const [editionRev, setEditionRev] = useState(0)
	const startFromNote = () => {
		if (fromNote === null) return
		edition.change(fromNote)
		setEditionRev((rev) => rev + 1)
	}
	const editionLabel = useId()

	const done = state === "finished" || state === "finishing"
	const link =
		"font-medium text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
	return (
		<section
			ref={ref}
			data-testid="reader-end"
			data-state={state}
			// What comes after the article: reading progress is full above it.
			data-after-reading
			className="mt-12 grid gap-4 border-t border-border pt-6 font-sans"
		>
			{/* Where the reader stands, in one line: the end, and what leaving does. */}
			<p data-testid="reader-end-status" className="text-sm leading-6 text-muted-fg">
				<span className="mr-1.5 inline-flex items-center gap-2 align-top text-base font-semibold text-fg">
					{done ? (
						<span className="grid size-6 place-items-center rounded-full bg-accent text-accent-fg">
							<Check className="size-3.5" strokeWidth={3} aria-hidden />
						</span>
					) : null}
					{done ? t("end.finished") : t("end.reached")}
					{/* Stamped as its card is, the same way: the heading already says it. */}
					{done ? <ReadStamp tilt={tiltFor(documentId)} decorative className="ml-1" /> : null}
				</span>{" "}
				{state === "finishing" ? (
					<>
						{archived ? t("end.onLeave") : t("end.toArchive")}{" "}
						<button type="button" className={link} onClick={() => onKeep(true)}>
							{archived ? t("end.keepUnfinished") : t("end.keep")}
						</button>
					</>
				) : null}
				{state === "kept" ? (
					<>
						{archived ? t("end.keptUnfinished") : t("end.kept")}{" "}
						<button type="button" className={link} onClick={() => onKeep(false)}>
							{t("end.finishOnLeave")}
						</button>
					</>
				) : null}
			</p>
			{state === "early" ? (
				<button
					type="button"
					data-testid="reader-end-finish"
					onClick={onFinish}
					className="inline-flex items-center justify-center gap-2 justify-self-start rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
				>
					<Check className="size-4" aria-hidden />
					{t("end.finish")}
				</button>
			) : null}
			{/* The reader's own note, the sidebar's: what they take from the article, for no one else. */}
			<div data-testid="reader-end-note" className="grid max-w-md gap-2">
				<div className="flex items-center justify-between gap-2 text-xs">
					<ArticleNoteLabel />
					<NoteStatus status={note.status} onRetry={note.flush} />
				</div>
				<PostIt
					fit={noteFit}
					tilt={tiltFor(documentId)}
					className="mt-2 mb-2 text-lg leading-snug focus-within:ring-2 focus-within:ring-ring"
				>
					<NoteField
						aria-label={t("highlights.sidebar.note")}
						value={note.value}
						maxLength={NOTE_MAX}
						onChange={note.change}
						onBlur={note.flush}
						documentId={documentId}
						linkTargets={linkTargets}
						placeholder={t("end.notePlaceholder")}
						className="block max-h-[60vh] min-h-16 w-full overflow-y-auto"
					/>
				</PostIt>
			</div>
			<div className="grid max-w-sm grid-cols-2 gap-2">
				<button
					type="button"
					onClick={() => onChange(starred ? "unstar" : "star")}
					{...tooltip(starred ? t("actions.unstar") : t("actions.star"), SHORTCUT_HINTS.star)}
					aria-pressed={starred}
					className="flex items-center justify-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm text-fg hover:bg-fg/10"
				>
					<Star
						className={cn("size-4", starred ? "fill-favorite text-favorite" : "text-muted-fg")}
						aria-hidden
					/>
					{starred ? t("end.starred") : t("end.star")}
				</button>
				{editions ? (
					<button
						type="button"
						data-testid="reader-end-shortlist"
						onClick={() => {
							scrollToMarked.current = !shortlisted
							onChange(shortlisted ? "unshortlist" : "shortlist")
						}}
						{...tooltip(
							shortlisted ? t("actions.unshortlist") : t("actions.shortlist"),
							SHORTCUT_HINTS.shortlist,
						)}
						aria-pressed={shortlisted}
						className={cn(
							"flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm",
							shortlisted
								? "bg-accent text-accent-fg"
								: "bg-muted text-fg hover:bg-fg/10 [&>svg]:text-muted-fg",
						)}
					>
						<Newspaper className="size-4" aria-hidden />
						{shortlisted ? t("end.shortlisted") : t("end.shortlist")}
					</button>
				) : null}
			</div>
			{editions && shortlisted ? (
				<div
					ref={marked}
					data-testid="reader-end-edition-note"
					className="grid max-w-xl scroll-mb-8 gap-3 rounded-xl border border-border bg-card p-4"
				>
					<p className="flex items-center gap-2 text-sm font-medium">
						<span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
							<Check className="size-3" strokeWidth={3} aria-hidden />
						</span>
						{t("end.added")}
					</p>
					<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
						<span id={editionLabel} className="text-xs font-medium text-muted-fg">
							{t("end.editionNote")}
						</span>
						{fromNote !== null ? (
							<button
								type="button"
								data-testid="reader-end-from-note"
								onClick={startFromNote}
								className="-mr-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-link hover:bg-hover"
							>
								<NotebookPen className="size-3.5" aria-hidden />
								{t("end.startFromNote")}
							</button>
						) : null}
					</div>
					<EditionTextField
						key={editionRev}
						aria-labelledby={editionLabel}
						autoFocus={editionRev > 0}
						value={edition.value}
						placeholder={t("end.editionNotePlaceholder")}
						maxLength={NOTE_MAX}
						onChange={edition.change}
						onBlur={edition.flush}
						onSubmit={leave}
						className="min-h-[5.5rem] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex items-center justify-between gap-3">
						{/* Saving is shown, not announced: a screen reader hears only a failure. */}
						{edition.status === "error" ? (
							<p role="alert" className="text-xs text-danger">
								{t("end.editionNoteFailed")}
							</p>
						) : (
							<p className="text-xs text-muted-fg">
								{t(
									edition.status === "saving"
										? "end.editionNoteSaving"
										: edition.status === "saved"
											? "end.editionNoteSaved"
											: "end.editionNoteAutosave",
								)}
							</p>
						)}
						{/* Saving needs no button. Done is for leaving: the note goes out on the way. */}
						<Link
							to={back.to}
							state={back.state}
							data-testid="reader-end-done"
							onClick={edition.flush}
							{...tooltip(t("end.done"), SUBMIT_HINT)}
							className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg"
						>
							{t("end.done")}
						</Link>
					</div>
				</div>
			) : null}
		</section>
	)
}
