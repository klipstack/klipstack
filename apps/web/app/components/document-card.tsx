import {
	Archive,
	ArchiveRestore,
	BookOpen,
	Check,
	EyeOff,
	Link2,
	Loader2,
	Newspaper,
	RotateCcw,
	Star,
	Tag,
	Trash2,
	Undo2,
} from "lucide-react"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useLocation, useNavigate } from "react-router"
import { useDraftUndoToast } from "~/hooks/use-draft-undo-toast"
import { useRestoreConflictToast } from "~/hooks/use-restore-conflict-toast"
import { warnAboutBacklinks } from "~/lib/backlink-warning.client"
import { useCommands } from "~/lib/commands"
import { copyLink } from "~/lib/copy-link"
import { type ArticleShortcut, articleShortcut, SELECT_HINT, SHORTCUT_HINTS } from "~/lib/shortcuts"
import { safeHost, siteLabel } from "~/lib/site-label"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { LibraryCard } from "~/services/documents.server"
import { ArticleImage } from "./article-image"
import { MenuAction, MenuButton, MoreMenu, type MoreMenuHandle } from "./more-menu"
import { TagChips, TagDialog } from "./tag-dialog"
import { tooltip } from "./tooltip-host"

/**
 * One article in a list view. `cursor` is the keyboard cursor: the card answers the action keys
 * (star, archive, delete, unread, open) and reports through `onVanish` when it leaves the list so
 * the cursor can move on. Moving the cursor is the list's job. `checked` is multi-select: while the
 * list is `selecting`, a click on the card toggles it (`onCheck`) and the selection bar has the
 * actions, so the card's own buttons and keys step aside.
 */
export function DocumentCard({
	doc,
	cursor = false,
	onVanish,
	checked = false,
	selecting = false,
	onCheck,
	pendingIntent = null,
}: {
	doc: LibraryCard
	cursor?: boolean
	onVanish?: (id: string) => void
	checked?: boolean
	selecting?: boolean
	/** `range`: shift was down, to check from the card toggled last. */
	onCheck?: (id: string, range: boolean) => void
	/** A bulk change on its way that includes this card. */
	pendingIntent?: string | null
}) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const fetcher = useFetcher()
	const location = useLocation()
	const navigate = useNavigate()
	const action = `/documents/${doc.id}/state`
	const from = location.pathname + location.search
	const pending = doc.status === "queued" || doc.status === "processing"
	const failed = doc.status === "failed"
	const optimisticIntent = fetcher.formData?.get("intent") ?? pendingIntent
	const starred =
		optimisticIntent === "star"
			? true
			: optimisticIntent === "unstar"
				? false
				: Boolean(doc.starredAt)
	const shortlisted =
		optimisticIntent === "shortlist"
			? true
			: optimisticIntent === "unshortlist"
				? false
				: Boolean(doc.shortlistedAt)
	const hidden =
		optimisticIntent === "archive" ||
		optimisticIntent === "unarchive" ||
		optimisticIntent === "delete" ||
		optimisticIntent === "restore" ||
		optimisticIntent === "purge" ||
		// Finishing archives: it leaves as archiving does.
		(optimisticIntent === "finish" && !doc.archivedAt)
	const trashed = Boolean(doc.deletedAt)
	const unread =
		optimisticIntent === "unread" ||
		(optimisticIntent !== "finish" && !doc.firstOpenedAt && !trashed && !failed)
	// "Delete forever" asks for a second tap within a few seconds instead of a dialog.
	const [armed, setArmed] = useState(false)
	const [tagging, setTagging] = useState(false)
	useEffect(() => {
		if (!armed) return
		const id = window.setTimeout(() => setArmed(false), 4000)
		return () => window.clearTimeout(id)
	}, [armed])
	// A restore refused because the page was saved again: say so, and offer that article.
	useRestoreConflictToast(fetcher.data)
	// Unmarked out of the draft in progress: Undo puts its copy back.
	useDraftUndoToast(fetcher.data)
	const title = doc.title ?? (pending ? doc.sourceUrl : t("card.untitled"))
	const host = safeHost(doc.sourceUrl)
	const image = doc.leadImageAssetId ? `/assets/${doc.leadImageAssetId}` : doc.leadImageUrl
	const picture = image && !pending ? image : null
	const description = doc.status === "ready" ? doc.description : null
	const archiving = !doc.archivedAt
	const canUnread =
		Boolean(doc.firstOpenedAt) && doc.status === "ready" && optimisticIntent !== "unread"
	const undoable = (intent: "archive" | "unarchive" | "delete") => {
		if (intent === "delete")
			warnAboutBacklinks(doc.id, (count) => t("toast.deletedLinked", { count }), t("toast.undo"))
		showToast({
			message: t(
				`toast.${intent === "delete" ? "deleted" : intent === "archive" ? "archived" : "unarchived"}`,
			),
			undo: {
				action,
				intent: intent === "delete" ? "restore" : intent === "archive" ? "undo-archive" : "archive",
				label: t("toast.undo"),
			},
		})
	}

	// ---- keyboard cursor ----
	const ref = useRef<HTMLLIElement>(null)
	const menuRef = useRef<MoreMenuHandle>(null)
	useEffect(() => {
		if (cursor) ref.current?.scrollIntoView({ block: "nearest" })
	}, [cursor])
	useEffect(() => {
		if (hidden && cursor) onVanish?.(doc.id)
	}, [hidden, cursor, onVanish, doc.id])
	// Trashed articles answer no keys: no accidental "delete forever".
	const act = (shortcut: ArticleShortcut): boolean => {
		if (trashed) return false
		if (failed && shortcut !== "delete") return false
		const submit = (intent: string) => fetcher.submit({ intent }, { method: "post", action })
		switch (shortcut) {
			case "open":
				if (doc.status !== "ready") return false
				void navigate(`/read/${doc.id}`, { state: { from } })
				return true
			case "star":
				submit(starred ? "unstar" : "star")
				return true
			case "shortlist":
				submit(shortlisted ? "unshortlist" : "shortlist")
				return true
			case "archive":
				undoable(archiving ? "archive" : "unarchive")
				submit(archiving ? "archive" : "unarchive")
				return true
			case "delete":
				undoable("delete")
				submit("delete")
				return true
			case "unread":
				if (!canUnread) return false
				submit("unread")
				return true
			case "tags":
				setTagging(true)
				return true
		}
	}
	const actRef = useRef(act)
	useInsertionEffect(() => {
		actRef.current = act
	})
	// While selecting, the keys act on the selection (the selection bar), not on this card.
	useEffect(() => {
		if (!cursor || selecting) return
		const onKey = (e: KeyboardEvent) => {
			const shortcut = articleShortcut(e)
			if (shortcut && actRef.current(shortcut)) e.preventDefault()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [cursor, selecting])
	// The article under the cursor also offers its actions in the command palette.
	useCommands(() =>
		cursor && !selecting && !trashed && !hidden
			? {
					heading: tc("palette.selected"),
					commands: [
						...(doc.status === "ready"
							? [
									{
										id: "card-open",
										label: t("card.open"),
										icon: BookOpen,
										shortcut: SHORTCUT_HINTS.open,
										run: () => act("open"),
									},
								]
							: []),
						...(failed
							? [
									{
										id: "card-retry",
										label: t("status.retry"),
										icon: RotateCcw,
										run: () => fetcher.submit({ intent: "retry" }, { method: "post", action }),
									},
								]
							: [
									{
										id: "card-star",
										label: starred ? t("card.unstar") : t("card.star"),
										icon: Star,
										shortcut: SHORTCUT_HINTS.star,
										run: () => act("star"),
									},
									{
										id: "card-shortlist",
										label: shortlisted ? t("card.unshortlist") : t("card.shortlist"),
										icon: Newspaper,
										shortcut: SHORTCUT_HINTS.shortlist,
										run: () => act("shortlist"),
									},
									{
										id: "card-archive",
										label: archiving ? t("card.archive") : t("card.unarchive"),
										icon: archiving ? Archive : ArchiveRestore,
										shortcut: SHORTCUT_HINTS.archive,
										run: () => act("archive"),
									},
								]),
						...(canUnread
							? [
									{
										id: "card-unread",
										label: t("card.markUnread"),
										icon: EyeOff,
										shortcut: SHORTCUT_HINTS.unread,
										run: () => act("unread"),
									},
								]
							: []),
						...(failed
							? []
							: [
									{
										id: "card-tags",
										label: t("tags.editCommand"),
										icon: Tag,
										shortcut: SHORTCUT_HINTS.tags,
										keywords: ["label"],
										run: () => act("tags"),
									},
								]),
						{
							id: "card-copy-link",
							label: tc("palette.copyLink"),
							icon: Link2,
							keywords: ["url", "share"],
							run: () => copyLink(doc.sourceUrl, tc("palette.copied")),
						},
						{
							id: "card-delete",
							label: t("card.delete"),
							icon: Trash2,
							shortcut: SHORTCUT_HINTS.delete,
							danger: true,
							run: () => act("delete"),
						},
					],
				}
			: null,
	)

	if (hidden) return null

	const check = onCheck ? (range: boolean) => onCheck(doc.id, range) : null
	const checkLabel = t("select.one", { title })
	// Phones in list layout have no image on the left to put the box on (only a small one beside the
	// description, when there is one): while selecting it takes the place of the card's own buttons
	// (hidden then, their space kept), so the row does not shift.
	const phoneBox =
		selecting && check ? (
			<CardCheckbox
				checked={checked}
				label={checkLabel}
				onToggle={check}
				shown
				className="visible absolute top-0.5 right-0.5 sm:hidden layout-grid:hidden"
			/>
		) : null

	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keys toggle through the box and `x`
		<li
			ref={ref}
			data-cursor={cursor || undefined}
			data-checked={checked || undefined}
			// Right-click opens the article's own menu, not the browser's link menu.
			onContextMenu={(e) => {
				if (!menuRef.current || selecting) return
				e.preventDefault()
				menuRef.current.openAt(e.clientX, e.clientY)
			}}
			// Selecting: a click anywhere on the card toggles it; its own controls keep their clicks.
			onClick={
				selecting && check
					? (e) => {
							if (e.target instanceof Element && e.target.closest("a, button")) return
							check(e.shiftKey)
						}
					: undefined
			}
			onMouseDown={
				selecting
					? (e) => {
							// Shift-click checks a range; it should not select text as well.
							if (e.shiftKey) e.preventDefault()
						}
					: undefined
			}
			className={cn(
				"group/card -mx-3 relative isolate scroll-mb-24 md:scroll-mt-20 flex gap-4 rounded-lg px-3 py-4 transition-colors before:absolute before:inset-x-3 before:bottom-0 before:h-px before:bg-border last:before:hidden data-cursor:ring-2 data-cursor:ring-ring layout-grid:-m-2 layout-grid:flex-col layout-grid:gap-2 layout-grid:rounded-2xl layout-grid:p-2 layout-grid:before:hidden",
				checked
					? "bg-selected/60 before:hidden hover:bg-selected/80"
					: "hover:bg-muted data-cursor:bg-muted",
				selecting && "cursor-pointer select-none",
			)}
		>
			{unread ? (
				<span
					data-testid="unread-dot"
					role="img"
					aria-label={t("card.unread")}
					className="absolute top-2.5 left-1.5 size-3 rounded-full bg-accent ring-2 ring-bg layout-grid:top-0.5 layout-grid:left-0.5"
				/>
			) : null}
			<div className="relative hidden shrink-0 sm:block layout-grid:block">
				<ArticleImage
					src={picture}
					className="h-24 w-32 rounded-lg layout-grid:aspect-[16/10] layout-grid:h-auto layout-grid:w-full"
				/>
				{check ? (
					<CardCheckbox
						checked={checked}
						label={checkLabel}
						onToggle={check}
						shown={selecting || checked}
						className="absolute top-2 left-2"
					/>
				) : null}
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h3 className="line-clamp-2 font-serif text-xl leading-snug layout-grid:line-clamp-3 layout-grid:text-balance layout-grid:leading-tight lg:layout-grid:text-2xl">
					{doc.status === "ready" && !trashed && !selecting ? (
						<Link
							to={`/read/${doc.id}`}
							state={{ from }}
							className="after:absolute after:inset-0 after:content-['']"
						>
							{title}
						</Link>
					) : (
						// A title that is the address breaks anywhere; a real one only between words.
						<span className={cn(!doc.title && "break-all", failed && "text-muted-fg")}>
							{title}
						</span>
					)}
				</h3>
				<p className="flex gap-1 text-sm text-muted-fg">
					<span className="truncate">
						{[siteLabel(doc.siteName, host), doc.author].filter(Boolean).join(" · ")}
					</span>
					{doc.readingMinutes ? (
						// Always readable: the site and the author give way first.
						<span className="shrink-0">
							{`· ${t("card.minutes", { count: doc.readingMinutes })}`}
						</span>
					) : null}
					{doc.readAt ? <span className="shrink-0">{`· ${t("card.finished")}`}</span> : null}
					{shortlisted ? (
						<span
							data-testid="card-shortlisted"
							className="inline-flex shrink-0 items-center gap-1"
						>
							{"· "}
							<Newspaper className="size-3.5" aria-hidden />
							{t("card.shortlisted")}
						</span>
					) : null}
				</p>
				{description || picture ? (
					// Phones in list layout have no room for the image on the left: a square of it goes
					// beside the description, when there is one, as in the mobile app.
					<div
						className={cn("flex items-start gap-3 layout-grid:hidden", !description && "sm:hidden")}
					>
						{description ? (
							<p className="line-clamp-2 flex-1 text-sm text-muted-fg max-sm:line-clamp-3">
								{description}
							</p>
						) : null}
						{picture ? (
							<ArticleImage
								src={picture}
								className="ml-auto size-16 shrink-0 rounded-md sm:hidden"
							/>
						) : null}
					</div>
				) : null}
				<TagChips tags={doc.tags} max={3} testId="card-tags" className="mt-0.5" />
				{pending ? (
					<p className="flex items-center gap-1.5 text-sm text-muted-fg">
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
						{t(`status.${doc.status}` as "status.queued" | "status.processing")}
					</p>
				) : null}
				{failed ? (
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span className="text-danger">{t(failureKey(doc.failureReason))}</span>
						<fetcher.Form method="post" action={action} className="relative z-10">
							<input type="hidden" name="intent" value="retry" />
							<button
								type="submit"
								className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-link hover:bg-muted"
							>
								<RotateCcw className="size-3.5" aria-hidden />
								{t("status.retry")}
							</button>
						</fetcher.Form>
					</div>
				) : null}
				{doc.readingProgress > 0 && doc.readingProgress < 1 && doc.status === "ready" ? (
					<div className="mt-1 h-1 w-full overflow-hidden rounded bg-fg/10" aria-hidden>
						<div
							className="h-full bg-accent"
							style={{ width: `${Math.round(doc.readingProgress * 100)}%` }}
						/>
					</div>
				) : null}
			</div>
			{trashed ? (
				<div
					className={cn(
						"relative z-10 flex shrink-0 flex-col items-end gap-1 self-start layout-grid:-ml-1.5 layout-grid:flex-row",
						selecting && "invisible",
					)}
				>
					{phoneBox}
					<fetcher.Form
						method="post"
						action={action}
						onSubmit={() =>
							showToast({
								message: t("toast.restored"),
								undo: { action, intent: "delete", label: t("toast.undo") },
							})
						}
					>
						<input type="hidden" name="intent" value="restore" />
						<IconButton label={t("card.restore")}>
							<Undo2 className="size-4" aria-hidden />
						</IconButton>
					</fetcher.Form>
					<fetcher.Form
						method="post"
						action={action}
						onSubmit={(e) => {
							if (!armed) {
								e.preventDefault()
								setArmed(true)
							}
						}}
					>
						<input type="hidden" name="intent" value="purge" />
						<button
							type="submit"
							{...tooltip(armed ? t("card.deleteForeverConfirm") : t("card.deleteForever"))}
							aria-label={armed ? t("card.deleteForeverConfirm") : t("card.deleteForever")}
							className={cn(
								"flex items-center gap-1 rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg",
								armed && "bg-danger/10 text-danger hover:bg-danger/20 hover:text-danger",
							)}
						>
							<Trash2 className="size-4" aria-hidden />
							{armed ? (
								<span className="pr-1 text-xs font-medium">{t("card.deleteForeverConfirm")}</span>
							) : null}
						</button>
					</fetcher.Form>
				</div>
			) : (
				<div
					className={cn(
						"relative z-10 flex shrink-0 flex-col items-end gap-1 self-start layout-grid:-ml-1.5 layout-grid:flex-row",
						selecting && "invisible",
					)}
				>
					{phoneBox}
					{/* Nothing was captured: starring or filing it away would be filing away a URL. */}
					<fetcher.Form method="post" action={action} className={cn(reveal, failed && "hidden")}>
						<input type="hidden" name="intent" value={starred ? "unstar" : "star"} />
						<IconButton
							label={starred ? t("card.unstar") : t("card.star")}
							hint={SHORTCUT_HINTS.star}
						>
							<Star
								className={cn("size-4", starred && "fill-favorite text-favorite")}
								aria-hidden
							/>
						</IconButton>
					</fetcher.Form>
					<fetcher.Form
						method="post"
						action={action}
						className={cn(reveal, failed && "hidden")}
						onSubmit={() => undoable(archiving ? "archive" : "unarchive")}
					>
						<input type="hidden" name="intent" value={archiving ? "archive" : "unarchive"} />
						<IconButton
							label={doc.archivedAt ? t("card.unarchive") : t("card.archive")}
							hint={SHORTCUT_HINTS.archive}
						>
							{doc.archivedAt ? (
								<ArchiveRestore className="size-4" aria-hidden />
							) : (
								<Archive className="size-4" aria-hidden />
							)}
						</IconButton>
					</fetcher.Form>
					<MoreMenu ref={menuRef} label={t("card.more")} className={reveal}>
						{canUnread ? (
							<MenuAction
								fetcher={fetcher}
								action={action}
								intent="unread"
								icon={<EyeOff className="size-4" aria-hidden />}
								shortcut={SHORTCUT_HINTS.unread}
							>
								{t("card.markUnread")}
							</MenuAction>
						) : null}
						{failed ? null : (
							<MenuButton
								icon={<Tag className="size-4" aria-hidden />}
								shortcut={SHORTCUT_HINTS.tags}
								onClick={() => setTagging(true)}
							>
								{t("tags.edit")}
							</MenuButton>
						)}
						{failed ? null : (
							<MenuAction
								fetcher={fetcher}
								action={action}
								intent={shortlisted ? "unshortlist" : "shortlist"}
								icon={<Newspaper className="size-4" aria-hidden />}
								shortcut={SHORTCUT_HINTS.shortlist}
							>
								{shortlisted ? t("card.unshortlist") : t("card.shortlist")}
							</MenuAction>
						)}
						<MenuButton
							icon={<Link2 className="size-4" aria-hidden />}
							onClick={() => copyLink(doc.sourceUrl, tc("palette.copied"))}
						>
							{tc("palette.copyLink")}
						</MenuButton>
						<MenuAction
							fetcher={fetcher}
							action={action}
							intent="delete"
							danger
							icon={<Trash2 className="size-4" aria-hidden />}
							shortcut={SHORTCUT_HINTS.delete}
							onSubmit={() => undoable("delete")}
						>
							{t("card.delete")}
						</MenuAction>
					</MoreMenu>
				</div>
			)}
			{tagging ? (
				<TagDialog
					documentId={doc.id}
					title={title}
					tags={doc.tags}
					onClose={() => setTagging(false)}
				/>
			) : null}
		</li>
	)
}

/** Desktop: hidden until the card is hovered, focused or under the cursor; phones: always visible. */
const reveal =
	"opacity-100 transition-opacity md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:group-data-cursor/card:opacity-100"

/**
 * The multi-select box. Until the list is selecting it shows on hover, focus and the cursor, which
 * hints at `x`; touch screens have no hover and use the top bar's Select.
 */
function CardCheckbox({
	checked,
	label,
	onToggle,
	shown,
	className,
}: {
	checked: boolean
	label: string
	onToggle: (range: boolean) => void
	shown: boolean
	className?: string
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			aria-label={label}
			{...tooltip(label, SELECT_HINT)}
			onMouseDown={(e) => {
				if (e.shiftKey) e.preventDefault()
			}}
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
				onToggle(e.shiftKey)
			}}
			className={cn(
				"z-10 flex size-6 items-center justify-center rounded-md border-2 shadow-sm transition-opacity",
				checked
					? "border-accent bg-accent text-accent-fg"
					: "border-fg/50 bg-card/90 text-transparent hover:border-fg/80",
				shown
					? "opacity-100"
					: "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 group-data-cursor/card:opacity-100",
				className,
			)}
		>
			<Check className="size-4" strokeWidth={3} aria-hidden />
		</button>
	)
}

/** `hint` is the key that does the same thing; it goes in the tooltip, not the accessible name. */
function IconButton({
	label,
	hint,
	children,
}: {
	label: string
	hint?: string
	children: React.ReactNode
}) {
	return (
		<button
			type="submit"
			{...tooltip(label, hint)}
			aria-label={label}
			className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
		>
			{children}
		</button>
	)
}

const FAILURE_CODES = [
	"blocked_host",
	"http_error",
	"not_html",
	"no_content",
	"timeout",
	"fetch_failed",
	"too_large",
	"too_many_redirects",
	"invalid_url",
	"unknown",
] as const
type FailureCode = (typeof FAILURE_CODES)[number]

/** i18n key (library namespace) for a stored failure reason such as "http_error:404". */
export function failureKey(reason: string | null): `failure.${FailureCode}` {
	const code = (reason ?? "unknown").split(":")[0] as string
	return `failure.${(FAILURE_CODES as readonly string[]).includes(code) ? (code as FailureCode) : "unknown"}`
}

export { safeHost } from "~/lib/site-label"
