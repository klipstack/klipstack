import { Lock, Newspaper } from "lucide-react"
import { useTranslation } from "react-i18next"
import { MARGIN_NOTE } from "~/components/margin-notes"
import { PostIt } from "~/components/post-it"
import { cn } from "~/lib/utils"
import type { FinishState } from "./finish-demo"
import {
	EDITION_HIGHLIGHTS_MAX,
	HL_SOLID_BORDER,
	type Marks,
	NOTED,
	type SentenceId,
	SENTENCES,
} from "./sample"

/**
 * Where the walkthrough's article ends up: the notebook, private, with what the visitor highlighted
 * and wrote; and an edition only when they marked the article for one. There, as in the edition
 * editor, no highlight is quoted until it is chosen, up to three, and the page is a draft until
 * it is published.
 */
export function KeepDemo({
	marks,
	finish,
	quoted,
	onQuote,
	onShortlist,
}: {
	marks: Marks
	finish: FinishState
	/** The highlights the edition quotes. */
	quoted: readonly SentenceId[]
	onQuote: (quoted: SentenceId[]) => void
	onShortlist: () => void
}) {
	const { t } = useTranslation()
	const { t: tr } = useTranslation("reader")
	const highlights = SENTENCES.filter((id) => marks[id])
	const sentence = (id: SentenceId) => t(`home.demo.sentences.${id}`)
	const shownQuotes = highlights.filter((id) => quoted.includes(id))
	const full = shownQuotes.length >= EDITION_HIGHLIGHTS_MAX
	const quote = "border-l-[3px] pl-3 font-display text-[1.02rem] leading-relaxed"

	return (
		<div aria-label={t("home.keep.demoLabel")} role="group" className="grid gap-5">
			<figure
				data-testid="landing-notebook"
				className="rounded-2xl border border-border bg-card px-5 py-5 shadow-sm sm:px-7"
			>
				<div className="flex items-center justify-between gap-3">
					<p className="font-medium">{t("home.keep.notebook.title")}</p>
					<span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-fg">
						<Lock className="size-3" aria-hidden />
						{t("home.keep.notebook.onlyYou")}
					</span>
				</div>
				{highlights.length === 0 && !finish.note.trim() ? (
					<p className="mt-4 text-sm text-muted-fg">{t("home.keep.notebook.empty")}</p>
				) : (
					<div className="mt-4 border-t border-border pt-4">
						<p className="font-display text-lg leading-snug">{t("home.demo.title")}</p>
						<p className="mt-0.5 text-xs text-muted-fg">
							{t("home.demo.site")} ·{" "}
							{t("home.keep.notebook.highlights", { count: highlights.length })}
						</p>
						{finish.note.trim() ? (
							<PostIt variant="compact" tilt={2} className="mt-5 max-w-sm text-base leading-snug">
								<span className="sr-only">{tr("highlights.sidebar.note")}</span>
								<span className="whitespace-pre-line">{finish.note}</span>
							</PostIt>
						) : null}
						<ul className="mt-4 space-y-3">
							{highlights.map((id) => (
								<li key={id}>
									<blockquote className={cn(quote, HL_SOLID_BORDER)}>{sentence(id)}</blockquote>
									{id === NOTED ? (
										<PostIt
											variant="compact"
											fit={t("home.demo.marginNote")}
											tilt={1}
											className={cn(MARGIN_NOTE, "mt-2.5 ml-3.5")}
										>
											{t("home.demo.marginNote")}
										</PostIt>
									) : null}
								</li>
							))}
						</ul>
					</div>
				)}
			</figure>

			{finish.shortlisted ? (
				<figure
					data-testid="landing-edition"
					className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
				>
					<div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2.5">
						<span aria-hidden className="flex gap-1.5">
							<span className="size-2.5 rounded-full bg-border" />
							<span className="size-2.5 rounded-full bg-border" />
							<span className="size-2.5 rounded-full bg-border" />
						</span>
						<span className="truncate text-xs text-muted-fg">{t("home.keep.edition.draft")}</span>
					</div>
					<div className="px-5 py-6 sm:px-7">
						<p className="text-xs font-medium tracking-wide text-muted-fg uppercase">
							{t("home.keep.edition.kicker")}
						</p>
						<p className="mt-1 font-display text-2xl tracking-tight">
							{t("home.keep.edition.name")}
						</p>
						<div className="mt-5 border-t border-border pt-5">
							<p className="font-display text-xl leading-snug text-link">{t("home.demo.title")}</p>
							<p className="mt-1 text-xs text-muted-fg">{t("home.demo.site")}</p>
							{finish.editionNote.trim() ? (
								<PostIt tilt={3} className="mt-6 max-w-md text-base leading-snug">
									<span className="whitespace-pre-line">{finish.editionNote}</span>
								</PostIt>
							) : null}
							{shownQuotes.length > 0 ? (
								<ul className="mt-5 space-y-3">
									{shownQuotes.map((id) => (
										<li key={id}>
											<blockquote className={cn(quote, HL_SOLID_BORDER)}>{sentence(id)}</blockquote>
										</li>
									))}
								</ul>
							) : null}
						</div>
						<div className="mt-6 rounded-xl bg-muted px-4 py-3">
							{highlights.length === 0 ? (
								<p className="text-sm text-muted-fg">{t("home.keep.edition.noHighlights")}</p>
							) : (
								<fieldset>
									<legend className="text-sm text-muted-fg">
										{t("home.keep.edition.quoteHint", { count: EDITION_HIGHLIGHTS_MAX })}
									</legend>
									<ul className="mt-2 grid gap-1.5">
										{highlights.map((id) => {
											const on = quoted.includes(id)
											return (
												<li key={id}>
													<label
														className={cn(
															"flex items-start gap-2.5 text-sm leading-snug",
															!on && full ? "opacity-50" : "cursor-pointer",
														)}
													>
														<input
															type="checkbox"
															checked={on}
															disabled={!on && full}
															onChange={() =>
																onQuote(on ? quoted.filter((q) => q !== id) : [...quoted, id])
															}
															className="mt-0.5 size-4 shrink-0 accent-accent"
														/>
														<span>{sentence(id)}</span>
													</label>
												</li>
											)
										})}
									</ul>
								</fieldset>
							)}
						</div>
						<p className="mt-4 text-xs text-muted-fg">{t("home.keep.edition.publishNote")}</p>
					</div>
				</figure>
			) : (
				<figure
					data-testid="landing-edition"
					className="rounded-2xl border-2 border-dashed border-border px-5 py-5 sm:px-7"
				>
					<p className="font-medium">{t("home.keep.edition.notIn")}</p>
					<p className="mt-1.5 text-sm leading-relaxed text-muted-fg">
						{t("home.keep.edition.notInBody")}
					</p>
					<button
						type="button"
						onClick={onShortlist}
						className="mt-4 inline-flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-fg hover:bg-fg/10"
					>
						<Newspaper className="size-4 text-muted-fg" aria-hidden />
						{tr("end.shortlist")}
					</button>
				</figure>
			)}
		</div>
	)
}
