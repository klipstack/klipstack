import type { AiThreadAction } from "@klipstack/db"
import { Copy, MessageSquarePlus, SquarePen, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { RenderableHighlight } from "~/lib/highlights.client"
import { COPY_HINT } from "~/lib/shortcuts"
import { AiToolbarButtons } from "./ai-toolbar-buttons"
import { ReaderToolbar, TOOLBAR_ICON_BUTTON, TOOLBAR_LABEL_BUTTON } from "./reader-toolbar"
import { tooltip } from "./tooltip-host"

interface Props {
	highlight: Pick<RenderableHighlight, "note">
	/** Where the highlight was on screen when measured. */
	rect: DOMRect
	/** The page's scroll offset at that moment. */
	scrollY: number
	/** Without it, no note button (the landing page's demo). */
	onNote?: () => void
	/** Without it, no copy button. */
	onCopy?: () => void
	onDelete: () => void
	onClose: () => void
	disabled?: boolean
	/** With AI answers on: Explain, Define, Ask about the highlight. */
	onAsk?: (action: AiThreadAction) => void
}

/** A highlight's actions: add or edit its note, copy its text, delete. */
export function HighlightToolbar({
	highlight,
	rect,
	scrollY,
	onNote,
	onCopy,
	onDelete,
	onClose,
	disabled,
	onAsk,
}: Props) {
	const { t } = useTranslation("reader")
	const noteLabel = highlight.note
		? t("highlights.popover.editNote")
		: t("highlights.popover.addNote")

	return (
		<ReaderToolbar
			label={t("highlights.popover.label")}
			rect={rect}
			scrollY={scrollY}
			width={onAsk ? 530 : 240}
			onClose={onClose}
			disabled={disabled}
		>
			{onNote ? (
				<button type="button" disabled={disabled} onClick={onNote} className={TOOLBAR_LABEL_BUTTON}>
					{highlight.note ? (
						<SquarePen className="size-4" aria-hidden />
					) : (
						<MessageSquarePlus className="size-4" aria-hidden />
					)}
					{noteLabel}
				</button>
			) : null}
			{onCopy ? (
				<button
					type="button"
					disabled={disabled}
					onClick={onCopy}
					className={TOOLBAR_ICON_BUTTON}
					aria-label={t("highlights.popover.copy")}
					{...tooltip(t("highlights.popover.copy"), COPY_HINT)}
				>
					<Copy className="size-4" aria-hidden />
				</button>
			) : null}
			<button
				type="button"
				disabled={disabled}
				onClick={onDelete}
				className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-danger"
				aria-label={t("highlights.popover.delete")}
				{...tooltip(t("highlights.popover.delete"))}
			>
				<Trash2 className="size-4" aria-hidden />
			</button>
			{onAsk ? <AiToolbarButtons onAsk={onAsk} disabled={disabled} /> : null}
		</ReaderToolbar>
	)
}
