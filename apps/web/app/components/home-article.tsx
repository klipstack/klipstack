import { ArrowRight, Star } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { safeHost, siteLabel, sourceLabel } from "~/lib/site-label"
import { cn } from "~/lib/utils"
import type { LibraryCard } from "~/services/documents.server"
import { ArticleImage } from "./article-image"

/**
 * A reading invitation, set as a newspaper sets its stories: the lead (the big picture, headline
 * and deck), a story in the side column (headline only), or a story in the columns below (picture,
 * headline and a line of deck; on phones, a row with a small picture). The reader keeps the
 * article's full set of editing actions.
 */
export function HomeArticle({
	doc,
	variant = "column",
	topic,
}: {
	/** `minutesLeft` from the server, when it counted them: what Home's time choice goes by. */
	doc: LibraryCard & { minutesLeft?: number | null }
	variant?: "lead" | "side" | "column"
	/** The topic it is in, beside its source: what the library is made of, card by card. */
	topic?: string
}) {
	const { t } = useTranslation("library")
	const image = doc.leadImageAssetId ? `/assets/${doc.leadImageAssetId}` : doc.leadImageUrl
	const host = safeHost(doc.sourceUrl)
	const cover = {
		site: siteLabel(doc.siteName, host),
		title: doc.title ?? t("card.untitled"),
		shelf: doc.siteName ?? host,
	}
	const started = Boolean(doc.firstOpenedAt)
	const progress = Math.round(doc.readingProgress * 100)
	const remaining =
		doc.minutesLeft ??
		(doc.readingMinutes
			? Math.max(1, Math.ceil(doc.readingMinutes * (1 - doc.readingProgress)))
			: null)
	const lead = variant === "lead"
	const column = variant === "column"
	return (
		<Link
			to={`/read/${doc.id}`}
			state={{ from: "/home" }}
			data-testid="home-article"
			data-document-id={doc.id}
			className={cn(
				"group block min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
				// On phones a column story is a row, its picture small at the end.
				column &&
					"max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_6rem] max-sm:items-start max-sm:gap-4",
			)}
		>
			{/* Side stories have no picture. The others always have the box, placeholder or not, so
			    the headlines in a row line up. */}
			{variant === "side" ? null : (
				<ArticleImage
					src={image}
					cover={cover}
					eager={lead}
					className={
						lead
							? "mb-5 aspect-[2/1] rounded-lg"
							: "mb-4 aspect-[16/10] rounded-md max-sm:order-2 max-sm:mb-0 max-sm:aspect-square"
					}
				/>
			)}
			<div className="flex min-w-0 flex-col">
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
						"mt-1.5 font-display text-balance group-hover:text-link",
						lead
							? "text-4xl leading-[1.08] font-[520] tracking-[-0.015em] md:text-[2.75rem]"
							: column
								? "text-xl leading-tight font-medium md:text-[1.375rem]"
								: "text-xl leading-snug font-medium",
					)}
				>
					{doc.title ?? t("card.untitled")}
				</h3>
				{/* The deck: a lead's few lines, a column's one or two. Side stories go without. */}
				{variant !== "side" && doc.description ? (
					<p
						className={cn(
							"font-display text-pretty text-muted-fg",
							lead
								? "mt-3 line-clamp-3 text-xl leading-snug"
								: "mt-2 line-clamp-2 text-base leading-snug max-sm:hidden",
						)}
					>
						{doc.description}
					</p>
				) : null}
				{started ? (
					<div className={cn("mt-3", lead && "mt-5 max-w-sm")}>
						<div
							role="progressbar"
							aria-label={t("home.progress")}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={progress}
							className="h-1 overflow-hidden rounded-full bg-fg/10"
						>
							<div className="ink-line h-full rounded-full" style={{ width: `${progress}%` }} />
						</div>
						<p className="mt-2 text-xs text-muted-fg">
							{t("home.percent", { percent: progress })}
							{remaining ? ` · ${t("continueReading.left", { count: remaining })}` : ""}
						</p>
					</div>
				) : doc.readingMinutes ? (
					<p className="mt-2 text-xs text-muted-fg">
						{t("card.minutes", { count: doc.readingMinutes })}
					</p>
				) : null}
				{lead ? (
					<span className="mt-5 flex items-center gap-2 text-sm font-medium text-link">
						{t(started ? "home.resume" : "home.start")}
						<ArrowRight className="size-4" aria-hidden />
					</span>
				) : null}
			</div>
		</Link>
	)
}
