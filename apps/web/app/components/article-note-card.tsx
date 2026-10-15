import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import type { LinkTargets } from "~/lib/note-links"
import { sourceLabel } from "~/lib/site-label"
import { cn } from "~/lib/utils"
import { ClippingPaper } from "./clipping"
import { NoteText } from "./note-text"
import { NotebookNote } from "./notebook-note"
import { PostIt, tiltFor } from "./post-it"
import { ArticleThumb, DEALT } from "./quote-card"

export interface ArticleNoteCardNote {
	documentId: string
	documentTitle: string | null
	author: string | null
	siteName: string | null
	sourceUrl: string
	image: string | null
	note: string
	/** As the server sent it, to the millisecond: what a save in place replaces. */
	noteUpdatedAt: string | null
}

/**
 * An article's note among the Notebook's cards. It is a clipping like a highlight's, with the article
 * where the quote would be: a small cover, the title set as a book's, author and site in small
 * caps. The note is a large post-it stuck on it, written on in place. `dealt` tilts the card by
 * its place in a Shuffle hand. `readOnly` shows the note without its editor: where the same note
 * is on the page twice (an article in two topics), only one may write it.
 */
export function ArticleNoteCard({
	n,
	linkTargets,
	dealt,
	readOnly = false,
}: {
	n: ArticleNoteCardNote
	linkTargets: LinkTargets
	dealt?: number
	readOnly?: boolean
}) {
	const { t } = useTranslation("reader")
	const location = useLocation()
	const title = n.documentTitle || n.sourceUrl
	const byline = [n.author, sourceLabel(n)].filter(Boolean)
	return (
		<li
			data-testid="note-card"
			className={cn(
				"group clipping mb-1 break-inside-avoid px-5 pt-[calc(var(--clip-top)+1rem)] pb-3 transition-transform motion-reduce:transition-none",
				dealt !== undefined && cn(DEALT[dealt % DEALT.length], "hover:rotate-0"),
			)}
		>
			<ClippingPaper id={n.documentId} />
			<div className="flex items-start gap-3">
				<ArticleThumb
					image={n.image}
					sourceUrl={n.sourceUrl}
					siteName={n.siteName}
					className="size-14"
				/>
				<div className="min-w-0 flex-1">
					<Link
						to={`/read/${n.documentId}#note`}
						state={{ from: location.pathname + location.search }}
						aria-label={t("notebook.open", { title })}
						className="line-clamp-3 font-serif text-xl leading-snug italic hover:underline"
					>
						{title}
					</Link>
					{byline.length ? (
						<p className="mt-0.5 truncate text-sm tracking-wide text-muted-fg [font-variant-caps:all-small-caps]">
							{byline.join(" · ")}
						</p>
					) : null}
				</div>
			</div>
			<div className="mt-6 -mr-2 ml-1">
				{readOnly ? (
					<PostIt
						fit={n.note}
						tilt={tiltFor(n.documentId)}
						style={{ width: "100%" }}
						data-testid="note-read-only"
						className="mb-7 text-lg leading-snug"
					>
						<NoteText text={n.note} linkTargets={linkTargets} />
					</PostIt>
				) : (
					<NotebookNote
						documentId={n.documentId}
						title={title}
						note={n.note}
						noteUpdatedAt={n.noteUpdatedAt}
						linkTargets={linkTargets}
						tilt={tiltFor(n.documentId)}
						large
					/>
				)}
			</div>
		</li>
	)
}
