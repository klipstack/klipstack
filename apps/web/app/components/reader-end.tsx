import type { EndState } from "@klipstack/api-contract/reading"
import { Check, Newspaper, Star } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { tooltip } from "~/components/tooltip-host"
import type { StateIntent } from "~/hooks/use-document-state"
import { SHORTCUT_HINTS } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

/**
 * The end of the article, in the page after its last paragraph: whether leaving finishes it, a way
 * to keep it as it is, and the star and the mark for the next edition, with their names.
 * `onReached` once it comes into view.
 */
export function ReaderEnd({
	state,
	archived,
	starred,
	shortlisted,
	onReached,
	onChange,
	onKeep,
	onFinish,
}: {
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
					onClick={() => onChange(shortlisted ? "unshortlist" : "shortlist")}
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
		</section>
	)
}
