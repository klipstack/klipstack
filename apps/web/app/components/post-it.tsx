import type { ReactNode } from "react"
import { cn } from "~/lib/utils"

/** Each note leans its own way, as paper stuck on by hand does: neighbors lean apart. */
const TILTS = {
	full: ["-rotate-[1.4deg]", "rotate-[1deg]", "-rotate-[0.6deg]", "rotate-[1.6deg]"],
	/** Barely: dense places are read, line after line. */
	compact: ["-rotate-[0.5deg]", "rotate-[0.4deg]", "-rotate-[0.25deg]", "rotate-[0.6deg]"],
} as const

/** The paper itself: its color, its ink and the serif hand every note is written in. */
const PAPER = "relative bg-note font-serif text-note-fg italic"

const VARIANTS = {
	/** Taped to the page: an edition's intro and notes, the highlights board. */
	full: "px-5 pt-6 pb-5 shadow-[0_1px_1px_rgb(0_0_0/0.08),0_12px_24px_-12px_rgb(0_0_0/0.4)]",
	/** Smaller tape and padding, for dense places: the reader's margin and sidebar. */
	compact: "px-3 pt-3.5 pb-2.5 shadow-[0_1px_1px_rgb(0_0_0/0.08),0_6px_12px_-8px_rgb(0_0_0/0.35)]",
} as const

const TAPE = {
	full: "-top-3 h-6 w-20",
	compact: "-top-2 h-4 w-12",
} as const

/** Room the padding takes beside the text, for `fit`. */
const PADDING = { full: "2.5rem", compact: "1.5rem" } as const

/** The least height, as a part of the width: never a strip. */
const LEAST_HEIGHT = { full: 0.62, compact: 0.5 } as const

/** A note's text line, in characters: never a sliver, never wider than reads well. */
const MIN_CH = 14
const MAX_CH = 52

export type PostItVariant = keyof typeof VARIANTS

/** A lean for the note of this id (`tilt`): the same every time, so a note and its editor agree. */
export function tiltFor(id: string): number {
	let n = 0
	for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0
	return n
}

/**
 * The width that makes paper for this text about square, a little wider than tall: short notes are
 * small squares, longer ones grow toward a balanced rectangle, up to the room there is. A line of c
 * characters at the notes' line height is about 2.75 characters tall, so a text of n characters is
 * square at c = √(2.75 n); √(4 n) leans it landscape. A line break starts a line of its own.
 */
export function postItSize(text: string, variant: PostItVariant = "full"): React.CSSProperties {
	// A link reads as its title: `[Title](/read/<id>)`.
	const shown = text.trim().replace(/\[([^\]]*)\]\(\/read\/[^)\s]*\)/g, "$1")
	const breaks = shown.split("\n").length - 1
	const length = shown.length + breaks * 24
	const ch = Math.round(Math.min(MAX_CH, Math.max(MIN_CH, Math.sqrt(4 * length))))
	const width = `calc(${ch}ch + ${PADDING[variant]})`
	return {
		width: `min(100%, ${width})`,
		// The least height for that width, wherever the width is: more text makes it taller.
		minHeight: `calc(${width} * ${LEAST_HEIGHT[variant]})`,
	}
}

type Props = {
	/** `full` (the default): larger tape and a clear lean. `compact`: smaller, leaning barely. */
	variant?: PostItVariant
	/** Which way the note leans, by its place in a list: neighbors lean apart. */
	tilt?: number
	/** The note's text: the paper takes the size that suits it (`postItSize`). Without, the caller sizes it. */
	fit?: string
	/** A `span` inside phrasing content, such as a button. */
	as?: "div" | "span"
	className?: string
	children: ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, "children">

/**
 * A note someone wrote, on paper taped to the page: an edition author's words, a highlight's note,
 * an article's note. One look for every note, in light and dark (`--k-note*` in app.css), unlike
 * the article's own words. Its editor sits on the same paper, so writing looks like what is
 * written. Inside, `--note-placeholder` is the ink of an empty note's placeholder.
 */
export function PostIt({
	variant = "full",
	tilt = 0,
	fit,
	as: Tag = "div",
	className,
	style,
	children,
	...props
}: Props) {
	const tilts = TILTS[variant]
	return (
		<Tag
			{...props}
			data-post-it={variant}
			style={fit === undefined ? style : { ...postItSize(fit, variant), ...style }}
			className={cn(
				PAPER,
				"[--note-placeholder:color-mix(in_oklch,var(--k-note-fg)_55%,transparent)]",
				VARIANTS[variant],
				tilts[((tilt % tilts.length) + tilts.length) % tilts.length],
				Tag === "span" && "block",
				className,
			)}
		>
			<span
				aria-hidden="true"
				data-testid="post-it-tape"
				className={cn(
					"pointer-events-none absolute left-1/2 -translate-x-1/2 rotate-[-3deg] bg-note-tape shadow-[0_1px_2px_rgb(0_0_0/0.12)]",
					TAPE[variant],
				)}
			/>
			{children}
		</Tag>
	)
}
