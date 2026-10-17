import { StyleSheet, View } from "react-native"
import Svg, { Circle, G, Path, Rect } from "react-native-svg"
import { type Colors, useColors, useScheme } from "@/lib/theme"
import { bookColor } from "@/lib/topic-shelves"

/**
 * A small drawing for a page with nothing on it yet, in place of an icon: the thing the reader
 * fills, waiting. The web's (apps/web/app/components/empty-drawing.tsx), line for line: lines in
 * the muted ink, wood, paper and books in the app's colors, light and dark. Decoration: the page's
 * words say what is empty, so VoiceOver skips it.
 */
export function EmptyDrawing({ name, width = 160 }: { name: EmptyDrawingName; width?: number }) {
	const colors = useColors()
	const scheme = useScheme()
	const Drawing = DRAWINGS[name]
	const [, , w, h] = VIEWBOX[name].split(" ").map(Number) as [number, number, number, number]
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[styles.drawing, { width, height: (width * h) / w }]}
		>
			<Svg viewBox={VIEWBOX[name]} width="100%" height="100%" color={colors.mutedFg}>
				<Drawing ink={{ ...colors, book: (hue: number) => bookColor(hue, scheme) }} />
			</Svg>
		</View>
	)
}

type Ink = Colors & { book: (hue: number) => string }

/** Lines in the page's muted ink. */
const LINE = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const

/** A shadow under a sheet: the web's rgb(0 0 0 / 0.12). */
const SHADOW = "#0000001f"

/** An empty shelf: a plank, its brackets, a bookend and one book left. */
function Shelf({ ink }: { ink: Ink }) {
	return (
		<>
			<Path {...LINE} d="M42 86 v12 l12 -12 M158 86 v12 l-12 -12" />
			<Rect x="10" y="78" width="180" height="8" rx="1.5" fill={ink.shelf.board} />
			<Path {...LINE} d="M10 86 h180" opacity={0.5} />
			<G rotation={17} originX={136} originY={78}>
				<Rect x="127" y="42" width="9" height="36" rx="1" fill={ink.book(30)} />
				<Path {...LINE} strokeWidth={1} d="M129 48 h5 M129 72 h5" opacity={0.45} />
			</G>
			<Path {...LINE} fill={ink.bg} d="M147 78 V48 h4 v26 h14 v4 z" />
		</>
	)
}

/** A lamp's light is light in either theme: a lit shade does not darken with the page. */
const LAMPLIGHT = "#f6dd90"

/** Home with nothing to read: an empty armchair by a lit floor lamp. */
function Chair({ ink }: { ink: Ink }) {
	return (
		<>
			<Path d="M149 38 L136 100 H182 L169 38 z" fill={LAMPLIGHT} opacity={0.28} />
			<Path {...LINE} d="M20 100 h164" opacity={0.4} />
			<Path {...LINE} d="M58 92 v8 M126 92 v8 M159 38 V98 M150 100 h18" />
			<Rect x="62" y="30" width="60" height="50" rx="12" fill={ink.book(25)} />
			<Rect x="66" y="70" width="52" height="16" rx="4" fill={ink.book(35)} />
			<Rect x="48" y="56" width="18" height="38" rx="7" fill={ink.book(25)} />
			<Rect x="118" y="56" width="18" height="38" rx="7" fill={ink.book(25)} />
			<Path {...LINE} strokeWidth={1} d="M66 70 h52 M66 86 h52" opacity={0.3} />
			<Path d="M149 38 h20 l-4 -16 h-12 z" fill={LAMPLIGHT} />
			<Path {...LINE} strokeWidth={1} d="M149 38 h20 l-4 -16 h-12 z" opacity={0.4} />
		</>
	)
}

/** An empty library: a bookcase with nothing on its shelves, a plant on top. */
function Bookcase({ ink }: { ink: Ink }) {
	return (
		<>
			<Path {...LINE} d="M30 104 h140" opacity={0.4} />
			<Rect x="62" y="14" width="76" height="90" rx="2" fill={ink.shelf.board} />
			<Rect x="68" y="20" width="64" height="78" fill={ink.bg} opacity={0.7} />
			<Rect x="68" y="44" width="64" height="4" fill={ink.shelf.board} />
			<Rect x="68" y="70" width="64" height="4" fill={ink.shelf.board} />
			<Path {...LINE} strokeWidth={1} d="M68 48 h64 M68 74 h64 M68 98 h64" opacity={0.3} />
			<Path d="M110 6 h14 l-2 8 h-10 z" fill={ink.book(40)} />
			<Path
				{...LINE}
				strokeWidth={1.2}
				d="M117 6 q-6 -5 -10 -3 M117 6 q1 -5 6 -6 M117 6 q6 -2 10 1"
			/>
		</>
	)
}

/** An empty archive: a cardboard box, its lid lifted, its label blank. */
function ArchiveBox({ ink }: { ink: Ink }) {
	return (
		<>
			<Path {...LINE} d="M30 102 h140" opacity={0.4} />
			<Rect x="56" y="50" width="88" height="52" rx="2" fill={ink.shelf.board} />
			<Rect x="56" y="50" width="88" height="4" fill="currentColor" opacity={0.2} />
			<Rect {...LINE} strokeWidth={1} x="88" y="60" width="24" height="7" rx="3.5" opacity={0.5} />
			<Rect x="82" y="76" width="36" height="14" fill={ink.paper} />
			<Rect {...LINE} strokeWidth={1} x="82" y="76" width="36" height="14" opacity={0.35} />
			<G rotation={-7} originX={100} originY={40}>
				<Rect x="52" y="34" width="96" height="11" rx="2" fill={ink.shelf.board} />
				<Path {...LINE} strokeWidth={1} d="M52 45 h96" opacity={0.4} />
			</G>
		</>
	)
}

/** An empty trash: a wicker wastebasket. */
function Basket({ ink }: { ink: Ink }) {
	return (
		<>
			<Path {...LINE} d="M40 102 h120" opacity={0.4} />
			<Path d="M70 32 H130 L122 102 H78 z" fill={ink.shelf.board} />
			<Path
				{...LINE}
				strokeWidth={1}
				opacity={0.35}
				d="M71.6 46 H128.4 M73.2 60 H126.8 M74.8 74 H125.2 M76.4 88 H123.6 M85 32 L89 102 M100 32 V102 M115 32 L111 102"
			/>
			<Rect x="66" y="27" width="68" height="7" rx="3.5" fill={ink.shelf.board} />
			<Rect {...LINE} strokeWidth={1} x="66" y="27" width="68" height="7" rx="3.5" opacity={0.4} />
		</>
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
function Stickers({ ink }: { ink: Ink }) {
	const stars = [32, 54, 76].flatMap((y) => [80, 100, 120].map((x) => star(x - 1, y - 3, 8)))
	return (
		<G rotation={-4} originX={100} originY={55}>
			<Rect x="65" y="16" width="72" height="80" rx="3" fill={SHADOW} />
			<Rect x="63" y="13" width="72" height="80" rx="3" fill={ink.paper} />
			<Rect {...LINE} strokeWidth={1} x="63" y="13" width="72" height="80" rx="3" opacity={0.35} />
			{stars.map((d) => (
				<Path key={d} d={d} fill={ink.favorite} />
			))}
		</G>
	)
}

/** No tags: blank paper tags on a string, hanging from a nail. */
function Tags({ ink }: { ink: Ink }) {
	const tags = [
		{ x: 64, y: 40, turn: -12, hue: 80 },
		{ x: 100, y: 52, turn: 3, hue: 200 },
		{ x: 136, y: 36, turn: 14, hue: 330 },
	]
	const shape = (x: number, y: number) =>
		`M${x - 12} ${y + 9} L${x} ${y} L${x + 12} ${y + 9} V${y + 46} H${x - 12} z`
	return (
		<>
			<Path
				{...LINE}
				strokeWidth={1}
				d={tags.map((tag) => `M100 10 L${tag.x} ${tag.y + 8}`).join(" ")}
			/>
			{tags.map(({ x, y, turn, hue }) => (
				<G key={x} rotation={turn} originX={x} originY={y + 8}>
					<Path d={shape(x, y)} fill={ink.book(hue)} />
					<Path {...LINE} strokeWidth={1} opacity={0.35} d={shape(x, y)} />
					<Circle cx={x} cy={y + 8} r="2.2" fill={ink.bg} />
				</G>
			))}
			<Circle cx="100" cy="10" r="2.5" fill="currentColor" />
		</>
	)
}

const DRAWINGS = {
	shelf: Shelf,
	chair: Chair,
	bookcase: Bookcase,
	box: ArchiveBox,
	basket: Basket,
	stickers: Stickers,
	tags: Tags,
} as const

const VIEWBOX: Record<EmptyDrawingName, string> = {
	shelf: "0 0 200 110",
	chair: "0 0 200 110",
	bookcase: "0 0 200 110",
	box: "0 0 200 110",
	basket: "0 0 200 110",
	stickers: "0 0 200 110",
	tags: "0 0 200 110",
}

export type EmptyDrawingName = keyof typeof DRAWINGS

const styles = StyleSheet.create({ drawing: { alignSelf: "center" } })
