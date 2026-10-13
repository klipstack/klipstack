import type { ReactNode } from "react"
import { cn } from "~/lib/utils"

/** Each full note leans its own way, as paper stuck on by hand does. */
const TILTS = ["-rotate-[1.4deg]", "rotate-[1deg]", "-rotate-[0.6deg]", "rotate-[1.6deg]"]

/** The paper itself: its color, its ink and the serif hand every note is written in. */
const PAPER = "bg-note font-serif text-note-fg italic"

const VARIANTS = {
	/** Taped to the page and leaning: an edition's intro and notes. */
	full: "relative px-5 pt-6 pb-5 shadow-[0_1px_1px_rgb(0_0_0/0.08),0_12px_24px_-12px_rgb(0_0_0/0.4)]",
	/** Square, without tape, for dense places: the reader's margin and sidebar, the highlights list. */
	compact: "px-3 py-2 shadow-[0_1px_1px_rgb(0_0_0/0.08),0_6px_12px_-8px_rgb(0_0_0/0.35)]",
} as const

export type PostItVariant = keyof typeof VARIANTS

type Props = {
	/** `full` (the default): tilted, with tape. `compact`: neither. */
	variant?: PostItVariant
	/** Which way a full note leans, by its place in a list: neighbors lean apart. */
	tilt?: number
	/** A `span` inside phrasing content, such as a button. */
	as?: "div" | "span"
	className?: string
	children: ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, "children">

/**
 * A note someone wrote, on paper stuck to the page: an edition author's words, a highlight's note,
 * an article's note. One look for every note, in light and dark (`--k-note*` in app.css), unlike
 * the article's own words. Its editor sits on the same paper, so writing looks like what is
 * written. Inside, `--note-placeholder` is the ink of an empty note's placeholder.
 */
export function PostIt({
	variant = "full",
	tilt = 0,
	as: Tag = "div",
	className,
	children,
	...props
}: Props) {
	return (
		<Tag
			{...props}
			data-post-it={variant}
			className={cn(
				PAPER,
				"[--note-placeholder:color-mix(in_oklch,var(--k-note-fg)_55%,transparent)]",
				VARIANTS[variant],
				variant === "full" && TILTS[tilt % TILTS.length],
				Tag === "span" && "block",
				className,
			)}
		>
			{variant === "full" ? (
				<span
					aria-hidden="true"
					className="absolute -top-3 left-1/2 h-6 w-20 -translate-x-1/2 rotate-[-3deg] bg-note-tape shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
				/>
			) : null}
			{children}
		</Tag>
	)
}
