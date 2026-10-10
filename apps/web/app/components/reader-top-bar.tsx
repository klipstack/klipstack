import {
	Archive,
	ArchiveRestore,
	ArrowLeft,
	ExternalLink,
	EyeOff,
	Link2,
	MessagesSquare,
	Newspaper,
	PanelRightClose,
	PanelRightOpen,
	Star,
	Tag,
	Trash2,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { MenuButton, MenuLink, MoreMenu } from "~/components/more-menu"
import { ReaderPrefs } from "~/components/reader-prefs"
import type { SidebarTab } from "~/components/reader-sidebar"
import { tooltip } from "~/components/tooltip-host"
import type { StateIntent } from "~/hooks/use-document-state"
import { copyLink } from "~/lib/copy-link"
import type { resolvePrefs } from "~/lib/prefs"
import { CHAT_HINT, HIGHLIGHTS_HINT, SHORTCUT_HINTS } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

const BUTTON = "rounded-md p-2 text-muted-fg hover:bg-muted hover:text-fg"

/**
 * The reader's sticky top bar: back, reading settings, star, the chat and the highlights sidebar,
 * and the article menu (archive among its actions). Hidden on phones it leaves its 2px progress line (plus the 1px border) at the
 * top edge. `ready`: the article is on screen (not failed or still being processed).
 */
export function ReaderTopBar({
	headerRef,
	ready,
	hidden,
	progress,
	title,
	titleShown,
	sourceUrl,
	back,
	prefs,
	onPrefs,
	starred,
	shortlisted,
	archived,
	onChange,
	onDelete,
	sidebarOpen,
	sidebarTab,
	onSidebar,
	onChat,
	onTags,
}: {
	headerRef: React.RefObject<HTMLElement | null>
	ready: boolean
	hidden: boolean
	progress: number
	title: string
	titleShown: boolean
	sourceUrl: string
	back: { to: string; state: unknown }
	prefs: ReturnType<typeof resolvePrefs>
	onPrefs: (prefs: ReturnType<typeof resolvePrefs>) => void
	starred: boolean
	/** Marked for the next edition. */
	shortlisted: boolean
	archived: boolean
	onChange: (intent: StateIntent) => void
	onDelete: () => void
	sidebarOpen: boolean
	/** Which tab the open sidebar shows: its button looks pressed. */
	sidebarTab: SidebarTab
	onSidebar: () => void
	/** Opens the sidebar on the article's chat (AI accounts); no button without it. */
	onChat?: () => void
	onTags: () => void
}) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const { t: tc } = useTranslation()
	const starLabel = starred ? t("actions.unstar") : t("actions.star")
	const archiveLabel = archived ? t("actions.unarchive") : t("actions.archive")
	return (
		<header
			ref={headerRef}
			className={cn(
				"safe-top sticky top-0 z-20 border-b border-border/60 bg-bg/90 backdrop-blur transition-transform duration-200",
				hidden && "max-md:-translate-y-[calc(100%-3px)] max-md:has-focus-visible:translate-y-0",
			)}
		>
			{ready ? (
				<div
					data-testid="reading-progress"
					aria-hidden
					className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent transition-transform duration-150"
					style={{ transform: `scaleX(${progress})` }}
				/>
			) : null}
			<div className="relative mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-2">
				{ready ? (
					// Centered on the bar, clear of the widest button group (right, ~11rem) on both sides.
					<button
						type="button"
						onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
						aria-hidden={!titleShown}
						tabIndex={titleShown ? 0 : -1}
						className={cn(
							"absolute left-1/2 hidden max-w-[calc(100%-24rem)] -translate-x-1/2 truncate rounded-md px-2 py-1 text-sm font-medium text-fg transition-opacity duration-200 hover:bg-muted md:block",
							titleShown ? "opacity-100" : "pointer-events-none opacity-0",
						)}
					>
						{title}
					</button>
				) : null}
				<div className="flex items-center gap-1">
					<Link
						to={back.to}
						state={back.state}
						aria-label={t("back")}
						{...tooltip(t("back"))}
						className={BUTTON}
					>
						<ArrowLeft className="size-5" aria-hidden />
					</Link>
					<ReaderPrefs prefs={prefs} onChange={onPrefs} />
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => onChange(starred ? "unstar" : "star")}
						{...tooltip(starLabel, SHORTCUT_HINTS.star)}
						aria-label={starLabel}
						aria-pressed={starred}
						className={BUTTON}
					>
						<Star className={cn("size-5", starred && "fill-favorite text-favorite")} aria-hidden />
					</button>
					{ready && onChat ? (
						<button
							type="button"
							onClick={onChat}
							aria-pressed={sidebarOpen && sidebarTab === "chat"}
							aria-label={t("ai.chat.open")}
							{...tooltip(t("ai.chat.open"), CHAT_HINT)}
							className={cn(BUTTON, sidebarOpen && sidebarTab === "chat" && "bg-muted text-fg")}
						>
							<MessagesSquare className="size-5" aria-hidden />
						</button>
					) : null}
					{ready ? (
						<button
							type="button"
							data-testid="toggle-sidebar"
							onClick={onSidebar}
							aria-pressed={sidebarOpen && sidebarTab === "notes"}
							aria-label={t("highlights.sidebar.toggle")}
							{...tooltip(t("highlights.sidebar.toggle"), HIGHLIGHTS_HINT)}
							className={cn(BUTTON, sidebarOpen && sidebarTab === "notes" && "bg-muted text-fg")}
						>
							{sidebarOpen && sidebarTab === "notes" ? (
								<PanelRightClose className="size-5" aria-hidden />
							) : (
								<PanelRightOpen className="size-5" aria-hidden />
							)}
						</button>
					) : null}
					<MoreMenu label={t("actions.more")} className="p-2">
						<MenuLink href={sourceUrl} icon={<ExternalLink className="size-4" aria-hidden />}>
							{t("original")}
						</MenuLink>
						<MenuButton
							icon={<Link2 className="size-4" aria-hidden />}
							onClick={() => copyLink(sourceUrl, tc("palette.copied"))}
						>
							{tc("palette.copyLink")}
						</MenuButton>
						{ready ? (
							<MenuButton
								icon={<Tag className="size-4" aria-hidden />}
								shortcut={SHORTCUT_HINTS.tags}
								onClick={onTags}
							>
								{tl("tags.edit")}
							</MenuButton>
						) : null}
						<MenuButton
							icon={<Newspaper className="size-4" aria-hidden />}
							shortcut={SHORTCUT_HINTS.shortlist}
							onClick={() => onChange(shortlisted ? "unshortlist" : "shortlist")}
						>
							{shortlisted ? t("actions.unshortlist") : t("actions.shortlist")}
						</MenuButton>
						<MenuButton
							icon={<EyeOff className="size-4" aria-hidden />}
							shortcut={SHORTCUT_HINTS.unread}
							onClick={() => onChange("unread")}
						>
							{tl("card.markUnread")}
						</MenuButton>
						<MenuButton
							icon={
								archived ? (
									<ArchiveRestore className="size-4" aria-hidden />
								) : (
									<Archive className="size-4" aria-hidden />
								)
							}
							shortcut={SHORTCUT_HINTS.archive}
							onClick={() => onChange(archived ? "unarchive" : "archive")}
						>
							{archiveLabel}
						</MenuButton>
						<MenuButton
							danger
							icon={<Trash2 className="size-4" aria-hidden />}
							shortcut={SHORTCUT_HINTS.delete}
							onClick={onDelete}
						>
							{tl("card.delete")}
						</MenuButton>
					</MoreMenu>
				</div>
			</div>
		</header>
	)
}
