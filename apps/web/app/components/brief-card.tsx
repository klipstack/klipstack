import type { AiCitation } from "@klipstack/db"
import { ChevronUp, Copy, Loader2, RotateCcw, ScrollText } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useQuestionsLeft } from "~/hooks/use-ai-allowance"
import { type AnswerStore, useWritten } from "~/hooks/use-ai-threads"
import { BRIEF } from "~/hooks/use-brief"
import type { AiFailure } from "~/lib/ai-stream.client"
import type { AiBriefView } from "~/lib/ai-threads"
import { cn } from "~/lib/utils"
import { AiAnswer, plainAnswer } from "./ai-answer"
import { Failure, QuestionsLeft } from "./ai-card"
import { tooltip } from "./tooltip-host"

interface Props {
	brief: AiBriefView | null
	writing: boolean
	failure: AiFailure | null
	open: boolean
	written: AnswerStore
	onOpen: (open: boolean) => void
	onMake: () => void
	onCopy: (text: string) => void
	onCite: (citation: AiCitation) => void
}

/**
 * The article's brief, between the article's header and its text: a one-line button until the
 * reader asks for one, then three cited bullets, collapsible to one line. No follow-ups.
 */
export function BriefCard({
	brief,
	writing,
	failure,
	open,
	written,
	onOpen,
	onMake,
	onCopy,
	onCite,
}: Props) {
	const { t } = useTranslation("reader")
	const streamed = useWritten(written, BRIEF)
	// None left this month: the button stays, dimmed, and pressing it says why; no Retry.
	const { none } = useQuestionsLeft()
	const label = (
		<span className="flex items-center gap-1 text-xs font-medium text-accent">
			<ScrollText className="size-3" aria-hidden />
			{t("ai.brief.title")}
		</span>
	)
	const row =
		"mb-6 block w-full rounded-r-lg border-l-2 border-accent/60 px-3 py-1 text-left text-sm leading-snug text-muted-fg transition-colors hover:bg-muted/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

	if (!brief && !writing && !failure)
		return (
			<button
				type="button"
				onClick={onMake}
				className={cn(row, none && "opacity-50")}
				data-testid="brief"
				{...(none ? tooltip(t("ai.noneLeft")) : {})}
			>
				{label}
				<span>{t("ai.brief.make")}</span>
			</button>
		)
	if (brief && !writing && !open)
		return (
			<button type="button" onClick={() => onOpen(true)} className={row} data-testid="brief">
				{label}
				<span className="line-clamp-2">
					{plainAnswer(brief.text.replace(/^\s*[-*]\s+/gm, "").replace(/\n+/g, " "))}
				</span>
			</button>
		)
	return (
		<section
			aria-label={t("ai.brief.title")}
			data-testid="brief"
			className="mb-6 rounded-xl border border-border bg-card p-3 font-sans text-sm leading-snug"
		>
			<div className="flex items-center gap-1.5">
				{label}
				{brief ? (
					<button
						type="button"
						onClick={() => onOpen(false)}
						aria-label={t("ai.collapse")}
						{...tooltip(t("ai.collapse"))}
						className="-mr-1 ml-auto rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
					>
						<ChevronUp className="size-3.5" aria-hidden />
					</button>
				) : null}
			</div>
			<div className="mt-2" aria-live="polite">
				{writing ? (
					streamed.text ? (
						<AiAnswer
							text={streamed.text}
							citations={streamed.citations}
							onCite={onCite}
							citeLabel={(n) => t("ai.citation", { n })}
						/>
					) : (
						<p className="flex items-center gap-1.5 text-muted-fg">
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
							{t("ai.brief.writing")}
						</p>
					)
				) : brief ? (
					<AiAnswer
						text={brief.text}
						citations={brief.citations}
						onCite={onCite}
						citeLabel={(n) => t("ai.citation", { n })}
					/>
				) : null}
				{failure && !writing ? <Failure {...failure} /> : null}
				{/* Failed for another reason at the cap: why there is no Retry. */}
				{failure && !writing && none ? (
					<QuestionsLeft failed={failure.code === "limit_reached"} />
				) : null}
			</div>
			{writing ? null : (
				<div className="mt-2 flex items-center gap-0.5">
					{brief ? (
						<button
							type="button"
							onClick={() => onCopy(plainAnswer(brief.text))}
							aria-label={t("ai.copy")}
							{...tooltip(t("ai.copy"))}
							className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
						>
							<Copy className="size-3.5" aria-hidden />
						</button>
					) : none ? null : (
						<button
							type="button"
							onClick={onMake}
							aria-label={t("ai.retry")}
							{...tooltip(t("ai.retry"))}
							className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
						>
							<RotateCcw className="size-3.5" aria-hidden />
						</button>
					)}
				</div>
			)}
		</section>
	)
}
