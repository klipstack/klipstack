import { AlertTriangle, ChevronDown, ExternalLink, Pencil, UserMinus, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useFetchers } from "react-router"
import {
	dismissFeedItem,
	followFeed,
	importFeeds,
	markFeedItemRead,
	renameFeed,
	restoreFeedItem,
	unfollowFeed,
} from "~/commands/feeds.server"
import { saveFeedItem } from "~/commands/saving.server"
import { AddFeedDialog } from "~/components/add-feed-dialog"
import { EmptyDrawing } from "~/components/empty-drawing"
import { FeedArticle } from "~/components/feed-article"
import { FeedMenu, ImportOpmlButton } from "~/components/feed-opml"
import { MenuButton, MenuLink, MoreMenu, type MoreMenuHandle } from "~/components/more-menu"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { useFeedReader } from "~/hooks/use-feed-reader"
import { AppError } from "~/lib/app-error"
import { latestFeedItems } from "~/lib/feed-layout"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { relativeTime } from "~/lib/relative-time"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import { answer } from "~/lib/web-action.server"
import { type FeedSection, type FeedSubscription, listFeedPage } from "~/services/feeds.server"
import type { Route } from "./+types/feed"

/** Items a section shows before "Show more". */
const SECTION_PREVIEW = 3

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.feed") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.feed" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	const { sections, quiet } = await listFeedPage(user.id)
	return { sections, quiet }
}

/**
 * POST /feed (form: `intent`, and `url`, `file`, `itemId`, `subscriptionId` or `title`). The feed
 * page's changes, through the same commands as the API and MCP.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const form = await readForm(request)
	const intent = form.get("intent")
	const field = (name: string) => String(form.get(name) ?? "").trim()
	return answer(async () => {
		switch (intent) {
			case "subscribe":
				return { subscribed: await followFeed(user.id, field("url")) }
			case "import": {
				const file = form.get("file")
				return {
					imported: await importFeeds(user.id, file instanceof File ? await file.text() : ""),
				}
			}
			case "save":
			case "save-read": {
				const { articleId } = await saveFeedItem(user.id, field("itemId"))
				return intent === "save-read" ? { read: articleId } : { saved: articleId }
			}
			case "dismiss":
				await dismissFeedItem(user.id, field("itemId"))
				return {}
			case "restore":
				await restoreFeedItem(user.id, field("itemId"))
				return {}
			case "rename":
				await renameFeed(user.id, field("subscriptionId"), field("title"))
				return {}
			case "unsubscribe":
				await unfollowFeed(user.id, field("subscriptionId"))
				return {}
			case "opened":
				await markFeedItemRead(user.id, field("itemId"))
				return {}
			default:
				throw new AppError("invalid_request", "Unknown intent.")
		}
	})
}

export default function FeedPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("feed")
	const { sections, quiet } = loaderData
	const empty = sections.length === 0 && quiet.length === 0
	const [following, setFollowing] = useState(false)
	const menuRef = useRef<MoreMenuHandle>(null)
	// Keep these positions stable through Save and live updates; a new visit chooses fresh posts.
	const [featuredIds, setFeaturedIds] = useState(() =>
		latestFeedItems(sections).map(({ item }) => item.id),
	)
	// An imported or initially empty feed can receive its first posts without a new visit.
	if (featuredIds.length === 0) {
		const available = latestFeedItems(sections)
		if (available.length) setFeaturedIds(available.map(({ item }) => item.id))
	}
	const featured = sections
		.flatMap((source) =>
			source.items
				.filter((item) => featuredIds.includes(item.id))
				.map((item) => ({ item, source })),
		)
		.sort((a, b) => featuredIds.indexOf(a.item.id) - featuredIds.indexOf(b.item.id))
	const remaining = sections
		.map((section) => ({
			...section,
			items: section.items.filter((item) => !featuredIds.includes(item.id)),
		}))
		.filter((section) => section.items.length > 0)
	const { onRead, readingId } = useFeedReader("/feed")

	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
			<div className="flex items-center justify-end gap-3 md:min-h-10 md:justify-between">
				<h1 className="hidden page-title md:block">{t("title")}</h1>
				{empty ? null : (
					<div className="flex items-center gap-1">
						<AddFeedDialog />
						<FeedMenu ref={menuRef} onFollowing={() => setFollowing(true)} />
					</div>
				)}
			</div>

			{!empty ? <p className="mt-3 text-sm text-muted-fg">{t("description")}</p> : null}
			{following ? (
				<FollowingDialog
					feeds={[...sections, ...quiet]}
					onClose={() => {
						setFollowing(false)
						menuRef.current?.focus()
					}}
				/>
			) : null}
			{empty ? (
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<EmptyDrawing name="mailbox" className="mb-1 w-40" />
					<h2 className="text-lg font-medium text-fg">{t("empty.title")}</h2>
					<p className="max-w-sm text-sm">{t("empty.description")}</p>
					<AddFeedDialog className="mt-2" />
					<ImportOpmlButton />
				</div>
			) : null}

			{!empty && sections.length === 0 ? (
				<p className="mt-10 text-center text-sm text-muted-fg">{t("caughtUp")}</p>
			) : null}

			{featured.length > 0 ? (
				<section className="mt-8" aria-labelledby="feed-latest" data-testid="feed-latest">
					<h2 id="feed-latest" className="mb-4 text-lg font-medium">
						{t("fromYourFeeds")}
					</h2>
					<ul
						className={`grid gap-4 ${featured.length === 1 ? "" : featured.length === 2 ? "sm:grid-cols-2" : "lg:grid-cols-3"}`}
					>
						{featured.map(({ item, source }) => (
							<FeedArticle
								key={item.id}
								item={item}
								source={source.title}
								featured
								isNew={item.isNew}
								onRead={onRead}
								reading={readingId === item.id}
							/>
						))}
					</ul>
				</section>
			) : null}
			{remaining.length > 0 ? (
				<section className="mt-10" aria-labelledby="feed-more">
					<h2 id="feed-more" className="text-lg font-medium">
						{t(featured.length ? "more" : "subscriptions")}
					</h2>
					<div className="mt-6 grid items-start gap-6 md:grid-cols-2">
						{remaining.map((section) => (
							<Section key={section.id} section={section} onRead={onRead} readingId={readingId} />
						))}
					</div>
				</section>
			) : null}

			{quiet.length > 0 ? (
				<section className="mt-12" aria-labelledby="feed-quiet">
					<h2 id="feed-quiet" className="text-sm font-medium text-muted-fg">
						{t("quiet.title")}
					</h2>
					<ul className="mt-2 divide-y divide-border border-t border-border">
						{quiet.map((sub) => (
							<QuietRow key={sub.id} sub={sub} />
						))}
					</ul>
				</section>
			) : null}
		</main>
	)
}

function FollowingDialog({ feeds, onClose }: { feeds: FeedSubscription[]; onClose: () => void }) {
	const { t } = useTranslation("feed")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const [closed, setClosed] = useState(false)
	const fetchers = useFetchers()
	const pending = fetchers.some((fetcher) => fetcher.formAction === "/feed")
	useEffect(() => {
		if (!dialogRef.current?.open) dialogRef.current?.showModal()
	}, [])
	useEffect(() => {
		// Let row actions finish revalidating the page even when the user closes the modal early.
		if (closed && !pending) onClose()
	}, [closed, pending, onClose])
	return (
		<dialog
			ref={dialogRef}
			aria-label={t("following.title")}
			onClose={() => setClosed(true)}
			onClick={(event) => {
				if (event.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(event) => {
				// Row edits handle Escape first; other keys must not reach page shortcuts.
				event.stopPropagation()
			}}
			className="m-auto w-[min(36rem,92vw)] overflow-visible rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
		>
			<div className="flex max-h-[min(40rem,85dvh)] flex-col overflow-hidden rounded-2xl">
				<div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5 sm:px-6">
					<div>
						<h2 className="text-lg font-semibold">{t("following.title")}</h2>
						<p className="mt-1 text-sm text-muted-fg">{t("following.description")}</p>
					</div>
					<button
						type="button"
						onClick={() => dialogRef.current?.close()}
						aria-label={t("item.close")}
						className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>
				<div className="min-h-0 overflow-y-auto px-2 py-2 sm:px-3">
					{feeds.length ? (
						<ul className="divide-y divide-border md:divide-y-0 [@media(hover:none)]:divide-y [@media(pointer:coarse)]:divide-y">
							{[...feeds]
								.sort((a, b) => a.title.localeCompare(b.title))
								.map((sub) => (
									<QuietRow key={sub.id} sub={sub} inlineActions />
								))}
						</ul>
					) : (
						<p className="py-6 text-sm text-muted-fg">{t("following.empty")}</p>
					)}
				</div>
			</div>
		</dialog>
	)
}

function Section({
	section,
	onRead,
	readingId,
}: {
	section: FeedSection
	onRead: (itemId: string) => void
	readingId: FormDataEntryValue | null | undefined
}) {
	const { t } = useTranslation("feed")
	const listId = useId()
	const [expanded, setExpanded] = useState(false)
	const hidden = section.items.length - SECTION_PREVIEW
	const items = expanded ? section.items : section.items.slice(0, SECTION_PREVIEW)
	return (
		<section
			className="min-w-0 rounded-xl border border-border bg-card/40"
			data-testid="feed-section"
		>
			<div className="px-5 pt-4 sm:px-6">
				<SubscriptionHeader sub={section} as="h3" />
				<ul id={listId} className="divide-y divide-border">
					{items.map((item, i) => (
						<FeedArticle
							key={item.id}
							item={item}
							lead={i === 0}
							isNew={item.isNew}
							onRead={onRead}
							reading={readingId === item.id}
						/>
					))}
				</ul>
			</div>
			{hidden > 0 ? (
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={listId}
					onClick={() => setExpanded((e) => !e)}
					className="flex min-h-12 w-full items-center justify-between gap-3 rounded-b-xl border-t border-border bg-muted/30 px-5 py-3 text-left text-sm text-link hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-accent sm:px-6"
				>
					{expanded ? t("section.showLess") : t("section.showMore", { count: hidden })}
					<ChevronDown className={`size-4 shrink-0 ${expanded ? "rotate-180" : ""}`} aria-hidden />
				</button>
			) : null}
		</section>
	)
}

function QuietRow({
	sub,
	inlineActions = false,
}: {
	sub: FeedSubscription
	inlineActions?: boolean
}) {
	const { t, i18n } = useTranslation("feed")
	return (
		<li data-testid="feed-quiet-row" className={inlineActions ? "py-1" : "py-2"}>
			<SubscriptionHeader sub={sub} as="p" inlineActions={inlineActions}>
				<span className="truncate text-xs text-muted-fg" suppressHydrationWarning>
					{sub.lastPostAt
						? t("quiet.lastPost", { when: relativeTime(sub.lastPostAt, i18n.language) })
						: sub.hasItems
							? null
							: t("quiet.noPosts")}
				</span>
			</SubscriptionHeader>
		</li>
	)
}

/**
 * A subscription's title and management actions. The Following modal exposes the actions as
 * icons; publication headings keep their menu. Rename and unsubscribe confirmation stay in place.
 */
function SubscriptionHeader({
	sub,
	as: Title,
	children,
	inlineActions = false,
}: {
	sub: FeedSubscription
	as: "h3" | "p"
	children?: React.ReactNode
	inlineActions?: boolean
}) {
	const { t, i18n } = useTranslation("feed")
	const fetcher = useFetcher()
	const [mode, setMode] = useState<"idle" | "rename" | "unsubscribe">("idle")
	const previousMode = useRef(mode)
	const renameRef = useRef<HTMLButtonElement>(null)
	const unsubscribeRef = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		if (inlineActions && mode === "idle" && previousMode.current !== "idle") {
			const button = previousMode.current === "rename" ? renameRef : unsubscribeRef
			button.current?.focus({ preventScroll: true })
		}
		previousMode.current = mode
	}, [inlineActions, mode])
	const pending = fetcher.formData?.get("intent")
	if (pending === "unsubscribe") return null
	const title =
		pending === "rename" ? String(fetcher.formData?.get("title") || sub.title) : sub.title
	const heading = Title === "h3"
	const rowClass = inlineActions
		? "group/subscription flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-3 hover:bg-muted/50 focus-within:bg-muted/50"
		: heading
			? "flex min-h-11 items-center gap-2 border-b border-border pb-2"
			: "flex min-h-9 items-center gap-2"
	const troubleDetails = sub.trouble ? (
		<div className="space-y-1 text-xs text-muted-fg">
			{sub.lastError ? <p>{t("section.lastError", { error: sub.lastError })}</p> : null}
			<p>
				{sub.lastSuccessAt
					? t("section.lastSuccess", { when: relativeTime(sub.lastSuccessAt, i18n.language) })
					: t("section.neverUpdated")}
			</p>
		</div>
	) : null

	if (mode === "rename")
		return (
			<fetcher.Form
				method="post"
				action="/feed"
				onSubmit={() => setMode("idle")}
				className={rowClass}
			>
				<input type="hidden" name="intent" value="rename" />
				<input type="hidden" name="subscriptionId" value={sub.id} />
				<input
					name="title"
					defaultValue={sub.title}
					aria-label={t("section.renameLabel")}
					// oxlint-disable-next-line jsx-a11y/no-autofocus -- the user just asked to rename
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault()
							e.stopPropagation()
							setMode("idle")
						}
					}}
					className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm"
				/>
				<Button type="submit" size="sm">
					{t("section.renameSave")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
					{t("add.cancel")}
				</Button>
			</fetcher.Form>
		)

	if (mode === "unsubscribe")
		return (
			<fetcher.Form
				method="post"
				action="/feed"
				onSubmit={() => showToast({ message: t("toast.unsubscribed") })}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault()
						event.stopPropagation()
						setMode("idle")
					}
				}}
				className={cn(rowClass, "flex-wrap")}
			>
				<input type="hidden" name="intent" value="unsubscribe" />
				<input type="hidden" name="subscriptionId" value={sub.id} />
				<div className="w-full space-y-1 break-words">
					<p className="text-sm">{t("section.unsubscribeConfirm", { title: sub.title })}</p>
					<p className="text-xs text-muted-fg">{t("section.unsubscribeKeepsSaved")}</p>
				</div>
				<Button type="submit" size="sm" variant="danger" autoFocus={inlineActions}>
					{t("section.unsubscribe")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
					{t("add.cancel")}
				</Button>
			</fetcher.Form>
		)

	return (
		<div className={rowClass}>
			<div
				className={
					inlineActions
						? "flex w-full min-w-0 flex-col items-start gap-1 sm:w-auto sm:flex-1"
						: "flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5"
				}
			>
				<Title
					className={
						inlineActions
							? "w-full text-sm font-medium break-words"
							: heading
								? "min-w-0 text-sm font-semibold"
								: "min-w-0 truncate text-sm font-medium"
					}
				>
					{title}
				</Title>
				{children}
				{sub.trouble ? (
					<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-danger/40 px-2 py-0.5 text-xs text-danger">
						<AlertTriangle className="size-3" aria-hidden />
						{t("section.trouble")}
					</span>
				) : null}
				{inlineActions ? troubleDetails : null}
			</div>
			{inlineActions ? (
				<div
					data-testid="subscription-actions"
					className="ml-auto flex shrink-0 items-center gap-1 text-muted-fg opacity-100 transition-opacity md:opacity-0 md:group-hover/subscription:opacity-100 md:group-focus-within/subscription:opacity-100 [@media(hover:none)]:opacity-100 [@media(pointer:coarse)]:opacity-100"
				>
					<button
						ref={renameRef}
						type="button"
						aria-label={t("section.rename")}
						{...tooltip(t("section.rename"))}
						className={subscriptionActionClass}
						onClick={() => setMode("rename")}
					>
						<Pencil className="size-4" aria-hidden />
					</button>
					<a
						href={sub.siteUrl}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={t("section.openSite")}
						{...tooltip(t("section.openSite"))}
						className={subscriptionActionClass}
					>
						<ExternalLink className="size-4" aria-hidden />
					</a>
					<button
						ref={unsubscribeRef}
						type="button"
						aria-label={t("section.unsubscribe")}
						{...tooltip(t("section.unsubscribe"))}
						className={cn(subscriptionActionClass, "hover:text-danger")}
						onClick={() => setMode("unsubscribe")}
					>
						<UserMinus className="size-4" aria-hidden />
					</button>
				</div>
			) : (
				<MoreMenu label={t("section.menu")} className="shrink-0 p-2">
					{sub.trouble ? (
						<div role="none" className="max-w-64 px-2 py-1.5 text-xs text-muted-fg">
							{troubleDetails}
						</div>
					) : null}
					<MenuButton
						icon={<Pencil className="size-4" aria-hidden />}
						onClick={() => setMode("rename")}
					>
						{t("section.rename")}
					</MenuButton>
					<MenuLink icon={<ExternalLink className="size-4" aria-hidden />} href={sub.siteUrl}>
						{t("section.openSite")}
					</MenuLink>
					<MenuButton
						icon={<UserMinus className="size-4" aria-hidden />}
						onClick={() => setMode("unsubscribe")}
					>
						{t("section.unsubscribe")}
					</MenuButton>
				</MoreMenu>
			)}
		</div>
	)
}

const subscriptionActionClass =
	"inline-flex size-11 items-center justify-center rounded-md hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent md:size-8 [@media(pointer:coarse)]:size-11"
