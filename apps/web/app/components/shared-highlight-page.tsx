import { parse } from "@klipstack/api-contract/note-links"
import { Fragment } from "react"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import { safeHost, siteLabel } from "~/lib/site-label"
import type { ShareSnapshot } from "~/services/highlight-shares.server"
import { BrandMarkSmall } from "./brand-mark"
import { ClippingPaper } from "./clipping"
import { PostIt, tiltFor } from "./post-it"
import { quoteSize } from "./quote-card"

/** Links out of a public page: no endorsement for search engines, no handle on this window. */
const OUTBOUND = "nofollow ugc noopener"

/** The page's words, in the sharer's language. */
export interface SharedHighlightLabels {
	readArticle: string
	noteLabel: string
	madeWith: string
	report: string
	terms: string
	privacy: string
}

/**
 * A shared highlight, for anyone with its link: the quote on a clipping as the Notebook shows it,
 * the note on its post-it, and the article it came from, linked to where it was published.
 * Server-rendered and readable without JavaScript. Nothing names the reader who shared it.
 */
export function SharedHighlightPage({
	id,
	snapshot,
	labels,
	reportHref,
}: {
	/** Chooses the clipping's cut and the note's lean. */
	id: string
	snapshot: ShareSnapshot
	labels: SharedHighlightLabels
	reportHref: string
}) {
	const { article } = snapshot
	const host = safeHost(article.url)
	const web = /^https?:\/\//i.test(article.url)
	return (
		<div lang={snapshot.locale} className="min-h-dvh bg-bg text-fg">
			<main className="mx-auto flex max-w-xl flex-col px-5 pt-[calc(env(safe-area-inset-top)+3rem)] pb-12 sm:pt-[calc(env(safe-area-inset-top)+5rem)]">
				<figure
					{...highlightColor(snapshot.color)}
					data-testid="shared-highlight"
					className="clipping px-6 pt-[calc(var(--clip-top)+1.25rem)] pb-5"
				>
					<ClippingPaper id={id} />
					<span
						aria-hidden
						className="-mb-3 block h-10 font-serif text-6xl leading-none text-(--hl-solid)"
					>
						“
					</span>
					<blockquote
						className={`font-serif text-fg ${quoteSize(snapshot.exact).replace("line-clamp-[14] ", "")}`}
					>
						<span className="marker">{snapshot.exact}</span>
					</blockquote>
					{snapshot.note ? (
						<PostIt
							as="div"
							fit={snapshot.note}
							color={highlightColorName(snapshot.color)}
							tilt={tiltFor(id)}
							aria-label={labels.noteLabel}
							className="mt-6 -mr-3 ml-auto text-lg leading-snug"
						>
							<NoteWithLinks note={snapshot.note} urls={snapshot.linkUrls} />
						</PostIt>
					) : null}
					<figcaption className="mt-6 border-t border-border pt-3">
						{web ? (
							<a
								href={article.url}
								rel={OUTBOUND}
								className="line-clamp-2 font-medium leading-snug hover:underline"
							>
								{article.title ?? host}
							</a>
						) : (
							<span className="line-clamp-2 font-medium leading-snug">{article.title ?? host}</span>
						)}
						<span className="block truncate text-sm text-muted-fg">
							{siteLabel(article.siteName, host)}
						</span>
					</figcaption>
				</figure>
				{web ? (
					<a
						href={article.url}
						rel={OUTBOUND}
						className="mt-8 self-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90"
					>
						{labels.readArticle}
					</a>
				) : null}
				<footer className="mt-16 flex flex-col items-center gap-4 border-t border-border pt-8">
					<a
						href="/"
						className="inline-flex items-center gap-2 text-sm text-muted-fg hover:text-fg"
					>
						<BrandMarkSmall className="h-5 w-auto text-accent" />
						{labels.madeWith}
					</a>
					<nav className="flex gap-4 text-xs text-muted-fg">
						<a href={reportHref} rel="nofollow" className="hover:text-fg hover:underline">
							{labels.report}
						</a>
						<a href="/terms" className="hover:text-fg hover:underline">
							{labels.terms}
						</a>
						<a href="/privacy" className="hover:text-fg hover:underline">
							{labels.privacy}
						</a>
					</nav>
				</footer>
			</main>
		</div>
	)
}

/** The note as written: a link to an article goes to its original, or reads as its title. */
function NoteWithLinks({ note, urls }: { note: string; urls: Record<string, string> }) {
	return (
		<span className="whitespace-pre-wrap break-words">
			{parse(note).map((line, i) => (
				// oxlint-disable-next-line react/no-array-index-key -- lines have no identity of their own
				<Fragment key={i}>
					{i > 0 ? "\n" : null}
					{line.map((segment, j) => {
						if (segment.kind === "text")
							// oxlint-disable-next-line react/no-array-index-key -- segments have no identity of their own
							return <Fragment key={j}>{segment.text}</Fragment>
						const url = urls[segment.id]
						return url && /^https?:\/\//i.test(url) ? (
							<a
								// oxlint-disable-next-line react/no-array-index-key -- the same id can appear twice
								key={j}
								href={url}
								rel={OUTBOUND}
								className="underline decoration-1 underline-offset-2"
							>
								{segment.title || safeHost(url)}
							</a>
						) : (
							// oxlint-disable-next-line react/no-array-index-key -- the same id can appear twice
							<Fragment key={j}>{segment.title}</Fragment>
						)
					})}
				</Fragment>
			))}
		</span>
	)
}
