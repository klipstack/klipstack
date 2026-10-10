import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { EndState } from "@klipstack/api-contract/reading"
import { Check, Newspaper, Star } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router"
import { EditionTextField } from "~/components/edition-text-field"
import { tooltip } from "~/components/tooltip-host"
import { useAutosaveText } from "~/hooks/use-autosave-text"
import type { StateIntent } from "~/hooks/use-document-state"
import { SHORTCUT_HINTS, SUBMIT_HINT } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

/** Browsers cap keepalive request bodies at 64 KiB; longer notes go out as a normal request. */
const KEEPALIVE_MAX = 60_000

/**
 * The end of the article, in the page after its last paragraph: whether leaving finishes it, a way
 * to keep it as it is, and the star and the mark for the next edition, with their names. Marked,
 * it says so, and offers a rough note for the edition's readers while the article is fresh in mind,
 * and Done, to leave; marked with its button here, the page scrolls to them. `onReached` once it comes into view. Give
 * it a `key` per article: the note is read once.
 */
export function ReaderEnd({
	documentId,
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

	// Kept while unmarked, so marking again shows what was typed.
	const note = useAutosaveText(editionNote ?? "", async (text, { keepalive }) => {
		const body = JSON.stringify({ note: text })
		const res = await fetch(`/documents/${documentId}/edition-note`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			keepalive: keepalive && body.length < KEEPALIVE_MAX,
		})
		if (!res.ok) throw new Error(`edition note save failed: ${res.status}`)
	})

	// ⌘↵ in the note is Done: the note goes out on the way back, as with the link.
	const navigate = useNavigate()
	const leave = () => {
		note.flush()
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

	const done = state === "finished" || state === "finishing"
	const link =
		"font-medium text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
	return (
		<section
			ref={ref}
			data-testid="reader-end"
			data-state={state}
			className="mt-12 grid gap-4 border-t border-border pt-6 font-sans"
		>
			<div className="flex items-center gap-2 text-base font-semibold">
				{done ? (
					<span className="grid size-6 place-items-center rounded-full bg-accent text-accent-fg">
						<Check className="size-3.5" strokeWidth={3} aria-hidden />
					</span>
				) : null}
				{done ? t("end.finished") : t("end.reached")}
			</div>
			{state === "finishing" ? (
				<p className="text-sm text-muted-fg">
					{archived ? t("end.onLeave") : t("end.toArchive")}{" "}
					<button type="button" className={link} onClick={() => onKeep(true)}>
						{archived ? t("end.keepUnfinished") : t("end.keep")}
					</button>
				</p>
			) : null}
			{state === "kept" ? (
				<p className="text-sm text-muted-fg">
					{archived ? t("end.keptUnfinished") : t("end.kept")}{" "}
					<button type="button" className={link} onClick={() => onKeep(false)}>
						{t("end.finishOnLeave")}
					</button>
				</p>
			) : null}
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
							? "bg-selected text-selected-fg"
							: "bg-muted text-fg hover:bg-fg/10 [&>svg]:text-muted-fg",
					)}
				>
					<Newspaper className="size-4" aria-hidden />
					{shortlisted ? t("end.shortlisted") : t("end.shortlist")}
				</button>
			</div>
			{shortlisted ? (
				<div
					ref={marked}
					data-testid="reader-end-edition-note"
					className="grid max-w-xl scroll-mb-8 gap-3 rounded-xl border border-border bg-card p-4"
				>
					<p id="edition-note-label" className="flex items-center gap-2 text-sm font-medium">
						<span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
							<Check className="size-3" strokeWidth={3} aria-hidden />
						</span>
						{t("end.added")}
					</p>
					<EditionTextField
						aria-label={t("end.editionNote")}
						value={note.value}
						placeholder={t("end.editionNotePlaceholder")}
						maxLength={NOTE_MAX}
						onChange={note.change}
						onBlur={note.flush}
						onSubmit={leave}
						className="min-h-[5.5rem] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex items-center justify-between gap-3">
						<p role="status" className="text-xs text-muted-fg">
							{note.status === "error" ? (
								<span className="text-danger">{t("end.editionNoteFailed")}</span>
							) : (
								t(
									note.status === "saving"
										? "end.editionNoteSaving"
										: note.status === "saved"
											? "end.editionNoteSaved"
											: "end.editionNoteAutosave",
								)
							)}
						</p>
						{/* Saving needs no button. Done is for leaving: the note goes out on the way. */}
						<Link
							to={back.to}
							state={back.state}
							data-testid="reader-end-done"
							onClick={note.flush}
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
