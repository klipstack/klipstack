import { ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { safeHost } from "~/lib/site-label"
import type { ReaderTopic, ReaderTopics } from "~/services/topics.server"

/** The article's topics above its title, as a newspaper names its sections; each opens its page. */
export function TopicKicker({ topics }: { topics: ReaderTopic[] }) {
	const { t } = useTranslation("reader")
	if (topics.length === 0) return null
	return (
		<nav
			data-testid="reader-topics"
			aria-label={t("topics.label")}
			className="mb-3 flex flex-wrap items-center gap-x-2 font-sans text-xs font-bold tracking-[0.09em] text-accent uppercase"
		>
			{topics.map((topic, i) => (
				// The dot ends the line it is on: a wrapped line starts with a name.
				<span key={topic.id} className="flex items-center gap-x-2">
					<Link to={`/topics/${topic.id}`} className="hover:underline">
						{topic.name}
					</Link>
					{i < topics.length - 1 ? <span aria-hidden>·</span> : null}
				</span>
			))}
		</nav>
	)
}

/**
 * At the end of the article, what to read next: unread articles of its strongest topic, closest
 * first, with the way to the topic's page. In a row that scrolls on a phone, three columns wider.
 * `from` is where the reader came from: the next article goes back there too. Reading progress
 * stops above it (`data-after-reading`).
 */
export function TopicShelf({ shelf, from }: { shelf: ReaderTopics["shelf"]; from: string }) {
	const { t } = useTranslation("reader")
	if (!shelf) return null
	return (
		<section data-testid="reader-shelf" data-after-reading className="mt-10 font-sans">
			<div className="mb-3 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
				<h2 className="text-base font-semibold">
					{t("topics.moreIn", { name: shelf.topic.name })}
				</h2>
				<Link
					to={`/topics/${shelf.topic.id}`}
					className="inline-flex items-center text-sm whitespace-nowrap text-accent hover:underline"
				>
					{t("topics.unread", { count: shelf.unread })}
					<ChevronRight className="size-4" aria-hidden />
				</Link>
			</div>
			<ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
				{shelf.items.map((item) => (
					<li key={item.id} className="w-[72%] flex-none snap-start sm:w-auto">
						<Link
							to={`/read/${item.id}`}
							state={{ from }}
							className="grid h-full min-h-32 content-start gap-1.5 rounded-xl bg-muted px-3.5 py-3 hover:bg-fg/10"
						>
							<span className="truncate text-xs tracking-wide text-muted-fg uppercase">
								{item.siteName ?? safeHost(item.sourceUrl)}
							</span>
							<span className="line-clamp-4 font-serif text-base leading-snug font-bold">
								{item.title ?? safeHost(item.sourceUrl)}
							</span>
							{item.readingMinutes ? (
								<span className="mt-auto text-xs text-muted-fg">
									{t("topics.minutes", { count: item.readingMinutes })}
								</span>
							) : null}
						</Link>
					</li>
				))}
			</ul>
		</section>
	)
}
