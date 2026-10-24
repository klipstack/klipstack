import { Megaphone, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { cn } from "~/lib/utils"
import type { SidebarNewsItem } from "~/services/news.server"
import { tooltip } from "./tooltip-host"

/** How many cards show behind the top one, as edges. */
const BEHIND = 2

/** "Today", "yesterday", "3 days ago": news is dated by day, so the day it is in UTC. */
function since(date: string, language: string) {
	const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000))
	const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" })
	return days < 14 ? format.format(-days, "day") : format.format(-Math.floor(days / 7), "week")
}

/**
 * What is new in Klipstack, at the foot of the sidebar: the newest entry on top, the next ones
 * behind it, their edges showing. Opening a card (its page on `/news`, in a new tab) or its ✕
 * closes it for good, and the next one comes forward. The edges are a button: it opens the stack
 * into a list of every card, upward, until Escape or Show less. In the rail: an icon with a dot,
 * which opens the sidebar.
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
	const [open, setOpen] = useState(false)
	const toggle = useRef<HTMLButtonElement>(null)
	const list = useRef<HTMLUListElement>(null)
	const less = useRef<HTMLButtonElement>(null)
	// Opened or closed from the keyboard or a click: the button that had the focus is gone.
	const moved = useRef(false)
	const shown = news.filter((item) => !closed.includes(item.slug))
	const top = shown[0]
	// Down to one card, there is nothing left to open.
	const expanded = open && shown.length > 1
	useEffect(() => {
		// Opened in a short window, the list is taller than the sidebar's room: it scrolls so that
		// Show less is where the stack's button was, under the pointer.
		if (expanded) less.current?.scrollIntoView({ block: "nearest" })
		if (moved.current) {
			moved.current = false
			if (expanded) list.current?.querySelector("a")?.focus({ preventScroll: true })
			else toggle.current?.focus()
		}
		if (!expanded) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			moved.current = true
			setOpen(false)
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [expanded])
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

	if (expanded)
		return (
			<section data-testid="news-stack" aria-label={t("news.label")} className="mt-4 mb-3">
				<ul ref={list} className="flex flex-col gap-2">
					{shown.map((item) => (
						<li key={item.slug}>
							<NewsCard item={item} onClose={close} />
						</li>
					))}
				</ul>
				<div className="mt-1.5 flex items-center justify-between text-xs">
					<button
						ref={less}
						type="button"
						aria-expanded
						onClick={() => {
							moved.current = true
							setOpen(false)
						}}
						className="rounded-md px-1.5 py-1 whitespace-nowrap text-muted-fg hover:bg-hover hover:text-fg"
					>
						{t("news.less")}
					</button>
					<Link
						to="/news"
						target="_blank"
						rel="noopener"
						className="rounded-md px-1.5 py-1 whitespace-nowrap text-muted-fg hover:bg-hover hover:text-fg"
					>
						{t("news.all")}
					</Link>
				</div>
			</section>
		)

	const behind = shown.slice(1, 1 + BEHIND)
	const more = shown.length - 1
	return (
		<section
			data-testid="news-stack"
			aria-label={t("news.label")}
			// The edges spread apart on hover, inside the margin below: nothing else moves.
			className="group/news relative mt-4 mb-3"
			style={{ paddingBottom: behind.length * 5 }}
		>
			{behind.map((item, i) => (
				<div
					key={item.slug}
					aria-hidden
					// As tall as the top card: the stack's height, less the edges' room below it.
					style={
						{ bottom: behind.length * 5, zIndex: BEHIND - i, "--n": i + 1 } as React.CSSProperties
					}
					className={cn(
						"absolute inset-x-0 top-0 rounded-lg border border-border bg-card shadow-sm transition-[translate,scale] duration-200 motion-reduce:transition-none",
						"translate-y-[calc(var(--n)*5px)] scale-x-[calc(1-var(--n)*0.05)] group-hover/news:translate-y-[calc(var(--n)*9px)]",
					)}
				/>
			))}
			<div className="relative z-10">
				<NewsCard item={top} onClose={close} />
			</div>
			{more > 0 ? (
				// The edges and the count are one button: the whole of what is behind opens.
				<button
					ref={toggle}
					type="button"
					aria-expanded={false}
					aria-label={t("news.showAll", { count: shown.length })}
					{...tooltip(t("news.showAll", { count: shown.length }))}
					onClick={() => {
						moved.current = true
						setOpen(true)
					}}
					className="group/more absolute inset-x-0 -bottom-2 z-20 flex h-4 justify-end px-2 focus-visible:outline-none"
				>
					<span className="rounded-full border border-border bg-card px-1.5 text-[10px] leading-4 font-medium text-muted-fg shadow-sm outline-accent group-hover/news:text-fg group-focus-visible/more:outline-2">
						{t("news.more", { count: more })}
					</span>
				</button>
			) : null}
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
