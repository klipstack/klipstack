import { HIGHLIGHT_NOTE_MAX } from "@klipstack/api-contract/names"
import { Check, X } from "lucide-react"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import type { LinkTargets } from "~/lib/note-links"
import { cn } from "~/lib/utils"
import { LinkArticleButton } from "./link-article-button"
import { MARGIN_NOTE } from "./margin-notes"
import type { NoteEditorApi } from "./note-editor"
import { NoteField } from "./note-field"
import { PostIt, type PostItVariant, useGrowingFit } from "./post-it"
import { tooltip } from "./tooltip-host"

export type NoteEditorPlacement =
	| { kind: "margin" }
	| { kind: "floating"; rect: DOMRect }
	| { kind: "sheet" }

interface Props {
	initial: string
	/** The highlight's color, for the note's edge and paper. */
	color?: number
	/** The note's lean (`PostIt`'s `tilt`): the note's own, so it does not move when edited. */
	tilt?: number
	/** `compact` (the default) has the margin's colored edge; `full` is the board's larger paper. */
	variant?: PostItVariant
	/** On the paper: where it stands in its place, such as against the article. */
	className?: string
	placement: NoteEditorPlacement
	/**
	 * Take the keyboard (the default). Off while the editor is not yet where it will stay: the
	 * browser may scroll the page to the caret, wherever the editor stands.
	 */
	autoFocus?: boolean
	/** The article being read: the link menu never offers it. */
	documentId: string
	linkTargets: LinkTargets
	onSave: (note: string) => void
	onCancel: () => void
}

const WIDTH = 320

/** A button on the note's paper, in its ink. */
const PAPER_BUTTON = "text-note-fg/70 hover:bg-note-fg/10 hover:text-note-fg"

/**
 * Write or change a highlight's note, on the note itself: the same paper, type and edge. In the
 * margin it takes the note's place, its text exactly where the note's was; without a margin it
 * floats below the highlight (mouse) or sits at the bottom of the screen above the keyboard (touch).
 * Save or ⌘/Ctrl+Enter saves, Cancel or Escape drops the draft, a click outside saves any change.
 */
export function HighlightNoteEditor({
	initial,
	color,
	tilt = 0,
	variant = "compact",
	className,
	placement,
	autoFocus = true,
	documentId,
	linkTargets,
	onSave,
	onCancel,
}: Props) {
	const { t } = useTranslation("reader")
	const [note, setNote] = useState(initial)
	const ref = useRef<HTMLDivElement>(null)
	const [noteApi, setNoteApi] = useState<NoteEditorApi | null>(null)
	const dirty = note.trim() !== initial.trim()
	const fit = useGrowingFit(note.length > initial.length ? note : initial)

	// Latest values for the document listeners, which are attached once.
	const latest = useRef({ note, dirty, onSave, onCancel })
	useInsertionEffect(() => {
		latest.current = { note, dirty, onSave, onCancel }
	})

	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			if (ref.current?.contains(e.target as Node)) return
			// The link menu is a portal outside this box, but a click in it is a click in the editor.
			if ((e.target as Element).closest?.('[data-testid="note-link-menu"]')) return
			const { note, dirty, onSave, onCancel } = latest.current
			if (dirty) onSave(note)
			else onCancel()
		}
		document.addEventListener("pointerdown", onDown)
		return () => document.removeEventListener("pointerdown", onDown)
	}, [])

	const keyboardInset = useKeyboardInset(placement.kind === "sheet")

	let style: React.CSSProperties | undefined
	if (placement.kind === "floating") {
		const { rect } = placement
		const below = rect.bottom + 220 < window.innerHeight
		style = {
			position: "absolute",
			top: below ? rect.bottom + window.scrollY + 8 : rect.top + window.scrollY - 8,
			left: Math.min(Math.max(8, rect.left), window.innerWidth - WIDTH - 8),
			width: WIDTH,
			transform: below ? undefined : "translateY(-100%)",
		}
	} else if (placement.kind === "sheet") {
		style = { bottom: keyboardInset }
	}

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label={t("highlights.popover.noteLabel")}
			data-placement={placement.kind}
			style={style}
			className={cn(
				// Floating with the text, it scrolls under the top bar and the outline, as notes in the
				// margin do (MarginNotes).
				placement.kind === "floating" ? "z-10" : "z-30",
				placement.kind === "sheet" &&
					"safe-bottom fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-border bg-card p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]",
			)}
		>
			{/* In the margin (or on a card), the note's own size, growing as it is written. Floating and
			    in the sheet, the paper fills its box, as before. */}
			<PostIt
				variant={variant}
				tilt={tilt}
				fit={placement.kind === "margin" ? fit : undefined}
				{...highlightColor(color)}
				color={highlightColorName(color)}
				className={cn(
					variant === "compact" && MARGIN_NOTE,
					className,
					placement.kind === "floating" && "shadow-lg",
				)}
			>
				<NoteField
					value={note}
					onChange={setNote}
					onSubmit={() => (dirty ? onSave(note) : onCancel())}
					onEscape={onCancel}
					autoFocus={autoFocus}
					documentId={documentId}
					linkTargets={linkTargets}
					placeholder={t("highlights.popover.notePlaceholder")}
					maxLength={HIGHLIGHT_NOTE_MAX}
					aria-label={t("highlights.popover.note")}
					className="max-h-[40vh] min-h-[2lh] overflow-y-auto outline-none"
					onApi={setNoteApi}
				/>
				{/* Icons, not labels: in the margin the editor is one note wide, and three labels wrapped. */}
				<div className="mt-1.5 -mr-1.5 -mb-0.5 flex items-center justify-end gap-1 not-italic">
					<LinkArticleButton
						api={noteApi}
						compact
						className={cn("mr-auto -ml-1.5", PAPER_BUTTON)}
					/>
					<button
						type="button"
						onClick={onCancel}
						aria-label={t("highlights.popover.cancel")}
						{...tooltip(t("highlights.popover.cancel"))}
						className={cn("rounded-lg p-1.5", PAPER_BUTTON)}
					>
						<X className="size-4" aria-hidden />
					</button>
					<button
						type="button"
						disabled={!dirty}
						onClick={() => onSave(note)}
						aria-label={t("highlights.popover.save")}
						{...tooltip(t("highlights.popover.save"), "⌘↵")}
						className="rounded-lg bg-accent p-1.5 text-accent-fg disabled:opacity-50"
					>
						<Check className="size-4" aria-hidden />
					</button>
				</div>
			</PostIt>
		</div>
	)
}

/** How much of the layout viewport's bottom the on-screen keyboard hides (visual viewport API). */
function useKeyboardInset(enabled: boolean): number {
	const [inset, setInset] = useState(0)
	useEffect(() => {
		const vv = window.visualViewport
		if (!enabled || !vv) return
		const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
		update()
		vv.addEventListener("resize", update)
		vv.addEventListener("scroll", update)
		return () => {
			vv.removeEventListener("resize", update)
			vv.removeEventListener("scroll", update)
		}
	}, [enabled])
	return inset
}
