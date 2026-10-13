import { X } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useMediaQuery } from "~/hooks/use-media-query"

/**
 * The frame of the reader's small toolbars (a selection's, a highlight's): above the first line
 * of the text it acts on with a mouse (below when there is no room), a sheet at the bottom of the
 * screen on touch devices. Escape or a press outside closes it. A press inside keeps the
 * selection, so the buttons can act on it.
 */
export function ReaderToolbar({
	label,
	rect,
	scrollY,
	width,
	onClose,
	disabled,
	children,
}: {
	label: string
	/** Where the text was on screen when measured. */
	rect: DOMRect
	/** The page's scroll offset at that moment, not now: the toolbar stays with the page as it scrolls. */
	scrollY: number
	/** About how wide the toolbar is, to keep it on screen. */
	width: number
	onClose: () => void
	disabled?: boolean
	children: React.ReactNode
}) {
	const { t } = useTranslation("reader")
	const touch = useMediaQuery("(pointer: coarse)")
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			if ((e.target as Element).closest("[data-resize-handles]")) return
			if (ref.current && !ref.current.contains(e.target as Node)) onClose()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) onClose()
		}
		document.addEventListener("pointerdown", onDown)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown)
			document.removeEventListener("keydown", onKey)
		}
	}, [onClose])

	// The sticky top bar covers the first ~60px: no room above there.
	const above = rect.top > 120
	// On screen, its start first: in a window narrower than the toolbar, it wraps.
	const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
	const top = above ? rect.top + scrollY - 8 : rect.bottom + scrollY + 8

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label={label}
			data-placement={touch ? "bottom" : "floating"}
			onMouseDown={(e) => e.preventDefault()}
			style={
				touch
					? undefined
					: { position: "absolute", top, left, transform: above ? "translateY(-100%)" : undefined }
			}
			className={
				touch
					? "safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-2 rounded-t-2xl border-t border-border bg-card p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
					: "z-30 flex items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-lg"
			}
		>
			<div className="flex flex-wrap items-center gap-0.5">{children}</div>
			{touch ? (
				<button
					type="button"
					disabled={disabled}
					onClick={onClose}
					className="rounded-md p-1.5 text-muted-fg hover:bg-muted"
					aria-label={t("highlights.toolbar.close")}
				>
					<X className="size-4" aria-hidden />
				</button>
			) : null}
		</div>
	)
}

/** Dimmed, without a hover, when it can't be used (`disabled`, or `aria-disabled` to keep its tooltip). */
const DISABLED =
	" disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-fg aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-fg"

/** A text button in a reader toolbar: an icon and a label. */
export const TOOLBAR_LABEL_BUTTON = `flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium whitespace-nowrap text-muted-fg hover:bg-muted hover:text-fg${
	DISABLED
}`
/** An icon button in a reader toolbar. */
export const TOOLBAR_ICON_BUTTON = `rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg${DISABLED}`
