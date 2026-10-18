import type { CSSProperties } from "react"
import { hash, siteHue } from "~/lib/book-hue"
import { cn } from "~/lib/utils"

/** Stuck on by hand: never quite straight, and never twice the same way. */
const TILTS = ["-3deg", "-1.5deg", "2deg", "-4deg"] as const

/**
 * A followed site as a postage stamp (`.site-stamp`): its initial on the paint of its books on the
 * shelves and its articles' covers (`siteHue`, by host), a little tilted, the same every time.
 * Decoration: the site's name is always written beside it.
 */
export function SiteStamp({
	siteUrl,
	title,
	size = 24,
	className,
}: {
	siteUrl: string
	title: string
	size?: number
	className?: string
}) {
	const site = hostOf(siteUrl) || title
	const initial = (title.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase()
	return (
		<span
			aria-hidden
			data-testid="site-stamp"
			className={cn("site-stamp", className)}
			style={
				{
					"--hue": siteHue(site),
					"--s": `${size}px`,
					"--tilt": TILTS[hash(site) % TILTS.length],
				} as CSSProperties
			}
		>
			<span>
				<span>{initial}</span>
			</span>
		</span>
	)
}

function hostOf(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./, "")
	} catch {
		return ""
	}
}
