import { NOTE_MAX } from "@klipstack/api-contract/names"
import { ArrowDown, Check, Newspaper, NotebookPen, Star } from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { ArticleNoteLabel } from "~/components/note-status"
import { PostIt, useGrowingFit } from "~/components/post-it"
import { ReadStamp } from "~/components/read-stamp"
import { editionNoteFromNote } from "~/lib/edition-text"
import { cn } from "~/lib/utils"

export interface FinishState {
	/** The private note on the article. */
	note: string
	/** The note for the edition's readers, a separate text. */
	editionNote: string
	starred: boolean
	/** Marked for the next edition. */
	shortlisted: boolean
}

/**
 * The walkthrough's end of the article, as the reader's (`ReaderEnd`) shows it, in its words:
 * finished, the private note on its post-it, the star, and the mark for the next edition, which
 * opens the separate note for the edition's readers. Nothing is required.
 */
export function FinishDemo({
	state,
	onChange,
	nextHref,
}: {
	state: FinishState
	onChange: (state: FinishState) => void
	/** The next step of the walkthrough. */
	nextHref: string
}) {
	const { t } = useTranslation()
	const { t: tr } = useTranslation("reader")
	const set = (patch: Partial<FinishState>) => onChange({ ...state, ...patch })
	const noteFit = useGrowingFit(state.note || tr("end.notePlaceholder"))
	const fromNote = editionNoteFromNote(state.editionNote, state.note, NOTE_MAX)
	const editionLabel = useId()
	const field =
		"block w-full resize-none bg-transparent focus-visible:outline-none placeholder:text-(--note-placeholder)"

	return (
		<figure
			aria-label={t("home.capture.demoLabel")}
			className="rounded-2xl border border-border bg-card px-5 pt-5 pb-6 shadow-sm sm:px-7"
		>
			<p className="text-xs text-muted-fg">
				{t("home.demo.site")} · {t("home.demo.title")}
			</p>
			<div className="mt-4 grid gap-4 border-t border-border pt-5">
				<p className="text-sm leading-6 text-muted-fg">
					<span className="mr-1.5 inline-flex items-center gap-2 align-top text-base font-semibold text-fg">
						<span className="grid size-6 place-items-center rounded-full bg-accent text-accent-fg">
							<Check className="size-3.5" strokeWidth={3} aria-hidden />
						</span>
						{tr("end.finished")}
						<ReadStamp tilt={1} decorative className="ml-1" />
					</span>{" "}
					{tr("end.toArchive")}
				</p>
				<div className="grid max-w-md gap-2">
					<div className="text-xs">
						<ArticleNoteLabel />
					</div>
					<PostIt
						fit={noteFit}
						tilt={1}
						className="mt-2 mb-2 text-lg leading-snug focus-within:ring-2 focus-within:ring-ring"
					>
						<textarea
							aria-label={tr("highlights.sidebar.note")}
							value={state.note}
							maxLength={NOTE_MAX}
							rows={2}
							onChange={(event) => set({ note: event.target.value })}
							placeholder={tr("end.notePlaceholder")}
							className={cn(field, "min-h-16 [field-sizing:content]")}
						/>
					</PostIt>
					<p className="text-xs text-muted-fg">{t("home.capture.demoHint")}</p>
				</div>
				<div className="grid max-w-sm grid-cols-2 gap-2">
					<button
						type="button"
						aria-pressed={state.starred}
						onClick={() => set({ starred: !state.starred })}
						className="flex items-center justify-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm text-fg hover:bg-fg/10"
					>
						<Star
							className={cn(
								"size-4",
								state.starred ? "fill-favorite text-favorite" : "text-muted-fg",
							)}
							aria-hidden
						/>
						{state.starred ? tr("end.starred") : tr("end.star")}
					</button>
					<button
						type="button"
						aria-pressed={state.shortlisted}
						onClick={() => set({ shortlisted: !state.shortlisted })}
						className={cn(
							"flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm",
							state.shortlisted
								? "bg-accent text-accent-fg"
								: "bg-muted text-fg hover:bg-fg/10 [&>svg]:text-muted-fg",
						)}
					>
						<Newspaper className="size-4" aria-hidden />
						{state.shortlisted ? tr("end.shortlisted") : tr("end.shortlist")}
					</button>
				</div>
				{state.shortlisted ? (
					<div className="grid max-w-xl gap-3 rounded-xl border border-border bg-bg/60 p-4">
						<p className="flex items-center gap-2 text-sm font-medium">
							<span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
								<Check className="size-3" strokeWidth={3} aria-hidden />
							</span>
							{tr("end.added")}
						</p>
						<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
							<span id={editionLabel} className="text-xs font-medium text-muted-fg">
								{tr("end.editionNote")}
							</span>
							{fromNote !== null ? (
								<button
									type="button"
									onClick={() => set({ editionNote: fromNote })}
									className="-mr-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-link hover:bg-hover"
								>
									<NotebookPen className="size-3.5" aria-hidden />
									{tr("end.startFromNote")}
								</button>
							) : null}
						</div>
						<textarea
							aria-labelledby={editionLabel}
							value={state.editionNote}
							maxLength={NOTE_MAX}
							rows={3}
							onChange={(event) => set({ editionNote: event.target.value })}
							placeholder={tr("end.editionNotePlaceholder")}
							className="min-h-[5.5rem] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</div>
				) : null}
			</div>
			<a
				href={nextHref}
				className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-link underline-offset-4 hover:underline"
			>
				{t("home.capture.next")}
				<ArrowDown className="size-3.5" aria-hidden />
			</a>
		</figure>
	)
}
