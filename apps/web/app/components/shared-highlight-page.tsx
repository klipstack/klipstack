import { parse } from "@klipstack/api-contract/note-links"
import { Fragment } from "react"
import { safeHost } from "~/lib/site-label"
import type { ShareSnapshot } from "~/services/highlight-shares.server"
import { BrandMarkSmall } from "./brand-mark"
import { ClippingPaper } from "./clipping"
import { CreditLine } from "./credit-line"
import { PostIt, tiltFor } from "./post-it"
import { quoteSize } from "./quote-card"

/** Links out of a public page: no endorsement for search engines, no handle on this window. */
const OUTBOUND = "nofollow ugc noopener"

/** A run of a note's line: text, or a link to the original of an article the note links to. */
export interface NoteRun {
	text: string
	href: string | null
}

/**
 * What the page shows of a snapshot, and only that: the note as runs of text and links to
 * originals, with no trace of the sharer's library (its article ids, the links' raw markup).
 */
export interface SharedHighlightView {
	exact: string
	locale: string
	article: ShareSnapshot["article"]
	note: NoteRun[][] | null
}

export function sharedHighlightView(snapshot: ShareSnapshot): SharedHighlightView {
	return {
		exact: snapshot.exact,
		locale: snapshot.locale,
		article: snapshot.article,
		note: snapshot.note ? noteRuns(snapshot.note, snapshot.linkUrls) : null,
	}
}

/** A link goes to its article's original when that is a web address; else it reads as its title. */
function noteRuns(note: string, urls: Record<string, string>): NoteRun[][] {
	return parse(note).map((line) =>
		line.map((segment) => {
			if (segment.kind === "text") return { text: segment.text, href: null }
			const url = urls[segment.id]
			return url && /^https?:\/\//i.test(url)
				? { text: segment.title || safeHost(url), href: url }
				: { text: segment.title, href: null }
		}),
	)
}

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
	view,
	labels,
	reportHref,
}: {
	/** Chooses the clipping's cut and the note's lean. */
	id: string
	view: SharedHighlightView
	labels: SharedHighlightLabels
	reportHref: string
}) {
	const { article, note } = view
	// Unclamped: `getPublicShare` already cut the quote and the note to 100 words or 600 characters,
	// and a clamp would hide lines of a short poem while its text stays in the page.
	const host = safeHost(article.url)
	const web = /^https?:\/\//i.test(article.url)
	return (
		<div lang={view.locale} className="min-h-dvh bg-bg text-fg">
			<main className="mx-auto flex max-w-xl flex-col px-5 pt-[calc(env(safe-area-inset-top)+3rem)] pb-12 sm:pt-[calc(env(safe-area-inset-top)+5rem)]">
				{/* Plain: the marker is the app's, and the color means something to its owner only. */}
				<figure
					data-testid="shared-highlight"
					className="clipping px-6 pt-[calc(var(--clip-top)+1.25rem)] pb-5"
				>
					<ClippingPaper id={id} />
					<span
						aria-hidden
						className="-mb-3 block h-10 font-serif text-6xl leading-none text-muted-fg"
					>
						“
					</span>
					<blockquote
						className={`font-serif text-fg whitespace-pre-line break-words ${quoteSize(view.exact).replace("line-clamp-[14] ", "")}`}
					>
						{view.exact}
					</blockquote>
					{note ? (
						<PostIt
							as="div"
							fit={note.map((line) => line.map((run) => run.text).join("")).join("\n")}
							tilt={tiltFor(id)}
							aria-label={labels.noteLabel}
							className="mt-6 -mr-3 ml-auto text-lg leading-snug"
						>
							<NoteWithLinks note={note} />
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
						<CreditLine article={article} className="text-sm text-muted-fg" />
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

/** The note, its links going to the linked articles' originals. */
function NoteWithLinks({ note }: { note: NoteRun[][] }) {
	return (
		<span className="whitespace-pre-wrap break-words">
			{note.map((line, i) => (
				// oxlint-disable-next-line react/no-array-index-key -- lines have no identity of their own
				<Fragment key={i}>
					{i > 0 ? "\n" : null}
					{line.map((run, j) =>
						run.href ? (
							<a
								// oxlint-disable-next-line react/no-array-index-key -- the same link can appear twice
								key={j}
								href={run.href}
								rel={OUTBOUND}
								className="underline decoration-1 underline-offset-2"
							>
								{run.text}
							</a>
						) : (
							// oxlint-disable-next-line react/no-array-index-key -- runs have no identity of their own
							<Fragment key={j}>{run.text}</Fragment>
						),
					)}
				</Fragment>
			))}
		</span>
	)
}
