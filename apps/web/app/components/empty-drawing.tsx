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

/** A lamp's light is light in either theme: a lit shade does not darken with the page. */
const LAMPLIGHT = "oklch(0.9 0.1 92)"

/** Home with nothing to read: an empty armchair by a lit floor lamp. */
function Chair() {
	return (
		<svg viewBox="0 0 200 110">
			<path d="M149 38 L136 100 H182 L169 38 z" fill={LAMPLIGHT} opacity="0.28" />
			<path {...LINE} d="M20 100 h164" opacity="0.4" />
			<path {...LINE} d="M58 92 v8 M126 92 v8 M159 38 V98 M150 100 h18" />
			<rect x="62" y="30" width="60" height="50" rx="12" style={book(25)} />
			<rect x="66" y="70" width="52" height="16" rx="4" style={book(35)} />
			<rect x="48" y="56" width="18" height="38" rx="7" style={book(25)} />
			<rect x="118" y="56" width="18" height="38" rx="7" style={book(25)} />
			<path {...LINE} strokeWidth="1" d="M66 70 h52 M66 86 h52" opacity="0.3" />
			<path d="M149 38 h20 l-4 -16 h-12 z" fill={LAMPLIGHT} />
			<path {...LINE} strokeWidth="1" d="M149 38 h20 l-4 -16 h-12 z" opacity="0.4" />
		</svg>
	)
}

/** An empty library: a bookcase with nothing on its shelves, a plant on top. */
function Bookcase() {
	return (
		<svg viewBox="0 0 200 110">
			<path {...LINE} d="M30 104 h140" opacity="0.4" />
			<rect x="62" y="14" width="76" height="90" rx="2" fill="var(--k-shelf)" />
			<rect x="68" y="20" width="64" height="78" fill="var(--k-bg)" opacity="0.7" />
			<rect x="68" y="44" width="64" height="4" fill="var(--k-shelf)" />
			<rect x="68" y="70" width="64" height="4" fill="var(--k-shelf)" />
			<path {...LINE} strokeWidth="1" d="M68 48 h64 M68 74 h64 M68 98 h64" opacity="0.3" />
			<path d="M110 6 h14 l-2 8 h-10 z" style={book(40)} />
			<path
				{...LINE}
				strokeWidth="1.2"
				d="M117 6 q-6 -5 -10 -3 M117 6 q1 -5 6 -6 M117 6 q6 -2 10 1"
			/>
		</svg>
	)
}

/** An empty archive: a cardboard box, its lid lifted, its label blank. */
function ArchiveBox() {
	return (
		<svg viewBox="0 0 200 110">
			<path {...LINE} d="M30 102 h140" opacity="0.4" />
			<rect x="56" y="50" width="88" height="52" rx="2" fill="var(--k-shelf)" />
			<rect x="56" y="50" width="88" height="4" fill="currentColor" opacity="0.2" />
			<rect {...LINE} strokeWidth="1" x="88" y="60" width="24" height="7" rx="3.5" opacity="0.5" />
			<rect x="82" y="76" width="36" height="14" fill="var(--k-paper)" />
			<rect {...LINE} strokeWidth="1" x="82" y="76" width="36" height="14" opacity="0.35" />
			<g transform="rotate(-7 100 40)">
				<rect x="52" y="34" width="96" height="11" rx="2" fill="var(--k-shelf)" />
				<path {...LINE} strokeWidth="1" d="M52 45 h96" opacity="0.4" />
			</g>
		</svg>
	)
}

/** An empty trash: a wicker wastebasket. */
function Basket() {
	return (
		<svg viewBox="0 0 200 110">
			<path {...LINE} d="M40 102 h120" opacity="0.4" />
			<path d="M70 32 H130 L122 102 H78 z" fill="var(--k-shelf)" />
			<path
				{...LINE}
				strokeWidth="1"
				opacity="0.35"
				d="M71.6 46 H128.4 M73.2 60 H126.8 M74.8 74 H125.2 M76.4 88 H123.6 M85 32 L89 102 M100 32 V102 M115 32 L111 102"
			/>
			<rect x="66" y="27" width="68" height="7" rx="3.5" fill="var(--k-shelf)" />
			<rect {...LINE} strokeWidth="1" x="66" y="27" width="68" height="7" rx="3.5" opacity="0.4" />
		</svg>
	)
}

/** No feeds: a mailbox on its post, its flag down. */
function Mailbox() {
	return (
		<svg viewBox="0 0 200 110">
			<path {...LINE} d="M40 102 h120" opacity="0.4" />
			<rect x="95" y="58" width="10" height="44" fill="var(--k-shelf)" />
			<path d="M60 60 V38 Q60 24 74 24 H126 Q140 24 140 38 V60 z" style={book(220)} />
			<path {...LINE} strokeWidth="1" d="M66 30 V60" opacity="0.35" />
			<path {...LINE} d="M136 46 H152" />
			<rect x="148" y="46" width="7" height="13" rx="1" style={book(15)} />
		</svg>
	)
}

/** A five-pointed star of radius `r` at (`cx`, `cy`), as a path. */
function star(cx: number, cy: number, r: number) {
	const points = Array.from({ length: 10 }, (_, i) => {
		const radius = i % 2 ? r * 0.45 : r
		const angle = (Math.PI / 5) * i - Math.PI / 2
		return `${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`
	})
	return `M${points.join(" L")} z`
}

/** Nothing starred: a sheet of gold star stickers, every one still on it. */
function Stickers() {
	const stars = [32, 54, 76].flatMap((y) => [80, 100, 120].map((x) => star(x, y, 8)))
	return (
		<svg viewBox="0 0 200 110">
			<g transform="rotate(-4 100 55)">
				<rect x="65" y="16" width="72" height="80" rx="3" fill="rgb(0 0 0 / 0.12)" />
				<rect x="63" y="13" width="72" height="80" rx="3" fill="var(--k-paper)" />
				<rect
					{...LINE}
					strokeWidth="1"
					x="63"
					y="13"
					width="72"
					height="80"
					rx="3"
					opacity="0.35"
				/>
				{stars.map((d) => (
					<path key={d} d={d} fill="var(--k-favorite)" transform="translate(-1 -3)" />
				))}
			</g>
		</svg>
	)
}

/** No tags: blank paper tags on a string, hanging from a nail. */
function Tags() {
	const tags = [
		{ x: 64, y: 40, turn: -12, hue: 80 },
		{ x: 100, y: 52, turn: 3, hue: 200 },
		{ x: 136, y: 36, turn: 14, hue: 330 },
	]
	const shape = (x: number, y: number) =>
		`M${x - 12} ${y + 9} L${x} ${y} L${x + 12} ${y + 9} V${y + 46} H${x - 12} z`
	return (
		<svg viewBox="0 0 200 110">
			<path
				{...LINE}
				strokeWidth="1"
				d={tags.map((tag) => `M100 10 L${tag.x} ${tag.y + 8}`).join(" ")}
			/>
			{tags.map(({ x, y, turn, hue }) => (
				<g key={x} transform={`rotate(${turn} ${x} ${y + 8})`}>
					<path d={shape(x, y)} style={book(hue)} />
					<path {...LINE} strokeWidth="1" opacity="0.35" d={shape(x, y)} />
					<circle cx={x} cy={y + 8} r="2.2" fill="var(--k-bg)" />
				</g>
			))}
			<circle cx="100" cy="10" r="2.5" fill="currentColor" />
		</svg>
	)
}

const DRAWINGS = {
	shelf: Shelf,
	desk: Desk,
	chair: Chair,
	bookcase: Bookcase,
	box: ArchiveBox,
	basket: Basket,
	mailbox: Mailbox,
	stickers: Stickers,
	tags: Tags,
} as const

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
