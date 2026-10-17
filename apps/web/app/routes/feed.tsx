import { AlertTriangle, ExternalLink, Pencil, Rss, UserMinus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, redirect, useFetcher, useFetchers } from "react-router"
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
import { SiteStamp } from "~/components/site-stamp"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { useFeedReader } from "~/hooks/use-feed-reader"
import { AppError } from "~/lib/app-error"
import { dateGroupLabel, timeZoneFromCookie } from "~/lib/date-groups"
import { requireFeeds } from "~/lib/features.server"
import { groupRiver, type RiverPost, riverPosts } from "~/lib/feed-river"
import { getLocale } from "~/lib/i18n.server"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { relativeTime } from "~/lib/relative-time"
import { readForm } from "~/lib/request-body.server"
import { requireUser } from "~/lib/session.server"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import { answer } from "~/lib/web-action.server"
import {
	type FeedListItem,
	type FeedSubscription,
	listFeedPage,
	listFollowedFeeds,
} from "~/services/feeds.server"
import type { Route } from "./+types/feed"

/** Posts already seen shown at first, and added by each "Show more". */
const SEEN_PAGE = 20

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.feed") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "common:nav.feed" } }

/**
 * GET /feed, or /feed?site=<subscription id> for one site's posts. The posts of every site come as
 * one river by date (`riverPosts`), dated in the reader's time zone here, where the page is drawn
 * first. A site the reader does not follow (any more: they just unfollowed it) is all of them.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	await requireFeeds(user.id)
	const asked = new URL(request.url).searchParams.get("site")
	const followed = await listFollowedFeeds(user.id)
	const site = asked ? followed.find((f) => f.id === asked) : undefined
	if (asked && !site) throw redirect("/feed")
	const { sections } = await listFeedPage(user.id, { subscriptionId: site?.id })
	const now = new Date()
	const timeZone = timeZoneFromCookie(request.headers.get("cookie"))
	return {
		posts: riverPosts(sections, now, timeZone),
		followed,
		site: site?.id ?? null,
		// Formatted here, as other dates are: the server's Intl and the browser's may differ.
		today: new Intl.DateTimeFormat(getLocale(context), { dateStyle: "full", timeZone }).format(now),
	}
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

type Followed = Route.ComponentProps["loaderData"]["followed"][number]
type Post = RiverPost<FeedListItem>

/** New to the reader: neither opened, saved, nor acknowledged. */
const isFresh = (post: Post) => post.item.isNew && !post.item.documentId

/**
 * The feed as a paper: today's date and what is new over a double rule, then the river of posts,
 * new ones first, with the sites followed beside it (above it on a phone) to read one at a time.
 */
export default function FeedPage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("feed")
	const { posts, followed, site, today } = loaderData
	const [following, setFollowing] = useState(false)
	const menuRef = useRef<MoreMenuHandle>(null)
	// What was new on arrival stays with the new posts through Save and live updates, so a saved post
	// keeps its place; a new visit sorts afresh. Posts that arrive meanwhile join them.
	const [freshIds, setFreshIds] = useState(
		() => new Set(posts.filter(isFresh).map((p) => p.item.id)),
	)
	const arrived = posts.filter((p) => isFresh(p) && !freshIds.has(p.item.id))
	if (arrived.length) setFreshIds(new Set([...freshIds, ...arrived.map((p) => p.item.id)]))
	const { onRead, readingId } = useFeedReader("/feed")

	if (followed.length === 0)
		return (
			<main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
				<h1 className="hidden page-title md:block">{t("title")}</h1>
				<div className="mt-12 flex flex-col items-center gap-3 text-center text-muted-fg md:mt-16">
					<EmptyDrawing name="mailbox" className="mb-1 w-40" />
					<h2 className="text-lg font-medium text-fg">{t("empty.title")}</h2>
					<p className="max-w-sm text-sm">{t("empty.description")}</p>
					<AddFeedDialog className="mt-2" />
					<ImportOpmlButton />
				</div>
			</main>
		)

	const chosen = site ? followed.find((f) => f.id === site) : undefined
	const fresh = posts.filter((p) => freshIds.has(p.item.id))
	const seen = posts.filter((p) => !freshIds.has(p.item.id))
	const newCount = posts.filter(isFresh).length
	const newSites = new Set(posts.filter(isFresh).map((p) => p.source.id)).size

	return (
		<main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8">
			<div className="flex items-center justify-end gap-3 md:min-h-10 md:justify-between">
				<h1 className="hidden page-title md:block">{t("title")}</h1>
				<div className="flex items-center gap-1">
					<AddFeedDialog />
					<FeedMenu ref={menuRef} onFollowing={() => setFollowing(true)} />
				</div>
			</div>
			{/* The paper's dateline: the day, and what came since the reader last looked. */}
			<div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-fg/80 border-b-[3px] border-b-fg/50 [border-bottom-style:double] py-2 text-sm text-muted-fg">
				<span suppressHydrationWarning>{today}</span>
				<span data-testid="feed-summary">
					{newCount ? (
						<Trans
							t={t}
							i18nKey={chosen || newSites === 1 ? "summary.newHere" : "summary.new"}
							values={{ count: newCount, sites: newSites }}
							components={{ mark: <span className="marked px-1 text-fg" /> }}
						/>
					) : (
						t("summary.none")
					)}
				</span>
			</div>
			{following ? (
				<FollowingDialog
					feeds={followed}
					onClose={() => {
						setFollowing(false)
						menuRef.current?.focus()
					}}
				/>
			) : null}

			<SiteChips followed={followed} site={site} />
			<div className="mt-6 grid gap-x-12 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
				<div className="min-w-0">
					{chosen ? <ChosenSite sub={chosen} /> : null}
					{fresh.length ? (
						<River
							posts={fresh}
							fresh
							label={t("river.new")}
							onRead={onRead}
							readingId={readingId}
						/>
					) : null}
					{posts.length === 0 ? (
						<p className="py-10 text-center text-sm text-muted-fg">{t("caughtUp")}</p>
					) : seen.length ? (
						<SeenPosts
							posts={seen}
							after={fresh.length > 0}
							onRead={onRead}
							readingId={readingId}
						/>
					) : null}
				</div>
				<SiteList followed={followed} site={site} onManage={() => setFollowing(true)} />
			</div>
		</main>
	)
}

/** Posts by day: a small heading over each day's run, the posts as rows beneath. */
function River({
	posts,
	fresh = false,
	label,
	onRead,
	readingId,
}: {
	posts: Post[]
	fresh?: boolean
	label: string
	onRead: (itemId: string) => void
	readingId: FormDataEntryValue | null | undefined
}) {
	const { t, i18n } = useTranslation("feed")
	const groups = groupRiver(posts, () => true)
	const lead = fresh ? posts[0]?.item.id : undefined
	return (
		<section aria-label={label} data-testid={fresh ? "feed-new" : "feed-seen"}>
			{groups.map(({ group, posts: day }) => (
				<div key={group} className="mt-8 first:mt-0">
					<h2 className="flex items-center gap-3 text-xs font-medium tracking-wide text-muted-fg uppercase after:h-px after:flex-1 after:bg-border">
						{dateGroupLabel(group, i18n.language, (key) => t(`groups.${key}`))}
					</h2>
					<ul>
						{day.map(({ item, source }) => (
							<FeedArticle
								key={item.id}
								item={item}
								stamp={source}
								isNew={item.isNew}
								fresh={fresh}
								lead={item.id === lead}
								onRead={onRead}
								reading={readingId === item.id}
							/>
						))}
					</ul>
				</div>
			))}
		</section>
	)
}

/** Below the new posts, the ones already seen: a few at first, more on asking. */
function SeenPosts({
	posts,
	after,
	onRead,
	readingId,
}: {
	posts: Post[]
	after: boolean
	onRead: (itemId: string) => void
	readingId: FormDataEntryValue | null | undefined
}) {
	const { t } = useTranslation("feed")
	const [shown, setShown] = useState(SEEN_PAGE)
	return (
		<div className={after ? "mt-10" : undefined}>
			{after ? (
				<p
					data-testid="feed-caught-up"
					className="mb-8 border-t border-dashed border-border pt-4 text-center text-sm text-muted-fg"
				>
					{t("river.caughtUp")}
				</p>
			) : null}
			<River
				posts={posts.slice(0, shown)}
				label={t("river.seen")}
				onRead={onRead}
				readingId={readingId}
			/>
			{posts.length > shown ? (
				<div className="mt-4 flex justify-center">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => setShown(shown + SEEN_PAGE)}
					>
						{t("river.showMore")}
					</Button>
				</div>
			) : null}
		</div>
	)
}

/** One site's posts: its name over them, its actions beside it, and the way back to every site. */
function ChosenSite({ sub }: { sub: Followed }) {
	const { t } = useTranslation("feed")
	return (
		<div className="mb-6 flex items-center gap-3">
			<SiteStamp siteUrl={sub.siteUrl} title={sub.title} size={36} />
			<div className="min-w-0 flex-1">
				<SubscriptionHeader sub={sub} as="h2" />
			</div>
			<Link
				to="/feed"
				preventScrollReset
				className="shrink-0 text-sm text-link hover:underline lg:hidden"
			>
				{t("rail.all")}
			</Link>
		</div>
	)
}

/** The sites followed, beside the river on a wide screen: each with its stamp and what is new. */
function SiteList({
	followed,
	site,
	onManage,
}: {
	followed: Followed[]
	site: string | null
	onManage: () => void
}) {
	const { t } = useTranslation("feed")
	const total = followed.reduce((sum, f) => sum + f.newCount, 0)
	return (
		<nav aria-label={t("rail.label")} className="hidden lg:block">
			<div className="sticky top-6">
				<div className="mb-2 flex items-baseline justify-between gap-2">
					<h2 className="section-title text-xl">{t("rail.title")}</h2>
					<button
						type="button"
						onClick={onManage}
						className="rounded-sm text-sm text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
					>
						{t("rail.manage")}
					</button>
				</div>
				<ul data-testid="feed-sites" className="flex flex-col gap-0.5">
					<li>
						<SiteLink to="/feed" current={!site} count={total}>
							<Rss className="size-[18px] shrink-0 p-0.5 text-muted-fg" aria-hidden />
							<span className="truncate">{t("rail.all")}</span>
						</SiteLink>
					</li>
					{followed.map((sub) => (
						<li key={sub.id}>
							<SiteLink
								to={`/feed?site=${sub.id}`}
								current={site === sub.id}
								count={sub.newCount}
								trouble={sub.trouble}
							>
								<SiteStamp siteUrl={sub.siteUrl} title={sub.title} size={18} />
								<span className="truncate">{sub.title}</span>
							</SiteLink>
						</li>
					))}
				</ul>
			</div>
		</nav>
	)
}

function SiteLink({
	to,
	current,
	count,
	trouble = false,
	children,
}: {
	to: string
	current: boolean
	count: number
	trouble?: boolean
	children: React.ReactNode
}) {
	const { t } = useTranslation("feed")
	return (
		<Link
			to={to}
			preventScrollReset
			aria-current={current ? "page" : undefined}
			className={cn(
				"flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent",
				current
					? "font-medium [&_[data-nav-ink]]:marked-item"
					: "hover:[&_[data-nav-ink]]:ink-hover-item",
			)}
		>
			<span data-nav-ink className="flex min-w-0 items-center gap-2.5">
				{children}
			</span>
			{trouble ? (
				<AlertTriangle
					className="ml-auto size-3.5 shrink-0 text-danger"
					role="img"
					aria-label={t("section.trouble")}
				/>
			) : count ? (
				<span className="ml-auto text-xs text-link tabular-nums">
					<span aria-hidden>{count}</span>
					<span className="sr-only">{t("rail.newCount", { count })}</span>
				</span>
			) : null}
		</Link>
	)
}

/** The same sites on a narrow screen: a row of chips above the river, scrolled sideways. */
function SiteChips({ followed, site }: { followed: Followed[]; site: string | null }) {
	const { t } = useTranslation("feed")
	const chip = (current: boolean) =>
		cn("chip flex shrink-0 items-center gap-2 whitespace-nowrap", current && "marked text-fg")
	return (
		<nav aria-label={t("rail.label")} className="-mx-4 mt-3 overflow-x-auto px-4 lg:hidden">
			<ul className="flex w-max gap-1 py-1">
				<li>
					<Link
						to="/feed"
						preventScrollReset
						aria-current={!site ? "page" : undefined}
						className={chip(!site)}
					>
						{t("rail.all")}
					</Link>
				</li>
				{followed.map((sub) => (
					<li key={sub.id}>
						<Link
							to={`/feed?site=${sub.id}`}
							preventScrollReset
							aria-current={site === sub.id ? "page" : undefined}
							className={chip(site === sub.id)}
						>
							<SiteStamp siteUrl={sub.siteUrl} title={sub.title} size={16} />
							{sub.title}
							{sub.newCount ? (
								<span className="text-xs text-link tabular-nums">{sub.newCount}</span>
							) : null}
						</Link>
					</li>
				))}
			</ul>
		</nav>
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
	as: "h2" | "h3" | "p"
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
	const heading = Title !== "p"
	const rowClass = inlineActions
		? "group/subscription flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-3 hover:bg-muted/50 focus-within:bg-muted/50"
		: Title === "h2"
			? "flex min-h-11 items-center gap-2"
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
							: Title === "h2"
								? "min-w-0 section-title break-words"
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
