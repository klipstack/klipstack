import { cn } from "~/lib/utils"

/** A book's paint, as the shelves on /topics color theirs (`--k-book-*`), at this hue. */
const book = (hue: number) => ({ fill: `oklch(var(--k-book-l) var(--k-book-c) ${hue})` })

/** Lines in the page's muted ink; wood, paper and books in the app's own tokens. */
const LINE = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const

/** An empty shelf, as /topics draws a topic: a plank, its brackets, a bookend and one book left. */
function Shelf() {
	return (
		<svg viewBox="0 0 200 110">
			<path {...LINE} d="M42 86 v12 l12 -12 M158 86 v12 l-12 -12" />
			<rect x="10" y="78" width="180" height="8" rx="1.5" fill="var(--k-shelf)" />
			<path {...LINE} d="M10 86 h180" opacity="0.5" />
			<g transform="rotate(17 136 78)">
				<rect x="127" y="42" width="9" height="36" rx="1" style={book(30)} />
				<path {...LINE} strokeWidth="1" d="M129 48 h5 M129 72 h5" opacity="0.45" />
			</g>
			<path {...LINE} fill="var(--k-bg)" d="M147 78 V48 h4 v26 h14 v4 z" />
		</svg>
	)
}

/** An empty desk, seen from above: a blank sheet, a pencil, and the ring a cup left. */
function Desk() {
	return (
		<svg viewBox="0 0 200 120">
			<rect x="8" y="8" width="184" height="104" rx="6" fill="var(--k-shelf)" />
			<path {...LINE} strokeWidth="1" opacity="0.18" d="M20 30 q60 -6 160 0 M20 96 q70 5 160 -2" />
			<g transform="rotate(-5 89 60)">
				<rect x="61" y="27" width="58" height="72" fill="rgb(0 0 0 / 0.12)" />
				<rect x="59" y="24" width="58" height="72" fill="var(--k-paper)" />
				<rect {...LINE} strokeWidth="1" x="59" y="24" width="58" height="72" opacity="0.35" />
			</g>
			<g transform="rotate(38 150 44)">
				<rect x="128" y="40.5" width="40" height="7" rx="1" fill="var(--k-note)" />
				<path d="M168 41 l9 3 l-9 3 z" fill="var(--k-paper)" />
				<path d="M174.3 43.1 l2.7 0.9 l-2.7 0.9 z" fill="currentColor" />
				<rect x="124" y="41" width="4" height="6" rx="1" style={book(10)} />
				<path {...LINE} strokeWidth="1" d="M128 44 h40" opacity="0.3" />
			</g>
			<circle {...LINE} cx="160" cy="88" r="11" opacity="0.25" />
		</svg>
	)
}

const DRAWINGS = { shelf: Shelf, desk: Desk } as const

export type EmptyDrawingName = keyof typeof DRAWINGS

/**
 * A small drawing for a page with nothing on it yet, in place of an icon: the thing the reader
 * fills, waiting. Lines in muted ink, in the app's wood, paper and book colors, light and dark.
 * Decoration: the page's words say what is empty.
 */
export function EmptyDrawing({ name, className }: { name: EmptyDrawingName; className?: string }) {
	const Drawing = DRAWINGS[name]
	return (
		<span
			aria-hidden="true"
			data-empty-drawing={name}
			className={cn(
				"block w-40 text-muted-fg [&_svg]:block [&_svg]:h-auto [&_svg]:w-full",
				className,
			)}
		>
			<Drawing />
		</span>
	)
}
