import { Megaphone, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { cn } from "~/lib/utils"
import type { SidebarNewsItem } from "~/services/news.server"
import { tooltip } from "./tooltip-host"

/** How many cards show behind the top one, as edges above it. */
const BEHIND = 2

/** "Today", "yesterday", "3 days ago": news is dated by day, so the day it is in UTC. */
function since(date: string, language: string) {
	const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000))
	const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" })
	return days < 14 ? format.format(-days, "day") : format.format(-Math.floor(days / 7), "week")
}

/**
 * What is new in Klipstack, at the foot of the sidebar: the newest entry on top, the next ones
 * behind it, their edges showing above it. Opening a card (its page on `/news`, in a new tab) or
 * its ✕ closes it for good, and the next one comes forward. Pointing at the edges (or tabbing to
 * them, or tapping them) opens them upward into a row per card, its title, each a link to its
 * page like the top card, and a link to all of them. In the rail: an icon with a dot, which opens
 * the sidebar.
 */
export function NewsStack({
	news,
	collapsed,
	onExpand,
}: {
	news: SidebarNewsItem[]
	collapsed: boolean
	onExpand?: () => void
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher()
	// Closed here, before the layout's loader says so.
	const [closed, setClosed] = useState<string[]>([])
	// Open while the pointer is on the edges, or after the keyboard or a tap went there.
	const [hover, setHover] = useState(false)
	const [pinned, setPinned] = useState(false)
	const edges = useRef<HTMLUListElement>(null)
	const shown = news.filter((item) => !closed.includes(item.slug))
	const top = shown[0]
	const behind = shown.slice(1)
	const open = (hover || pinned) && behind.length > 0
	const focusTop = () =>
		edges.current?.parentElement?.querySelector<HTMLElement>("article a")?.focus()
	useEffect(() => {
		if (!open) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			setHover(false)
			setPinned(false)
			// A shut row is invisible: the focus goes on to the top card.
			if (edges.current?.contains(document.activeElement)) focusTop()
		}
		// A tap elsewhere closes what a tap opened.
		const onDown = (event: PointerEvent) => {
			if (!edges.current?.contains(event.target as Node)) setPinned(false)
		}
		document.addEventListener("keydown", onKey)
		document.addEventListener("pointerdown", onDown)
		return () => {
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("pointerdown", onDown)
		}
	}, [open])
	if (!top) return null
	const close = (slug: string) => {
		setClosed((list) => [...list, slug])
		void fetcher.submit(null, { method: "post", action: `/news/${slug}/close` })
	}

	if (collapsed) {
		const label = t("news.rail", { title: top.title })
		return (
			<button
				type="button"
				onClick={onExpand}
				data-testid="news-stack"
				aria-label={label}
				{...tooltip(label, undefined, "right")}
				className="relative mx-auto my-3 flex size-9 items-center justify-center rounded-lg text-muted-fg hover:bg-hover hover:text-fg"
			>
				<Megaphone className="size-4" aria-hidden />
				<span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-accent" />
			</button>
		)
	}

	return (
		<section
			data-testid="news-stack"
			aria-label={t("news.label")}
			// The edges' room above the top card; open, the rows rise over what is above, and
			// nothing else moves.
			className="relative mt-4 mb-3"
			style={{ paddingTop: Math.min(behind.length, BEHIND) * 5 }}
		>
			<div className="relative">
				{behind.length > 0 ? (
					<ul
						ref={edges}
						data-open={open || undefined}
						onPointerEnter={(event) => event.pointerType === "mouse" && setHover(true)}
						onPointerLeave={(event) => event.pointerType === "mouse" && setHover(false)}
						onFocus={(event) => event.target.matches(":focus-visible") && setPinned(true)}
						onBlur={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget)) setPinned(false)
						}}
						// A tap on the shut edges, or just above them, opens the rows; the next tap, a row.
						onClickCapture={(event) => {
							if (open) return
							event.preventDefault()
							event.stopPropagation()
							setPinned(true)
						}}
						// Newest nearest the card; room above the edges to point at or tap them. Its
						// own layer, under the top card however many rows there are.
						className="group/edges absolute inset-x-0 bottom-full z-0 flex flex-col-reverse pt-3"
					>
						{behind.map((item, i) => (
							<li
								key={item.slug}
								style={{ zIndex: behind.length - i, "--n": i + 1 } as React.CSSProperties}
								className={cn(
									"relative overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-[height,margin,scale,opacity,background-color] duration-200 ease-out motion-reduce:transition-none",
									// Shut: an edge 5px tall, narrower the further back; past BEHIND, none.
									i < BEHIND
										? "-mb-[7px] h-3 scale-x-[calc(1-var(--n)*0.05)]"
										: "-mb-px h-0 scale-x-90 opacity-0",
									"group-data-open/edges:mb-1 group-data-open/edges:h-8 group-data-open/edges:scale-x-100 group-data-open/edges:opacity-100",
								)}
							>
								<a
									href={`/news/${item.slug}`}
									target="_blank"
									rel="noopener"
									{...tooltip(item.title)}
									onClick={(event) => {
										close(item.slug)
										// Its row is gone: the focus goes on to the top card, and with no
										// row left, the stack is shut.
										if (document.activeElement === event.currentTarget) focusTop()
										if (behind.length === 1) {
											setHover(false)
											setPinned(false)
										}
									}}
									className="flex h-8 items-center px-2.5 text-sm opacity-0 transition-opacity duration-200 group-data-open/edges:opacity-100 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
								>
									<span className="truncate font-medium">{item.title}</span>
								</a>
							</li>
						))}
						{/* Open, above the rows: every entry, on its page. */}
						<li className="h-0 overflow-hidden opacity-0 transition-[height,opacity] duration-200 ease-out group-data-open/edges:h-7 group-data-open/edges:opacity-100 motion-reduce:transition-none">
							<Link
								to="/news"
								target="_blank"
								rel="noopener"
								className="flex h-6 items-center rounded-md px-2.5 text-xs whitespace-nowrap text-muted-fg hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:outline-none"
							>
								{t("news.all")}
							</Link>
						</li>
					</ul>
				) : null}
				<div className="relative z-10">
					<NewsCard item={top} onClose={close} />
				</div>
			</div>
		</section>
	)
}

/** One card: when, the title (a link to its page, in a new tab), its line, and ✕. */
function NewsCard({ item, onClose }: { item: SidebarNewsItem; onClose: (slug: string) => void }) {
	const { t, i18n } = useTranslation()
	const titleId = `news-${item.slug}`
	return (
		<article
			aria-labelledby={titleId}
			className="relative rounded-lg border border-border bg-card p-2.5 text-sm shadow-sm transition-colors hover:bg-hover"
		>
			<div className="flex items-center gap-2">
				<p className="flex-1 truncate text-[11px] font-medium tracking-wide text-accent uppercase">
					{t("news.kicker")} · {since(item.date, i18n.language)}
				</p>
				<button
					type="button"
					onClick={() => onClose(item.slug)}
					aria-label={t("news.close")}
					{...tooltip(t("news.close"))}
					className="relative z-10 -my-1 -mr-1 rounded-md p-1 text-muted-fg hover:bg-hover hover:text-fg"
				>
					<X className="size-3.5" aria-hidden />
				</button>
			</div>
			<h2 id={titleId} className="mt-0.5 font-medium">
				{/* The whole card opens it, in a new tab so the app stays where it was: the link's
				    area covers the card, the ✕ above it. */}
				<a
					href={`/news/${item.slug}`}
					target="_blank"
					rel="noopener"
					onClick={() => onClose(item.slug)}
					className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent"
				>
					{item.title}
				</a>
			</h2>
			<p className="mt-0.5 line-clamp-4 text-xs text-muted-fg">{item.description}</p>
		</article>
	)
}
