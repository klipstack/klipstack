import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { LinkStatus, LinkTargets } from "~/lib/note-links"
import { parse } from "~/lib/note-links"
import { cn } from "~/lib/utils"

interface Props {
	text: string
	/** What the reader knows about each target; an absent id is a link to nothing. */
	linkTargets?: LinkTargets
	/** Where Back should return to, for the chips' links. */
	from?: string
	/**
	 * Show links as emphasised text instead of links. For the sidebar list, where the whole row is
	 * one button that goes to the highlight: a second target inside it would be a trap.
	 */
	plainLinks?: boolean
}

/**
 * A note as it reads: plain text, with `[Title](/read/<id>)` shown as a chip that opens the article.
 * Nothing is ever parsed as HTML, so there is nothing to sanitize.
 */
export function NoteText({ text, linkTargets, from, plainLinks }: Props) {
	const lines = parse(text)
	return (
		<span className="whitespace-pre-wrap break-words">
			{lines.map((line, i) => (
				// oxlint-disable-next-line react/no-array-index-key -- lines have no identity of their own
				<Fragment key={i}>
					{i > 0 ? "\n" : null}
					{line.map((segment, j) =>
						segment.kind === "text" ? (
							// oxlint-disable-next-line react/no-array-index-key -- segments have no identity of their own
							<Fragment key={j}>{segment.text}</Fragment>
						) : plainLinks ? (
							<DocLinkText
								// oxlint-disable-next-line react/no-array-index-key -- the same id can appear twice
								key={j}
								title={segment.title}
								status={linkTargets ? (linkTargets[segment.id] ?? "missing") : "ok"}
							/>
						) : (
							<DocChip
								// oxlint-disable-next-line react/no-array-index-key -- the same id can appear twice
								key={j}
								id={segment.id}
								title={segment.title}
								status={linkTargets ? (linkTargets[segment.id] ?? "missing") : "ok"}
								from={from}
							/>
						),
					)}
				</Fragment>
			))}
		</span>
	)
}

/**
 * A link to another article, inline in a note. It reads as a link in prose: no pill, and a long
 * title wraps across lines rather than being cut short. Trashed and missing targets still navigate.
 */
export function DocChip({
	id,
	title,
	status = "ok",
	from,
}: {
	id: string
	title: string
	status?: LinkStatus
	from?: string
}) {
	const { t } = useTranslation("reader")
	const tooltip =
		status === "trash"
			? t("noteLinks.trash")
			: status === "missing"
				? t("noteLinks.missing")
				: undefined
	return (
		<Link
			to={`/read/${id}`}
			state={from ? { from } : undefined}
			data-testid="doc-chip"
			data-status={status}
			title={tooltip}
			// The Highlights page stretches a link over the whole card: chips stay above it.
			onClick={(e) => e.stopPropagation()}
			className={cn(
				"relative z-10 text-link underline decoration-link/40 underline-offset-2 hover:decoration-link",
				status === "trash" && "text-muted-fg line-through decoration-muted-fg/40",
				status === "missing" && "text-muted-fg decoration-muted-fg/40",
			)}
		>
			{title}
		</Link>
	)
}

/** A link that cannot be followed from here: the title, set apart, with nowhere to click. */
function DocLinkText({ title, status }: { title: string; status?: LinkStatus }) {
	const { t } = useTranslation("reader")
	return (
		<span
			data-testid="doc-link-text"
			data-status={status}
			title={
				status === "trash"
					? t("noteLinks.trash")
					: status === "missing"
						? t("noteLinks.missing")
						: undefined
			}
			className={cn(
				"font-medium text-fg",
				status === "trash" && "text-muted-fg line-through",
				status === "missing" && "text-muted-fg",
			)}
		>
			{title}
		</span>
	)
}
