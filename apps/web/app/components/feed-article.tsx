import { BookOpen, Bookmark, Check, LoaderCircle, Paperclip, X } from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { FeedArticlePopover } from "~/components/feed-article-popover"
import { SiteStamp } from "~/components/site-stamp"
import { tooltip } from "~/components/tooltip-host"
import { relativeTime } from "~/lib/relative-time"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { WebResult } from "~/lib/web-result"
import type { FeedListItem } from "~/services/feeds.server"

/**
 * A post from a followed site. On Home, a card (`featured`). On the feed page, a row of the river
 * (`stamp`): the site's stamp beside it, its name above the title, and an excerpt only while the
 * post is new to the reader (`fresh`); the first (`lead`) larger, as a paper's top story.
 */
export function FeedArticle({
	item,
	isNew,
	source,
	stamp,
	featured = false,
	lead = false,
	fresh = false,
	onRead,
	reading,
	from = "/feed",
}: {
	item: FeedListItem
	isNew: boolean
	source?: string
	/** The river's row: the site whose stamp it carries. */
	stamp?: { title: string; siteUrl: string }
	featured?: boolean
	lead?: boolean
	fresh?: boolean
	onRead: (itemId: string) => void
	reading: boolean
	from?: "/feed" | "/home"
}) {
	const { t, i18n } = useTranslation("feed")
	const titleRef = useRef<HTMLButtonElement>(null)
	const popoverId = useId()
	const [popover, setPopover] = useState<{ point?: { x: number; y: number } } | null>(null)
	const closePopover = useCallback(() => setPopover(null), [])
	const fetcher = useFetcher<WebResult<{ saved?: string }>>()
	const opened = useFetcher<WebResult>()
	const pending = fetcher.formData?.get("intent")
	const error = fetcher.data?.ok === false ? fetcher.data.error.code : null
	useEffect(() => {
		if (error)
			showToast({ message: t(error === "limit_reached" ? "toast.saveLimit" : "toast.saveFailed") })
	}, [error, t])
	if (pending === "dismiss") return null
	const saving = pending === "save"
	const documentId = item.documentId ?? (fetcher.data?.ok ? fetcher.data.saved : null) ?? null
	const submit = (intent: string) =>
		fetcher.submit({ intent, itemId: item.id }, { method: "post", action: "/feed" })
	const title = item.title ?? t("item.untitled")
	const Heading = featured || stamp ? "h3" : "h4"
	const dismiss = () => {
		closePopover()
		void submit("dismiss")
		showToast({
			message: t("toast.dismissed"),
			undo: {
				action: "/feed",
				intent: "restore",
				label: t("toast.undo"),
				fields: { itemId: item.id },
			},
		})
	}
	const showNew = isNew && !documentId && opened.state === "idle" && !opened.data?.ok
	const meta = (
		<>
			{showNew ? (
				<span data-testid="feed-new-dot" className="inline-flex items-center gap-1.5 text-link">
					<span className="size-1.5 rounded-full bg-accent" aria-hidden />
					{t("item.new")}
				</span>
			) : null}
			{item.publishedAt ? (
				<time dateTime={new Date(item.publishedAt).toISOString()} suppressHydrationWarning>
					{relativeTime(item.publishedAt, i18n.language)}
				</time>
			) : null}
		</>
	)
	const titleButton = (
		<button
			ref={titleRef}
			type="button"
			aria-haspopup="dialog"
			aria-expanded={popover !== null}
			aria-controls={popover ? popoverId : undefined}
			onClick={() => setPopover((current) => (current ? null : {}))}
			className="text-left hover:text-link focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
		>
			{title}
		</button>
	)
	const actions = (
		<div
			data-testid="feed-actions"
			className={cn(
				"flex items-center gap-1 text-muted-fg opacity-100 transition-opacity md:opacity-0 md:group-hover/feed:opacity-100 md:group-focus-within/feed:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100",
				(saving || reading) && "md:opacity-100",
			)}
		>
			{!documentId ? (
				<button
					type="button"
					aria-label={saving ? t("item.saving") : t("item.save")}
					{...tooltip(t("item.save"))}
					disabled={saving || reading}
					onClick={() => void submit("save")}
					className={iconButton}
				>
					{saving ? (
						<LoaderCircle className="size-4 animate-spin" aria-hidden />
					) : (
						<Bookmark className="size-4" aria-hidden />
					)}
				</button>
			) : null}
			{documentId ? (
				<Link
					to={`/read/${documentId}`}
					state={{ from }}
					aria-label={t("item.read")}
					{...tooltip(t("item.read"))}
					className={iconButton}
				>
					<BookOpen className="size-4" aria-hidden />
				</Link>
			) : (
				<button
					type="button"
					aria-label={reading ? t("item.opening") : t("item.saveRead")}
					{...tooltip(t("item.saveRead"))}
					disabled={saving || reading}
					onClick={() => onRead(item.id)}
					className={iconButton}
				>
					{reading ? (
						<LoaderCircle className="size-4 animate-spin" aria-hidden />
					) : (
						<BookOpen className="size-4" aria-hidden />
					)}
				</button>
			)}
			<button
				type="button"
				aria-label={t("item.dismiss")}
				{...tooltip(t("item.dismiss"))}
				disabled={saving || reading}
				className={iconButton}
				onClick={dismiss}
			>
				<X className="size-4" aria-hidden />
			</button>
		</div>
	)
	const popoverElement = popover ? (
		<FeedArticlePopover
			id={popoverId}
			title={title}
			url={item.url}
			documentId={documentId}
			from={from}
			anchor={titleRef}
			point={popover.point}
			busy={saving || reading}
			onClose={closePopover}
			onOpenOriginal={() => {
				closePopover()
				void opened.submit(
					{ intent: "opened", itemId: item.id },
					{ method: "post", action: "/feed" },
				)
			}}
			onSave={() => {
				closePopover()
				void submit("save")
			}}
			onRead={() => {
				closePopover()
				onRead(item.id)
			}}
			onDismiss={dismiss}
		/>
	) : null
	const onContextMenu = (event: React.MouseEvent) => {
		event.preventDefault()
		setPopover(
			event.clientX || event.clientY ? { point: { x: event.clientX, y: event.clientY } } : {},
		)
	}

	if (stamp)
		return (
			<li
				data-testid="feed-item"
				data-item-id={item.id}
				data-fresh={fresh || undefined}
				onContextMenu={onContextMenu}
				className="group/feed flex min-w-0 flex-wrap gap-x-4 border-b border-border py-4 last:border-b-0 sm:flex-nowrap"
			>
				<SiteStamp
					siteUrl={stamp.siteUrl}
					title={stamp.title}
					size={lead ? 32 : 26}
					className="mt-1"
				/>
				<div className="min-w-0 flex-1 basis-0">
					<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-fg">
						<span className="max-w-full truncate font-medium text-fg">{stamp.title}</span>
						{meta}
						{documentId ? (
							<span data-testid="feed-clipped" className="inline-flex items-center gap-1">
								<Paperclip className="size-3.5 -rotate-45" aria-hidden />
								{t("item.clipped")}
							</span>
						) : null}
					</p>
					<Heading
						className={cn(
							"mt-1 break-words text-balance",
							lead
								? "font-display text-2xl leading-tight font-medium sm:text-3xl"
								: fresh
									? "font-serif text-xl leading-snug"
									: "font-serif text-lg leading-snug text-fg/85",
						)}
					>
						{titleButton}
					</Heading>
					{item.excerpt && fresh ? (
						<p
							className={cn(
								"mt-1.5 max-w-prose text-sm leading-relaxed text-pretty text-muted-fg",
								lead ? "line-clamp-3" : "line-clamp-2",
							)}
						>
							{item.excerpt}
						</p>
					) : null}
				</div>
				{/* Under the post on a phone, where the title needs the width; beside it otherwise. */}
				<div className="flex w-full justify-end sm:w-auto sm:shrink-0 sm:self-start sm:pt-4">
					{actions}
				</div>
				{popoverElement}
			</li>
		)

	return (
		<li
			data-testid="feed-item"
			data-item-id={item.id}
			onContextMenu={onContextMenu}
			className={cn(
				"group/feed flex min-w-0 flex-col",
				featured ? "rounded-xl border border-border bg-card p-5 sm:p-6" : "py-4",
			)}
		>
			{source ? <p className="mb-3 truncate text-xs font-medium text-muted-fg">{source}</p> : null}
			<div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-fg">
				{meta}
			</div>
			<Heading
				className={cn(
					"font-serif leading-tight break-words",
					featured ? "text-2xl" : lead ? "text-2xl" : "text-lg",
				)}
			>
				{titleButton}
			</Heading>
			{item.excerpt && (featured || lead) ? (
				<p
					className={cn(
						"mt-3 text-sm leading-relaxed text-muted-fg",
						featured ? "line-clamp-4" : "line-clamp-2",
					)}
				>
					{item.excerpt}
				</p>
			) : null}
			{item.author && featured ? <p className="mt-3 text-xs text-muted-fg">{item.author}</p> : null}
			<div className="mt-auto flex min-h-11 items-center justify-end gap-3 pt-3">
				{documentId ? (
					<span className="mr-auto inline-flex items-center gap-1.5 text-xs text-muted-fg">
						<Check className="size-3.5" aria-hidden />
						{t("item.saved")}
					</span>
				) : null}
				{actions}
			</div>
			{popoverElement}
		</li>
	)
}

const iconButton =
	"inline-flex size-11 items-center justify-center rounded-md hover:bg-hover hover:text-fg disabled:opacity-50 md:size-8 [@media(pointer:coarse)]:size-11"
