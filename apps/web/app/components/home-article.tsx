import { ArrowRight, Star } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { sourceLabel } from "~/lib/site-label"
import { cn } from "~/lib/utils"
import type { LibraryCard } from "~/services/documents.server"
import { ArticleImage } from "./article-image"

/** A reading invitation. The reader keeps the article's full set of editing actions. */
export function HomeArticle({
	doc,
	featured = false,
	compact = false,
	topic,
}: {
	/** `minutesLeft` from the server, when it counted them: what Home's time choice goes by. */
	doc: LibraryCard & { minutesLeft?: number | null }
	featured?: boolean
	compact?: boolean
	/** The topic it is in, beside its source: what the library is made of, card by card. */
	topic?: string
}) {
	const { t } = useTranslation("library")
	const image = doc.leadImageAssetId ? `/assets/${doc.leadImageAssetId}` : doc.leadImageUrl
	const started = Boolean(doc.firstOpenedAt)
	const progress = Math.round(doc.readingProgress * 100)
	const remaining =
		doc.minutesLeft ??
		(doc.readingMinutes
			? Math.max(1, Math.ceil(doc.readingMinutes * (1 - doc.readingProgress)))
			: null)
	return (
		<Link
			to={`/read/${doc.id}`}
			state={{ from: "/home" }}
			data-testid="home-article"
			data-document-id={doc.id}
			className={cn(
				"group block min-w-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
				!compact && "rounded-xl",
				featured &&
					"overflow-hidden border border-border bg-card sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]",
				compact && "pt-4",
			)}
		>
			{/* Compact cards never show images. The others always have the box, placeholder or not, so
			    the titles in a row line up. */}
			{compact ? null : (
				<ArticleImage
					src={image}
					eager={featured}
					className={
						featured
							? "aspect-[16/9] sm:order-2 sm:aspect-auto sm:min-h-72"
							: "mb-4 aspect-[16/10] rounded-lg"
					}
				/>
			)}
			<div className={cn("flex min-w-0 flex-col", featured && "justify-center p-6 sm:p-8")}>
				<p className="flex items-center gap-2 text-xs text-muted-fg">
					<span className="truncate">{sourceLabel(doc)}</span>
					{/* Its own span: a long source is cut, the topic stays. */}
					{topic ? (
						<span data-testid="home-article-topic" className="max-w-1/2 shrink-0 truncate">
							· {topic}
						</span>
					) : null}
					{doc.starredAt ? (
						<Star
							className="size-3.5 shrink-0 fill-favorite text-favorite"
							role="img"
							aria-label={t("home.starred")}
						/>
					) : null}
				</p>
				<h3
					className={cn(
						"mt-2 text-balance group-hover:text-link",
						featured
							? "font-serif text-3xl leading-tight sm:text-4xl"
							: compact
								? "text-base font-medium leading-snug"
								: "font-serif text-2xl leading-tight",
					)}
				>
					{doc.title ?? t("card.untitled")}
				</h3>
				{featured && doc.description ? (
					<p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted-fg">
						{doc.description}
					</p>
				) : null}
				{started ? (
					<div className={cn("mt-4", featured && "max-w-sm")}>
						<div
							role="progressbar"
							aria-label={t("home.progress")}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={progress}
							className="h-1 overflow-hidden rounded-full bg-fg/10"
						>
							<div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
						</div>
						<p className="mt-2 text-xs text-muted-fg">
							{t("home.percent", { percent: progress })}
							{remaining ? ` · ${t("continueReading.left", { count: remaining })}` : ""}
						</p>
					</div>
				) : doc.readingMinutes ? (
					<p className="mt-3 text-xs text-muted-fg">
						{t("card.minutes", { count: doc.readingMinutes })}
					</p>
				) : null}
				{featured ? (
					<span className="mt-5 flex items-center gap-2 text-sm font-medium text-link">
						{t(started ? "home.resume" : "home.start")}
						<ArrowRight className="size-4" aria-hidden />
					</span>
				) : null}
			</div>
		</Link>
	)
}
