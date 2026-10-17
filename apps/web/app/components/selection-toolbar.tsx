import { Copy, Highlighter, MessageSquarePlus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { AiToolbarButtons } from "./ai-toolbar-buttons"
import { ReaderToolbar, TOOLBAR_ICON_BUTTON, TOOLBAR_LABEL_BUTTON } from "./reader-toolbar"
import { tooltip } from "./tooltip-host"

/**
 * What can be done with text selected in the article: highlight it (two words or more), with a
 * note straight away or not, copy it, ask AI about it (with AI answers on).
 */
export function SelectionToolbar({
	rect,
	scrollY,
	onHighlight,
	onHighlightWithNote,
	onCopy,
	onClose,
	disabled,
	canHighlight = true,
	onAsk,
}: {
	/** Where the selection's first line was on screen when measured. */
	rect: DOMRect
	/** The page's scroll offset at that moment. */
	scrollY: number
	onHighlight: () => void
	/** Highlights it and opens its note. */
	onHighlightWithNote: () => void
	onCopy: () => void
	onClose: () => void
	disabled?: boolean
	/** One word is a lookup, not a highlight. */
	canHighlight?: boolean
	/** With AI answers on: ask AI about it. */
	onAsk?: () => void
}) {
	const { t } = useTranslation("reader")
	return (
		<ReaderToolbar
			label={t("highlights.selection.label")}
			rect={rect}
			scrollY={scrollY}
			width={onAsk ? 290 : 190}
			onClose={onClose}
			disabled={disabled}
		>
			<button
				type="button"
				disabled={disabled}
				// Not `disabled`: a disabled button gets no hover, and its tooltip says why it can't be used.
				aria-disabled={!canHighlight || undefined}
				onClick={canHighlight ? onHighlight : undefined}
				className={TOOLBAR_LABEL_BUTTON}
				{...(canHighlight ? {} : tooltip(t("highlights.selection.oneWord")))}
			>
				<Highlighter className="size-4" aria-hidden />
				{t("highlights.selection.highlight")}
			</button>
			<button
				type="button"
				disabled={disabled}
				aria-disabled={!canHighlight || undefined}
				onClick={canHighlight ? onHighlightWithNote : undefined}
				className={TOOLBAR_ICON_BUTTON}
				aria-label={t("highlights.selection.highlightWithNote")}
				{...tooltip(
					canHighlight
						? t("highlights.selection.highlightWithNote")
						: t("highlights.selection.oneWord"),
				)}
			>
				<MessageSquarePlus className="size-4" aria-hidden />
			</button>
			<button
				type="button"
				disabled={disabled}
				onClick={onCopy}
				className={TOOLBAR_ICON_BUTTON}
				aria-label={t("highlights.selection.copy")}
				{...tooltip(t("highlights.selection.copy"))}
			>
				<Copy className="size-4" aria-hidden />
			</button>
			{onAsk ? <AiToolbarButtons onAsk={onAsk} /> : null}
		</ReaderToolbar>
	)
}
