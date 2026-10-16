import { useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { HighlightToolbar } from "~/components/highlight-toolbar"
import { MARGIN_NOTE } from "~/components/margin-notes"
import { PostIt } from "~/components/post-it"
import { cn } from "~/lib/utils"
import { ESSAY_MINUTES, HL_BG, type Marks, NOTED, PARAGRAPHS, type SentenceId } from "./sample"

interface Open {
	id: SentenceId
	rect: DOMRect
	scrollY: number
	/** Opened from the keyboard: the toolbar takes the focus, and gives it back on close. */
	keyboard: boolean
}

/**
 * The walkthrough's sample article, which the visitor highlights. A tap, a click or the keyboard
 * (Tab, then Enter or Space) marks a sentence and opens the reader's own highlight toolbar, to
 * remove it. The sentence in focus stands out as in the reader.
 * Plain markup rather than a screenshot, so it follows the theme and the language.
 */
export function HighlightDemo({
	marks,
	onChange,
}: {
	marks: Marks
	onChange: (marks: Marks) => void
}) {
	const { t } = useTranslation()
	const { t: tr } = useTranslation("reader")
	const [open, setOpen] = useState<Open | null>(null)
	const row = "grid gap-x-5 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
	const text = "sm:col-start-2"

	function select(id: SentenceId, target: HTMLElement, keyboard: boolean) {
		if (!marks[id]) onChange({ ...marks, [id]: true })
		setOpen({
			id,
			rect: target.getClientRects()[0] ?? target.getBoundingClientRect(),
			scrollY: window.scrollY,
			keyboard,
		})
		if (keyboard)
			requestAnimationFrame(() =>
				document.querySelector<HTMLElement>("[data-demo-toolbar] button")?.focus(),
			)
	}
	function close() {
		if (open?.keyboard) document.querySelector<HTMLElement>(`[data-sentence="${open.id}"]`)?.focus()
		setOpen(null)
	}
	function remove() {
		if (!open) return
		const next = { ...marks }
		delete next[open.id]
		onChange(next)
		close()
	}

	const noted = marks[NOTED]
	return (
		<figure
			aria-label={t("home.demo.label")}
			className="relative overflow-hidden rounded-2xl border border-border bg-card px-5 pt-5 pb-7 shadow-sm sm:px-7 sm:pt-6"
		>
			<div className="flex items-start justify-between gap-3 border-b border-border pb-4">
				<p className="pt-1 text-sm text-muted-fg">{t("home.demo.hint")}</p>
				<button
					type="button"
					onClick={() => {
						setOpen(null)
						onChange({})
					}}
					disabled={Object.keys(marks).length === 0}
					className="shrink-0 rounded-md px-2 py-1 text-sm text-muted-fg hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
				>
					{t("home.demo.clear")}
				</button>
			</div>

			<div className={`${row} mt-5`}>
				<div className={text}>
					<p className="text-xs text-muted-fg">
						{t("home.demo.site")} · {tr("meta.minutes", { count: ESSAY_MINUTES })}
					</p>
					<p className="mt-2 font-display text-2xl leading-tight text-balance">
						{t("home.demo.title")}
					</p>
				</div>
			</div>
			<div className="mt-4 space-y-4 font-display text-[1.08rem] leading-relaxed">
				{PARAGRAPHS.map((sentences) => {
					const hasNote = noted !== undefined && (sentences as readonly string[]).includes(NOTED)
					return (
						<div key={sentences[0]} className={row}>
							<p className={text}>
								{sentences.map((id, j) => {
									const mark = marks[id] === true
									return (
										<span key={id}>
											{j > 0 ? " " : null}
											<span
												role="button"
												tabIndex={0}
												data-sentence={id}
												aria-pressed={mark}
												aria-haspopup="dialog"
												onClick={(event) => select(id, event.currentTarget, false)}
												onKeyDown={(event) => {
													if (event.key === "Enter" || event.key === " ") {
														event.preventDefault()
														select(id, event.currentTarget, true)
													}
												}}
												className={cn(
													"cursor-pointer rounded-[2px] box-decoration-clone transition-[background-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
													mark ? HL_BG : "hover:bg-hover",
													mark && open?.id === id ? "hl-pop" : null,
													id === NOTED && mark
														? "underline decoration-muted-fg decoration-dotted underline-offset-[3px]"
														: null,
												)}
											>
												{t(`home.demo.sentences.${id}`)}
											</span>
										</span>
									)
								})}
							</p>
							{hasNote ? (
								<PostIt
									variant="compact"
									fit={t("home.demo.marginNote")}
									tilt={1}
									className={cn(
										MARGIN_NOTE,
										"mt-3 self-start sm:col-start-1 sm:row-start-1 sm:mt-1",
									)}
								>
									{t("home.demo.marginNote")}
								</PostIt>
							) : null}
						</div>
					)
				})}
			</div>
			{open && marks[open.id]
				? createPortal(
						<div data-demo-toolbar="">
							<HighlightToolbar
								highlight={{}}
								rect={open.rect}
								scrollY={open.scrollY}
								onDelete={remove}
								onClose={close}
							/>
						</div>,
						document.body,
					)
				: null}
		</figure>
	)
}
