import { Fragment, type ReactNode, useRef } from "react"
import { parseEditionText } from "~/lib/edition-text"
import type { EditionItemView, EditionLink, EditionView } from "~/lib/edition-view"
import { cn } from "~/lib/utils"
import { BrandMarkSmall } from "./brand-mark"
import { ClippingPaper } from "./clipping"
import { CurrentMarker } from "./edition-current-marker"
import { PostIt } from "./post-it"

/** Links out of a public page: no endorsement for search engines, no handle on this window. */
const OUTBOUND = "nofollow ugc noopener"

/**
 * A published edition, or the preview of a working copy. Server-rendered and readable without
 * JavaScript: plain links and text. Script adds only the marker beside the article in the middle
 * of the screen. It sizes itself to its container, not the window, so the editor's preview pane
 * shows it as a window that wide would. There (`newTab`), links open in a new tab, so following
 * one leaves the editor where it was. `reportHref` is the public page's report form; the
 * owner's preview has none.
 */
export function EditionPage({
	view,
	banner,
	newTab = false,
	reportHref,
}: {
	view: EditionView
	banner?: ReactNode
	newTab?: boolean
	reportHref?: string
}) {
	const list = useRef<HTMLDivElement>(null)
	return (
		<div lang={view.locale} className="@container min-h-dvh bg-bg text-fg">
			{banner}
			{/* The safe area adds to the top space. `.safe-top` would replace it: it wins over utilities. */}
			<main className="mx-auto max-w-2xl px-5 pt-[calc(env(safe-area-inset-top)+3rem)] pb-12 @xl:px-8 @xl:pt-[calc(env(safe-area-inset-top)+5rem)]">
				<header className="border-b border-border pb-8">
					<h1 className="font-serif text-3xl leading-tight tracking-tight text-balance @xl:text-4xl">
						{view.title}
					</h1>
					<p className="mt-3 text-sm text-muted-fg">
						<span className="font-medium text-fg">{view.authorName}</span>
						{view.date ? (
							<>
								<Dot />
								{view.date}
							</>
						) : null}
						{view.updated ? (
							<>
								<Dot />
								{view.updated}
							</>
						) : null}
					</p>
					{view.intro ? (
						<PostIt
							data-testid="edition-intro"
							tilt={0}
							className="mt-10 aspect-[2/1] w-fit max-w-[30rem] min-w-[min(16rem,100%)]"
						>
							<EditionText
								text={view.intro}
								anchors={view.anchors}
								newTab={newTab}
								className="text-lg leading-relaxed"
							/>
							<p className="mt-3 text-right text-base">— {view.authorName}</p>
						</PostIt>
					) : null}
				</header>
				<div ref={list} className="relative">
					{/* First, so the lead image covers it rather than the other way round. */}
					<CurrentMarker list={list} />
					<ol className="list-none divide-y divide-border">
						{view.items.map((item, i) => (
							<Item
								key={item.anchor}
								item={item}
								index={i}
								anchors={view.anchors}
								newTab={newTab}
							/>
						))}
					</ol>
				</div>
				{view.previous || view.next ? (
					<nav
						data-testid="edition-neighbors"
						className="mt-12 grid gap-4 border-t border-border pt-8 @xl:grid-cols-2"
					>
						{view.previous ? (
							<NeighborLink link={view.previous} newTab={newTab} />
						) : (
							<span className="hidden @xl:block" />
						)}
						{view.next ? <NeighborLink link={view.next} newTab={newTab} next /> : null}
					</nav>
				) : null}
				<footer className="mt-12 flex flex-col items-center gap-4 border-t border-border pt-8">
					<a
						href="/"
						target={newTab ? "_blank" : undefined}
						className="inline-flex items-center gap-2 text-sm text-muted-fg hover:text-fg"
					>
						<BrandMarkSmall className="h-5 w-auto text-accent" />
						{view.madeWith}
					</a>
					{reportHref ? (
						<nav className="flex gap-4 text-xs text-muted-fg">
							<a href={reportHref} rel="nofollow" className="hover:text-fg hover:underline">
								{view.report}
							</a>
							<a href="/terms" className="hover:text-fg hover:underline">
								{view.terms}
							</a>
							<a href="/privacy" className="hover:text-fg hover:underline">
								{view.privacy}
							</a>
						</nav>
					) : null}
				</footer>
			</main>
		</div>
	)
}

function Item({
	item,
	index,
	anchors,
	newTab,
}: {
	item: EditionItemView
	index: number
	anchors: Record<string, string>
	newTab: boolean
}) {
	const image = item.leadImageUrl
	const title = (
		<a
			href={item.url}
			rel={OUTBOUND}
			target={newTab ? "_blank" : undefined}
			className="underline decoration-border underline-offset-4 hover:decoration-fg"
		>
			{item.title}
		</a>
	)
	// Where each item starts, at a glance: the site, small and in the accent colour, over the title.
	const kicker = item.kicker ? (
		<p className="mb-2 text-xs font-semibold tracking-[0.08em] text-accent uppercase">
			{item.kicker}
		</p>
	) : null
	const meta =
		item.meta.length > 0 ? (
			<p className="mt-2 text-sm text-muted-fg">
				{item.meta.map((part, i) => (
					<Fragment key={part}>
						{i > 0 ? <Dot /> : null}
						{part}
					</Fragment>
				))}
			</p>
		) : null

	// Each item is an article, which `CurrentMarker` finds by `data-edition-item`. The title is
	// always the largest text in it.
	if (item.layout === "brief")
		return (
			<li id={item.anchor} className="scroll-mt-6 py-8">
				<article data-edition-item className="flex items-start gap-4 @xl:gap-6">
					<div className="min-w-0 flex-1">
						{kicker}
						<h2 className="font-serif text-xl leading-snug text-balance @xl:text-[1.375rem]">
							{title}
						</h2>
						{meta}
						{item.description ? (
							<p className="mt-2.5 line-clamp-3 text-[0.9375rem] leading-relaxed text-muted-fg">
								{item.description}
							</p>
						) : null}
					</div>
					{image ? (
						<Picture src={image} className="mt-6 size-20 rounded-md @xl:h-24 @xl:w-36" />
					) : null}
				</article>
			</li>
		)

	if (item.layout === "lead")
		return (
			<li id={item.anchor} className="scroll-mt-6 pt-10 pb-14">
				<article data-edition-item>
					{image ? (
						<Picture src={image} className="mb-7 aspect-[1.91/1] rounded-xl @4xl:-mx-20" />
					) : null}
					<Commentary item={item} index={index} anchors={anchors} newTab={newTab}>
						{kicker}
						<h2 className="font-serif text-[1.75rem] leading-tight tracking-tight text-balance @xl:text-[2.25rem]">
							{title}
						</h2>
						{meta}
						{item.description ? (
							<p className="mt-4 text-lg leading-relaxed text-muted-fg">{item.description}</p>
						) : null}
					</Commentary>
				</article>
			</li>
		)

	return (
		<li id={item.anchor} className="scroll-mt-6 py-12">
			<article data-edition-item>
				<Commentary item={item} index={index} anchors={anchors} newTab={newTab}>
					{/* A phone puts the image first, full width; a wider page, beside the title. */}
					<div className="flex flex-col-reverse gap-5 @xl:flex-row @xl:items-start @xl:gap-6">
						<div className="min-w-0 flex-1">
							{kicker}
							<h2 className="font-serif text-2xl leading-tight text-balance @xl:text-[1.75rem]">
								{title}
							</h2>
							{meta}
							{item.description ? (
								<p className="mt-3 leading-relaxed text-muted-fg">{item.description}</p>
							) : null}
						</div>
						{image ? (
							<Picture
								src={image}
								className="aspect-[1.91/1] rounded-lg @xl:mt-6 @xl:aspect-[4/3] @xl:w-52"
							/>
						) : null}
					</div>
				</Commentary>
			</article>
		</li>
	)
}

/**
 * A lead image, hotlinked from its site. A broken one leaves the box empty: browsers draw
 * `::before` on an image only when it fails, so it covers the broken-image icon, without JavaScript.
 */
function Picture({ src, className }: { src: string; className: string }) {
	return (
		<div className={cn("shrink-0 overflow-hidden bg-muted", className)}>
			<img
				src={src}
				alt=""
				loading="lazy"
				decoding="async"
				referrerPolicy="no-referrer"
				className="relative size-full object-cover before:absolute before:inset-0 before:bg-muted"
			/>
		</div>
	)
}

/**
 * An item's words: the article's own (`children`), then the author's: the note, then the quotes. A
 * short first quote stands out.
 */
function Commentary({
	item,
	index,
	anchors,
	newTab,
	children,
}: {
	item: EditionItemView
	index: number
	anchors: Record<string, string>
	newTab: boolean
	/** The article's own words: its title, what it is about. */
	children: ReactNode
}) {
	return (
		// With a note and room beside the page, the note goes in the right margin, beside the rest:
		// a long one makes the item taller, never runs into the next. The last row takes what it adds,
		// so the quotes stay under the article's words.
		<div
			className={cn(
				item.note &&
					"@6xl:-mr-[15.5rem] @6xl:grid @6xl:grid-cols-[minmax(0,1fr)_13rem] @6xl:grid-rows-[auto_auto_1fr] @6xl:gap-x-10",
			)}
		>
			<div className="@6xl:col-start-1 @6xl:row-start-1">{children}</div>
			{item.note ? (
				<PostIt
					data-testid="edition-item-note"
					tilt={index + 1}
					className="mt-10 aspect-square w-fit max-w-[16rem] min-w-[min(11rem,100%)] self-start @6xl:col-start-2 @6xl:row-span-3 @6xl:row-start-1 @6xl:mt-1 @6xl:w-full @6xl:max-w-none @6xl:min-w-0"
				>
					<EditionText
						text={item.note}
						anchors={anchors}
						newTab={newTab}
						className="text-[1.0625rem] leading-relaxed @6xl:text-base"
					/>
				</PostIt>
			) : null}
			<div className="@6xl:col-start-1 @6xl:row-start-2">
				{item.highlights.map((highlight, i) => {
					const pull = i === 0 && item.pullQuote
					return (
						// oxlint-disable-next-line react/no-array-index-key -- quotes have no identity of their own
						<figure key={i} className={pull ? "mt-8" : "mt-5"}>
							{/* Clipped from the article, as the Notebook keeps quotes: the reader's paper and tape,
							    without the marker's ink, which is the author's own reading. Not a link, so it never
							    lifts. A short first quote is a larger clipping, in larger type. */}
							<div
								data-still=""
								className={cn(
									// As wide as its text: a short quote is a small piece of paper.
									"clipping w-fit max-w-full min-w-32",
									pull
										? "px-6 pt-[calc(var(--clip-top)+1rem)] pb-5"
										: "clipping-sm px-5 pt-[calc(var(--clip-top)+0.875rem)] pb-4",
								)}
							>
								<ClippingPaper id={`${item.url}#${i}`} />
								{pull ? (
									<div
										aria-hidden="true"
										className="-mb-2 h-9 font-serif text-5xl leading-none text-accent"
									>
										“
									</div>
								) : null}
								<blockquote
									className={cn(
										"font-serif whitespace-pre-wrap break-words",
										pull
											? "text-lg leading-snug text-pretty @xl:text-xl"
											: "text-[1.0625rem] leading-relaxed",
									)}
								>
									{highlight.exact}
								</blockquote>
							</div>
							{highlight.note ? (
								<figcaption>
									<EditionText
										text={highlight.note}
										anchors={anchors}
										newTab={newTab}
										className={cn(
											"mt-2 text-sm leading-relaxed text-muted-fg",
											pull ? "px-6" : "px-5",
										)}
									/>
								</figcaption>
							) : null}
						</figure>
					)
				})}
			</div>
		</div>
	)
}

/**
 * Plain text with `[text](https://…)` links. A link to another item goes to its anchor. In the
 * editor (`newTab`), the others open in a new tab.
 */
export function EditionText({
	text,
	anchors,
	newTab = false,
	className,
}: {
	text: string
	anchors: Record<string, string>
	newTab?: boolean
	className?: string
}) {
	return (
		<div className={cn("space-y-3", className)}>
			{parseEditionText(text).map((paragraph, i) => (
				// oxlint-disable-next-line react/no-array-index-key -- paragraphs have no identity of their own
				<p key={i} className="whitespace-pre-wrap break-words">
					{paragraph.map((segment, j) => {
						if (segment.kind === "text")
							// oxlint-disable-next-line react/no-array-index-key -- segments have no identity of their own
							return <Fragment key={j}>{segment.text}</Fragment>
						const anchor = anchors[segment.url]
						return (
							<a
								// oxlint-disable-next-line react/no-array-index-key -- the same link can appear twice
								key={j}
								href={anchor ? `#${anchor}` : segment.url}
								rel={anchor ? undefined : OUTBOUND}
								target={newTab && !anchor ? "_blank" : undefined}
								className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
							>
								{segment.text}
							</a>
						)
					})}
				</p>
			))}
		</div>
	)
}

function Dot() {
	return <span aria-hidden="true"> · </span>
}

/** Another edition of the author: which one it is, and its title. */
function NeighborLink({
	link,
	newTab,
	next = false,
}: {
	link: EditionLink
	newTab: boolean
	next?: boolean
}) {
	return (
		<a
			href={link.href}
			rel={next ? "next" : "prev"}
			target={newTab ? "_blank" : undefined}
			className={cn("group block rounded-lg", next && "@xl:text-right")}
		>
			<span className="text-xs font-medium tracking-wide text-accent uppercase">
				{next ? `${link.label} →` : `← ${link.label}`}
			</span>
			<span className="mt-1 block font-serif text-lg leading-snug text-balance group-hover:underline">
				{link.title}
			</span>
		</a>
	)
}
