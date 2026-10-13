import type { UserPrefs } from "@klipstack/db"
import { ExternalLink, LoaderCircle } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { clearHighlights, flashCited, renderHighlights } from "~/lib/highlights.client"
import { cn } from "~/lib/utils"
import type { WebResult } from "~/lib/web-result"
import type { ItemArticle } from "~/services/editions.server"
import { plainAnswer } from "./ai-answer"
import { HighlightInk } from "./highlight-ink"

/** The article being read beside the editor, and the highlight to show in it, if any. */
export interface Reading {
	itemId: string
	highlightId: string | null
	/** Asking for the same highlight again scrolls to it again. */
	asked: number
}

type Answer = WebResult<{ article: ItemArticle }>

/**
 * An item's article, fetched once per item. `undefined` while it loads, `null` when it could not
 * be fetched at all.
 */
function useItemArticle(editionId: string, itemId: string): Answer | null | undefined {
	const [state, setState] = useState<{ itemId: string; answer: Answer | null } | null>(null)
	useEffect(() => {
		const controller = new AbortController()
		fetch(`/editions/${editionId}/items/${itemId}/article`, { signal: controller.signal })
			.then(async (res) => setState({ itemId, answer: (await res.json()) as Answer }))
			.catch(() => {
				if (!controller.signal.aborted) setState({ itemId, answer: null })
			})
		return () => controller.abort()
	}, [editionId, itemId])
	return state?.itemId === itemId ? state.answer : undefined
}

/**
 * The library's copy of an item's article, read only, with the user's highlights marked: to recall
 * what the article said without leaving the editor. Links open in a new tab.
 */
export function EditionArticle({
	editionId,
	reading,
	fallbackUrl,
	font,
	scrollRef,
}: {
	editionId: string
	reading: Reading
	/** The item's address, for when the library has no article to show. */
	fallbackUrl: string
	font: NonNullable<UserPrefs["font"]>
	scrollRef: React.RefObject<HTMLDivElement | null>
}) {
	const { t } = useTranslation("editions")
	const answer = useItemArticle(editionId, reading.itemId)
	const article = answer?.ok ? answer.article : null
	const content = useRef<HTMLDivElement>(null)
	const frame = useRef<HTMLElement>(null)
	const ranges = useRef(new Map<string, Range>())
	// Asked for a highlight the article no longer has where it was: deleted, or lost in an update.
	const [missing, setMissing] = useState(false)

	// The text is the article's own HTML, sanitized when it was stored, as the reader shows it.
	useLayoutEffect(() => {
		const root = content.current
		if (!root || !article?.html) return
		for (const link of root.querySelectorAll("a[href]")) {
			link.setAttribute("target", "_blank")
			link.setAttribute("rel", "noopener noreferrer")
		}
		ranges.current = renderHighlights(root, article.highlights, article.versionId)
		return () => {
			ranges.current = new Map()
			clearHighlights()
		}
	}, [article])

	// To the highlight asked for, else the top.
	useLayoutEffect(() => {
		const scroller = scrollRef.current
		if (!scroller || !article) return
		const range = reading.highlightId ? ranges.current.get(reading.highlightId) : undefined
		setMissing(reading.highlightId !== null && !range)
		if (!range) {
			scroller.scrollTo({ top: 0 })
			return
		}
		const top =
			range.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
		scroller.scrollTo({ top: Math.max(0, top - scroller.clientHeight / 3) })
		flashCited(range)
	}, [article, reading.highlightId, reading.asked, scrollRef])

	if (answer === undefined)
		return (
			<p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-fg">
				<LoaderCircle className="size-4 animate-spin" aria-hidden />
				{t("article.loading")}
			</p>
		)
	if (!article) {
		const gone = answer?.ok === false && answer.error.code === "document_gone"
		return (
			<div role="status" className="space-y-3 p-6 text-sm text-muted-fg">
				<p>{gone ? t("article.gone") : t("article.failed")}</p>
				<OriginalLink url={fallbackUrl} />
			</div>
		)
	}
	return (
		<article
			ref={frame}
			data-testid="edition-article"
			className={cn(
				"reader reader-size-sm relative mx-auto px-6 pt-6 pb-24",
				`reader-font-${font}`,
				"max-w-[var(--reader-measure)]",
			)}
		>
			<header className="mb-6 font-sans">
				{article.siteName ? <p className="text-sm text-muted-fg">{article.siteName}</p> : null}
				<h2 className="mt-1 text-2xl leading-tight font-semibold">{article.title}</h2>
				<p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-fg">
					{article.author ? <span>{article.author}</span> : null}
					{article.readingMinutes ? (
						<span>{t("public.minutes", { count: article.readingMinutes })}</span>
					) : null}
					<OriginalLink url={article.url} />
				</p>
			</header>
			{article.brief ? (
				<section
					aria-label={t("article.brief")}
					className="mb-6 rounded-xl border border-border bg-card p-3 font-sans text-sm leading-snug"
				>
					<p className="text-xs font-medium text-accent">{t("article.brief")}</p>
					<ul className="mt-1.5 list-disc space-y-1 pl-5">
						{article.brief
							.split("\n")
							.map((line) => plainAnswer(line.replace(/^\s*[-*]\s+/, "")))
							.filter((line) => line.trim())
							.map((line) => (
								<li key={line}>{line}</li>
							))}
					</ul>
				</section>
			) : null}
			{missing ? (
				<p role="status" className="mb-4 font-sans text-sm text-muted-fg">
					{t("article.highlightMissing")}
				</p>
			) : null}
			{article.html ? (
				<>
					<div
						ref={content}
						className="reader-content prose max-w-none"
						// oxlint-disable-next-line react/no-danger -- sanitized at extraction, as the reader's is
						dangerouslySetInnerHTML={{ __html: article.html }}
					/>
					<HighlightInk rootRef={content} containerRef={frame} />
				</>
			) : (
				<p className="font-sans text-sm text-muted-fg">{t("article.noText")}</p>
			)}
		</article>
	)
}

function OriginalLink({ url }: { url: string }) {
	const { t } = useTranslation("editions")
	return (
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1 text-link hover:underline"
		>
			<ExternalLink className="size-3.5" aria-hidden />
			{t("article.original")}
		</a>
	)
}
