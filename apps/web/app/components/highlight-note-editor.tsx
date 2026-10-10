import { Check, X } from "lucide-react"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { LinkTargets } from "~/lib/note-links"
import { cn } from "~/lib/utils"
import { LinkArticleButton } from "./link-article-button"
import type { NoteEditorApi } from "./note-editor"
import { NoteField } from "./note-field"
import { tooltip } from "./tooltip-host"

export type NoteEditorPlacement =
	| { kind: "margin" }
	| { kind: "floating"; rect: DOMRect }
	| { kind: "sheet" }

interface Props {
	initial: string
	placement: NoteEditorPlacement
	/** The article being read: the link menu never offers it. */
	documentId: string
	linkTargets: LinkTargets
	onSave: (note: string) => void
	onCancel: () => void
}

const WIDTH = 320

/**
 * Write or change a highlight's note. In the margin it takes the note's place; without a margin it
 * floats below the highlight (mouse) or sits at the bottom of the screen above the keyboard (touch).
 * Save or ⌘/Ctrl+Enter saves, Cancel or Escape drops the draft, a click outside saves any change.
 */
export function HighlightNoteEditor({
	initial,
	placement,
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
				"bg-card",
				placement.kind === "sheet"
					? "safe-bottom fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-border p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
					: "z-30 rounded-xl border border-border p-3 shadow-lg",
				// In the margin, the text lines up with the note it replaces.
				placement.kind === "margin" && "-mt-2.5",
			)}
		>
			<NoteField
				value={note}
				onChange={setNote}
				onSubmit={() => (dirty ? onSave(note) : onCancel())}
				onEscape={onCancel}
				autoFocus
				documentId={documentId}
				linkTargets={linkTargets}
				placeholder={t("highlights.popover.notePlaceholder")}
				aria-label={t("highlights.popover.note")}
				className="max-h-[40vh] min-h-12 overflow-y-auto font-sans text-sm leading-snug"
				onApi={setNoteApi}
			/>
			{/* Icons, not labels: in the margin the editor is one note wide, and three labels wrapped. */}
			<div className="mt-2 flex items-center justify-end gap-1">
				<LinkArticleButton api={noteApi} compact className="mr-auto" />
				<button
					type="button"
					onClick={onCancel}
					aria-label={t("highlights.popover.cancel")}
					{...tooltip(t("highlights.popover.cancel"))}
					className="rounded-lg p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
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
