import { useTranslation } from "react-i18next"
import { HIGHLIGHT_COLOR_NAMES, HIGHLIGHT_SWATCH, highlightColor } from "~/lib/highlight-colors"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"

/**
 * The five highlight colors as marker tips, slanted like a chisel highlighter: the current one
 * stands raised over a line. Bigger to the finger, in the touch sheet. The iPhone app has its
 * own (apps/mobile/src/components/highlighter-nibs.tsx).
 */
export function HighlighterNibs({
	value,
	onChange,
	disabled,
}: {
	/** The current color's index. */
	value: number
	onChange: (color: number) => void
	disabled?: boolean
}) {
	const { t } = useTranslation("reader")
	return (
		<div role="group" aria-label={t("highlights.popover.color")} className="flex items-end">
			{HIGHLIGHT_COLOR_NAMES.map((name, index) => {
				const label = t(`highlights.colors.${name}`)
				const pressed = index === value
				return (
					<button
						key={name}
						type="button"
						disabled={disabled}
						aria-pressed={pressed}
						aria-label={label}
						{...tooltip(label)}
						onClick={() => !pressed && onChange(index)}
						className="group/nib relative flex h-7 w-6.5 items-end justify-center rounded-md pb-1.5 hover:bg-hover pointer-coarse:h-11 pointer-coarse:w-9 pointer-coarse:pb-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
					>
						{/* The tip, a little taller than wide, rounded at its foot. */}
						<span
							aria-hidden
							className={cn(
								"block h-[17px] w-4 overflow-hidden rounded-b-[3px] motion-safe:transition-transform motion-safe:duration-180 motion-safe:ease-[cubic-bezier(0.3,0.7,0.2,1)] pointer-coarse:h-[25px] pointer-coarse:w-6",
								pressed
									? "-translate-y-1 pointer-coarse:-translate-y-[5px]"
									: "group-enabled/nib:group-hover/nib:-translate-y-0.5",
							)}
						>
							{/* Its ink, the top cut on a slant: a third of its height, low on the left. */}
							<span
								{...highlightColor(index)}
								className={cn(
									"block size-full [clip-path:polygon(0_32%,100%_0,100%_100%,0_100%)]",
									HIGHLIGHT_SWATCH,
								)}
							/>
						</span>
						{pressed ? (
							<span
								aria-hidden
								className="absolute inset-x-1 bottom-0.5 h-0.5 rounded-full bg-fg pointer-coarse:bottom-1"
							/>
						) : null}
					</button>
				)
			})}
		</div>
	)
}
