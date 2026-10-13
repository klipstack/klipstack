import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import type { LinkTargets } from "~/lib/note-links"
import { sourceLabel } from "~/lib/site-label"
import { cn } from "~/lib/utils"
import { NotebookNote } from "./notebook-note"
import { tiltFor } from "./post-it"
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
 * An article's note among the Notebook's cards. It is a card like a highlight's, with the article
 * where the quote would be: a small cover, the title set as a book's, author and site in small
 * caps. The note is a large post-it stuck on it, written on in place. `dealt` tilts the card by
 * its place in a Shuffle hand.
 */
export function ArticleNoteCard({
	n,
	linkTargets,
	dealt,
}: {
	n: ArticleNoteCardNote
	linkTargets: LinkTargets
	dealt?: number
}) {
	const { t } = useTranslation("reader")
	const location = useLocation()
	const title = n.documentTitle || n.sourceUrl
	const byline = [n.author, sourceLabel(n)].filter(Boolean)
	return (
		<li
			data-testid="note-card"
			className={cn(
				"group relative isolate mb-5 break-inside-avoid rounded-2xl border border-border bg-card px-5 pt-4 pb-3 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-[box-shadow,transform] hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.3)]",
				dealt !== undefined && cn(DEALT[dealt % DEALT.length], "hover:rotate-0"),
			)}
		>
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
				<NotebookNote
					documentId={n.documentId}
					title={title}
					note={n.note}
					noteUpdatedAt={n.noteUpdatedAt}
					linkTargets={linkTargets}
					tilt={tiltFor(n.documentId)}
					large
				/>
			</div>
		</li>
	)
}
