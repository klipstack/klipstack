import { Copy, MessageSquarePlus, Share, SquarePen, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
	HIGHLIGHT_COLOR_NAMES,
	HIGHLIGHT_SWATCH,
	highlightColor,
	highlightColorName,
} from "~/lib/highlight-colors"
import type { RenderableHighlight } from "~/lib/highlights.client"
import { COPY_HINT } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"
import { AiToolbarButtons } from "./ai-toolbar-buttons"
import { ReaderToolbar, TOOLBAR_ICON_BUTTON } from "./reader-toolbar"
import { tooltip } from "./tooltip-host"

interface Props {
	highlight: Pick<RenderableHighlight, "note" | "color">
	/** Where the highlight was on screen when measured. */
	rect: DOMRect
	/** The page's scroll offset at that moment. */
	scrollY: number
	/** Without it, no colors to pick (the landing page's demo). */
	onColor?: (color: number) => void
	/** Without it, no note button (the landing page's demo). */
	onNote?: () => void
	/** Without it, no copy button. */
	onCopy?: () => void
	/** Without it, no share button. */
	onShare?: () => void
	onDelete: () => void
	onClose: () => void
	disabled?: boolean
	/** With AI answers on: ask AI about the highlight. */
	onAsk?: () => void
}

/** The color picker's width: five swatches and the line after them. */
const COLORS_WIDTH = 160
/** The share button's width. */
const SHARE_WIDTH = 32

/** A highlight's actions: pick its color, add or edit its note, copy its text, share it, delete. */
export function HighlightToolbar({
	highlight,
	rect,
	scrollY,
	onColor,
	onNote,
	onCopy,
	onShare,
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
			width={(onAsk ? 220 : 110) + (onColor ? COLORS_WIDTH : 0) + (onShare ? SHARE_WIDTH : 0)}
			onClose={onClose}
			disabled={disabled}
		>
			{onColor ? (
				<ColorPicker color={highlight.color} onColor={onColor} disabled={disabled} />
			) : null}
			{onNote ? (
				<button
					type="button"
					disabled={disabled}
					onClick={onNote}
					className={TOOLBAR_ICON_BUTTON}
					aria-label={noteLabel}
					{...tooltip(noteLabel)}
				>
					{highlight.note ? (
						<SquarePen className="size-4" aria-hidden />
					) : (
						<MessageSquarePlus className="size-4" aria-hidden />
					)}
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
			{onShare ? (
				<button
					type="button"
					disabled={disabled}
					onClick={onShare}
					className={TOOLBAR_ICON_BUTTON}
					aria-label={t("highlights.share.open")}
					{...tooltip(t("highlights.share.open"))}
				>
					<Share className="size-4" aria-hidden />
				</button>
			) : null}
			<button
				type="button"
				disabled={disabled}
				onClick={onDelete}
				className="rounded-md p-1.5 text-muted-fg hover:bg-hover hover:text-danger"
				aria-label={t("highlights.popover.delete")}
				{...tooltip(t("highlights.popover.delete"))}
			>
				<Trash2 className="size-4" aria-hidden />
			</button>
			{onAsk ? <AiToolbarButtons onAsk={onAsk} disabled={disabled} /> : null}
		</ReaderToolbar>
	)
}

/** The five colors, the highlight's own pressed. */
function ColorPicker({
	color,
	onColor,
	disabled,
}: {
	color?: number
	onColor: (color: number) => void
	disabled?: boolean
}) {
	const { t } = useTranslation("reader")
	const current = highlightColorName(color)
	return (
		<>
			<div role="group" aria-label={t("highlights.popover.color")} className="flex items-center">
				{HIGHLIGHT_COLOR_NAMES.map((name, index) => {
					const label = t(`highlights.colors.${name}`)
					const pressed = name === current
					return (
						<button
							key={name}
							type="button"
							disabled={disabled}
							aria-pressed={pressed}
							aria-label={label}
							{...tooltip(label)}
							onClick={() => !pressed && onColor(index)}
							// Bigger to the finger, in the touch sheet.
							className="group/swatch rounded-full p-1.5 pointer-coarse:p-2.5 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<span
								aria-hidden
								{...highlightColor(index)}
								className={cn(
									"block size-4 rounded-full pointer-coarse:size-5 ring-offset-2 ring-offset-card transition-shadow",
									HIGHLIGHT_SWATCH,
									pressed
										? "ring-2 ring-fg/70"
										: "group-hover/swatch:ring-2 group-hover/swatch:ring-border",
								)}
							/>
						</button>
					)
				})}
			</div>
			<span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
		</>
	)
}
