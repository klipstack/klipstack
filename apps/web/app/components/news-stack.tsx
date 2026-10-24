import { Megaphone, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import type { SidebarNewsItem } from "~/services/news.server"
import { tooltip } from "./tooltip-host"

/** How many cards show behind the top one, as edges. */
const BEHIND = 2
/** How far each card behind shows below the one in front, in pixels. */
const PEEK = 5

/** "Today", "yesterday", "3 days ago": news is dated by day, so the day it is in UTC. */
function since(date: string, language: string) {
	const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000))
	const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" })
	return days < 14 ? format.format(-days, "day") : format.format(-Math.floor(days / 7), "week")
}

/**
 * What is new in Klipstack, at the foot of the sidebar: the newest entry on top, the next ones
 * behind it, their edges showing. Opening the top one (its page on `/news`) or its ✕ closes it for
 * good, and the next one comes forward. In the rail: an icon with a dot, which opens the sidebar.
 */
export function NewsStack({
	news,
	collapsed,
	onExpand,
	onNavigate,
}: {
	news: SidebarNewsItem[]
	collapsed: boolean
	onExpand?: () => void
	onNavigate?: () => void
}) {
	const { t, i18n } = useTranslation()
	const fetcher = useFetcher()
	// Closed here, before the layout's loader says so.
	const [closed, setClosed] = useState<string[]>([])
	const shown = news.filter((item) => !closed.includes(item.slug))
	const top = shown[0]
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

	const behind = shown.slice(1, 1 + BEHIND)
	const titleId = `news-${top.slug}`
	return (
		<section
			data-testid="news-stack"
			aria-label={t("news.label")}
			className="relative mt-4 mb-3"
			style={{ paddingBottom: behind.length * PEEK }}
		>
			{behind.map((item, i) => (
				<div
					key={item.slug}
					aria-hidden
					className="absolute inset-x-0 top-0 rounded-lg border border-border bg-card shadow-sm transition-transform duration-300"
					style={{
						bottom: behind.length * PEEK,
						zIndex: BEHIND - i,
						transform: `translateY(${(i + 1) * PEEK}px) scaleX(${1 - (i + 1) * 0.05})`,
					}}
				/>
			))}
			<article
				key={top.slug}
				aria-labelledby={titleId}
				className="relative z-10 rounded-lg border border-border bg-card p-2.5 text-sm shadow-sm transition-colors hover:bg-hover"
			>
				<div className="flex items-center gap-2">
					<p className="flex-1 truncate text-[11px] font-medium tracking-wide text-accent uppercase">
						{t("news.kicker")} · {since(top.date, i18n.language)}
					</p>
					<button
						type="button"
						onClick={() => close(top.slug)}
						aria-label={t("news.close")}
						{...tooltip(t("news.close"))}
						className="relative z-10 -my-1 -mr-1 rounded-md p-1 text-muted-fg hover:bg-hover hover:text-fg"
					>
						<X className="size-3.5" aria-hidden />
					</button>
				</div>
				<h2 id={titleId} className="mt-0.5 font-medium">
					{/* The whole card opens it: the link's area covers the card, the ✕ above it. */}
					<Link
						to={`/news/${top.slug}`}
						onClick={() => {
							close(top.slug)
							onNavigate?.()
						}}
						className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent"
					>
						{top.title}
					</Link>
				</h2>
				<p className="mt-0.5 line-clamp-3 text-xs text-muted-fg">{top.description}</p>
			</article>
		</section>
	)
}
