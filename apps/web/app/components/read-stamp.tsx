import { useTranslation } from "react-i18next"
import { cn } from "~/lib/utils"

/** Stamped by hand: never quite straight, and never twice the same way. */
const TILTS = ["-rotate-[7deg]", "-rotate-[4deg]", "rotate-[3deg]", "-rotate-[9deg]"] as const

/**
 * Worn ink: a fine noise taken out of the stamp, as a rubber stamp never inks evenly. Its alpha is
 * the mask; most of the stamp stays solid.
 */
const WORN = `url("data:image/svg+xml,${encodeURIComponent(
	"<svg xmlns='http://www.w3.org/2000/svg' width='80' height='40'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2.15'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`

/**
 * An ink stamp that says an article was read, in a library's date-stamp ink (`--k-stamp`), a
 * little tilted (`tilt`, by the article: the same every time). Screen readers hear "Finished".
 * The caller places it, and may back it (`className`) where it lands on a picture.
 */
export function ReadStamp({ tilt = 0, className }: { tilt?: number; className?: string }) {
	const { t } = useTranslation("library")
	return (
		<span
			data-testid="read-stamp"
			className={cn(
				"inline-flex shrink-0",
				TILTS[((tilt % TILTS.length) + TILTS.length) % TILTS.length],
				className,
			)}
		>
			<span className="sr-only">{t("card.finished")}</span>
			<span
				aria-hidden="true"
				style={{ maskImage: WORN, WebkitMaskImage: WORN }}
				className="inline-block rounded-[3px] border-[1.5px] border-current px-1 font-sans text-[10px] leading-[13px] font-bold tracking-[0.14em] text-stamp uppercase opacity-85 select-none"
			>
				{t("card.stamp")}
			</span>
		</span>
	)
}
