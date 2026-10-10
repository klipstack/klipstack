import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { clampSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "~/lib/sidebar"
import { cn } from "~/lib/utils"

const KEY_STEP = 16

/**
 * The sidebar's right edge: drag to resize, arrow keys to nudge, double-click for the default.
 * `onResize` follows the pointer; `onCommit` is the width to remember.
 */
export function SidebarResizer({
	width,
	onResize,
	onCommit,
}: {
	width: number
	onResize: (width: number | null) => void
	onCommit: (width: number) => void
}) {
	const { t } = useTranslation()
	const drag = useRef<{ x: number; width: number; last: number } | null>(null)

	return (
		// A focusable, adjustable separator has no element of its own
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={t("nav.resize")}
			aria-valuenow={width}
			aria-valuemin={SIDEBAR_MIN}
			aria-valuemax={SIDEBAR_MAX}
			tabIndex={0}
			data-testid="sidebar-resizer"
			onPointerDown={(e) => {
				if (e.button !== 0) return
				e.preventDefault()
				e.currentTarget.setPointerCapture(e.pointerId)
				drag.current = { x: e.clientX, width, last: width }
			}}
			onPointerMove={(e) => {
				if (!drag.current) return
				const next = clampSidebarWidth(drag.current.width + e.clientX - drag.current.x)
				drag.current.last = next
				onResize(next)
			}}
			onPointerUp={() => {
				if (!drag.current) return
				onCommit(drag.current.last)
				onResize(null)
				drag.current = null
			}}
			onPointerCancel={() => {
				drag.current = null
				onResize(null)
			}}
			onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)}
			onKeyDown={(e) => {
				const next =
					e.key === "ArrowLeft"
						? width - KEY_STEP
						: e.key === "ArrowRight"
							? width + KEY_STEP
							: e.key === "Home"
								? SIDEBAR_MIN
								: e.key === "End"
									? SIDEBAR_MAX
									: null
				if (next === null) return
				e.preventDefault()
				onCommit(clampSidebarWidth(next))
			}}
			className={cn(
				"group/resizer absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none outline-none",
				"after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:transition-colors",
				"hover:after:bg-ring focus-visible:after:bg-ring active:after:bg-ring",
			)}
		/>
	)
}
