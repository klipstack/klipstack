import {
	Archive,
	ArrowLeft,
	Bookmark,
	CircleAlert,
	House,
	LibraryBig,
	Menu,
	Newspaper,
	NotebookPen,
	PanelLeftClose,
	PanelLeftOpen,
	Rss,
	Search,
	Shapes,
	Star,
	Tag,
	Trash2,
	X,
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, NavLink, useFetcher, useLocation, useNavigate } from "react-router"
import { useKeyTranslation } from "~/lib/i18n-keys"
import { usePageBar } from "~/lib/page-bar"
import { awaitsWords, searchOrigin, searchPath } from "~/lib/search-page"
import { setSidebar, useSidebar } from "~/lib/sidebar"
import { countTopicSearch } from "~/lib/topic-use"
import { cn } from "~/lib/utils"
import { type AccountUser, AccountMenu } from "./account-menu"
import { BrandLogoSmall } from "./brand-mark"
import { CommandPaletteButton } from "./command-palette"
import { LayoutToggle } from "./layout-toggle"
import { MobileDrawer, useMobileDrawer } from "./mobile-drawer"
import { MenuNavLink, MoreMenu, type MoreMenuHandle } from "./more-menu"
import { PullToRefresh } from "./pull-to-refresh"
import { SaveLinkDialog } from "./save-link-dialog"
import {
	SavedSearchDialog,
	type SavedSearchItem,
	SavedSearchMenuItems,
} from "./saved-search-dialog"
import { SearchField } from "./search-field"
import { SelectButton } from "./select-button"
import { SidebarResizer } from "./sidebar-resizer"
import { tooltip } from "./tooltip-host"

const items = [
	{ to: "/home", key: "nav.home", icon: House },
	{ to: "/library", key: "nav.inbox", icon: LibraryBig },
	{ to: "/feed", key: "nav.feed", icon: Rss },
	{ to: "/archive", key: "nav.archive", icon: Archive },
	{ to: "/starred", key: "nav.starred", icon: Star },
	{ to: "/notebook", key: "nav.notebook", icon: NotebookPen },
	{ to: "/editions", key: "nav.editions", icon: Newspaper },
	// One link, not the tags themselves: a library can have hundreds. The command menu finds one.
	{ to: "/tags", key: "nav.tags", icon: Tag },
	{ to: "/topics", key: "nav.topics", icon: Shapes },
	{ to: "/trash", key: "nav.trash", icon: Trash2 },
] as const

/** Topics in the sidebar: none for an account without them; a dot for a proposal not opened yet. */
export type TopicsNav = { unseen: boolean } | null

export const linkClass =
	(collapsed: boolean) =>
	({ isActive }: { isActive: boolean }) =>
		cn(
			"relative flex items-center gap-2 rounded-lg text-sm",
			collapsed ? "mx-auto size-9 justify-center" : "px-2 py-2 md:py-1.5",
			isActive
				? collapsed
					? "marked"
					: "font-medium [&_[data-nav-label]]:marked-text"
				: "hover:bg-fg/10",
		)

/** Icon centered in a slot as wide as the brand mark, so nav labels align with the app name. */
export function NavIcon({ icon: Icon }: { icon: typeof LibraryBig }) {
	return (
		<span className="flex w-6 shrink-0 justify-center">
			<Icon className="size-4" aria-hidden />
		</span>
	)
}

/** Navigation, theme switch, account: shared by the desktop sidebar and the mobile drawer. */
function SidebarContent({
	user,
	feedNew,
	editionDue,
	topics,
	savedSearches,
	collapsed = false,
	onToggle,
	onNavigate,
	onClose,
}: {
	/** Who is signed in: the account button shows the name. */
	user: AccountUser
	feedNew: number
	editionDue: boolean
	topics: TopicsNav
	savedSearches: SavedSearchItem[]
	/** A rail of icons (desktop only). */
	collapsed?: boolean
	/** Shows the collapse toggle where the drawer has its close button. */
	onToggle?: () => void
	onNavigate?: () => void
	/** Renders a close button next to the brand (drawer only). */
	onClose?: () => void
}) {
	const { t } = useTranslation()
	const headingId = useId()
	const toggleLabel = collapsed ? t("nav.expand") : t("nav.collapse")
	return (
		<>
			{/* 40px tall, 16px from the top (the aside's padding): each page's header row matches it
			    (md:pt-4, and 40px tall), so both columns line up. */}
			<div
				className={cn(
					"mb-6 flex min-h-10 items-center",
					collapsed ? "justify-center" : "justify-between",
				)}
			>
				{collapsed ? null : (
					<NavLink to="/home" onClick={onNavigate} className="flex items-center px-2">
						<BrandLogoSmall className="h-6 w-auto" markClassName="text-accent" />
					</NavLink>
				)}
				<div className="flex items-center">
					{onToggle ? (
						<button
							type="button"
							onClick={onToggle}
							aria-label={toggleLabel}
							aria-expanded={!collapsed}
							{...tooltip(toggleLabel, undefined, "right")}
							className="rounded-md p-2 text-muted-fg hover:bg-fg/10 hover:text-fg"
						>
							{collapsed ? (
								<PanelLeftOpen className="size-5" aria-hidden />
							) : (
								<PanelLeftClose className="size-5" aria-hidden />
							)}
						</button>
					) : null}
					{onClose ? (
						<button
							type="button"
							onClick={onClose}
							aria-label={t("actions.close")}
							className="rounded-md p-2 text-muted-fg hover:bg-muted"
						>
							<X className="size-5" aria-hidden />
						</button>
					) : null}
				</div>
			</div>
			<nav className="flex flex-1 flex-col gap-1">
				{items
					.filter(({ to }) => to !== "/topics" || topics)
					.map(({ to, key, icon: Icon }) => {
						// Dots, not counts: busy blogs would make a number meaningless, and why an edition is due
						// is said on its page.
						const dot =
							to === "/feed" && feedNew > 0
								? { testId: "feed-nav-dot", label: t("nav.feedNew") }
								: to === "/editions" && editionDue
									? { testId: "editions-nav-dot", label: t("nav.editionDue") }
									: to === "/topics" && topics?.unseen
										? { testId: "topics-nav-dot", label: t("nav.topicsReady") }
										: null
						const railLabel = dot ? `${t(key)}, ${dot.label}` : t(key)
						return (
							<NavLink
								key={to}
								to={to}
								// An edition's editor and preview are still Editions.
								end={to !== "/editions"}
								prefetch="render"
								onClick={onNavigate}
								className={linkClass(collapsed)}
								// A rail shows icons only: the name is still there for screen readers.
								{...(collapsed
									? { "aria-label": railLabel, ...tooltip(railLabel, undefined, "right") }
									: {})}
							>
								<NavIcon icon={Icon} />
								{collapsed ? null : <span data-nav-label>{t(key)}</span>}
								{dot ? (
									<span
										data-testid={dot.testId}
										role="img"
										aria-label={dot.label}
										className={cn(
											"size-2 rounded-full bg-accent",
											collapsed ? "absolute top-1 right-1.5" : "mr-1 ml-auto",
										)}
									/>
								) : null}
							</NavLink>
						)
					})}
				{/* A row is its name, and a rail has no room for names: there, one button lists them. */}
				{savedSearches.length === 0 ? null : collapsed ? (
					<SavedSearchesMenu savedSearches={savedSearches} />
				) : (
					<section data-testid="saved-searches" aria-labelledby={headingId} className="mt-4">
						<h2 id={headingId} className="px-2 pb-1 text-xs font-medium text-muted-fg">
							{t("savedSearches.heading")}
						</h2>
						<ul className="flex flex-col gap-1">
							{savedSearches.map((saved) => (
								<SavedSearchRow key={saved.id} saved={saved} onNavigate={onNavigate} />
							))}
						</ul>
					</section>
				)}
			</nav>
			<div className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
				{/* Below the divider: the keyboard is the way in, this is how people find it. */}
				<CommandPaletteButton onOpen={onNavigate} collapsed={collapsed} />
				<AccountMenu user={user} collapsed={collapsed} onNavigate={onNavigate} />
			</div>
		</>
	)
}

/**
 * The rail's saved searches: one button, current when the page shows one of them, and a menu of
 * their names. Rename and Delete stay with the rows of the full sidebar.
 */
function SavedSearchesMenu({ savedSearches }: { savedSearches: SavedSearchItem[] }) {
	const { t } = useTranslation()
	const location = useLocation()
	const onSearch = location.pathname === "/search"
	const query = onSearch ? (new URLSearchParams(location.search).get("q") ?? "").trim() : null
	const current = savedSearches.some((saved) => saved.query === query)
	const label = t("savedSearches.heading")
	return (
		<MoreMenu
			label={label}
			tooltipSide="right"
			side="right"
			icon={<NavIcon icon={Bookmark} />}
			className={cn(
				"!p-0 mx-auto mt-4 flex size-9 items-center justify-center rounded-lg",
				current ? "marked" : "text-fg hover:bg-fg/10",
			)}
		>
			<p className="px-2 py-1.5 text-xs font-medium text-muted-fg">{label}</p>
			{/* Up to 50 of them: the list scrolls, and long names end in an ellipsis. */}
			<div className="flex max-h-80 max-w-72 flex-col overflow-y-auto">
				{savedSearches.map((saved) => (
					<MenuNavLink
						key={saved.id}
						to={searchPath(saved.query)}
						// Escape on the search page goes back to where the search was opened from.
						state={onSearch ? location.state : { from: location.pathname + location.search }}
						current={saved.query === query}
						icon={<Bookmark className="size-4 shrink-0" aria-hidden />}
					>
						<span className="min-w-0 truncate">{saved.name}</span>
					</MenuNavLink>
				))}
			</div>
		</MoreMenu>
	)
}

/**
 * A saved search in the sidebar: a link to its query, current when the page shows that very query.
 * Rename and Delete are in its menu, which a right-click opens too.
 */
function SavedSearchRow({
	saved,
	onNavigate,
}: {
	saved: SavedSearchItem
	onNavigate?: () => void
}) {
	const { t } = useTranslation()
	const location = useLocation()
	const fetcher = useFetcher()
	const menuRef = useRef<MoreMenuHandle>(null)
	const [renaming, setRenaming] = useState(false)
	const closeDialog = useCallback(() => setRenaming(false), [])
	if (fetcher.formData?.get("intent") === "delete") return null
	const onSearch = location.pathname === "/search"
	const current =
		onSearch && (new URLSearchParams(location.search).get("q") ?? "").trim() === saved.query
	return (
		<li
			className={cn(
				"group/saved flex items-center rounded-lg text-sm",
				current ? "font-medium [&_[data-nav-label]]:marked-text" : "hover:bg-fg/10",
			)}
			onContextMenu={(e) => {
				if (!menuRef.current) return
				e.preventDefault()
				menuRef.current.openAt(e.clientX, e.clientY)
			}}
		>
			<Link
				to={searchPath(saved.query)}
				// Escape on the search page goes back to where the search was opened from.
				state={onSearch ? location.state : { from: location.pathname + location.search }}
				onClick={onNavigate}
				aria-current={current ? "page" : undefined}
				className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 md:py-1.5"
			>
				<NavIcon icon={Bookmark} />
				<span data-nav-label className="truncate">
					{saved.name}
				</span>
				{saved.endedTopics?.length ? (
					<span
						role="img"
						data-testid="saved-search-ended"
						aria-label={t("savedSearches.topicEnded", { name: saved.endedTopics[0] })}
						{...tooltip(t("savedSearches.topicEnded", { name: saved.endedTopics[0] }))}
						className="ml-auto shrink-0 text-muted-fg"
					>
						<CircleAlert className="size-3.5" aria-hidden />
					</span>
				) : null}
			</Link>
			<MoreMenu
				ref={menuRef}
				label={t("savedSearches.more", { name: saved.name })}
				// Phones have no hover: the button is always there.
				className="mr-1 shrink-0 text-inherit opacity-100 hover:bg-fg/10 focus-visible:opacity-100 aria-expanded:opacity-100 md:opacity-0 md:group-hover/saved:opacity-100"
			>
				<SavedSearchMenuItems saved={saved} fetcher={fetcher} onRename={() => setRenaming(true)} />
			</MoreMenu>
			{renaming ? <SavedSearchDialog saved={saved} onClose={closeDialog} /> : null}
		</li>
	)
}

export function AppShell({
	children,
	notice,
	user,
	feedNew,
	editionDue,
	topics = null,
	savedSearches,
}: {
	children: React.ReactNode
	notice?: React.ReactNode
	/** Who is signed in: the account button shows the name. */
	user: AccountUser
	/** New posts in the user's feeds, from the layout loader. */
	feedNew: number
	/** A new edition is due (`editionNudge`), from the layout loader. */
	editionDue: boolean
	/** Topics, for accounts that have them, from the layout loader. */
	topics?: TopicsNav
	/** By name, from the layout loader. */
	savedSearches: SavedSearchItem[]
}) {
	const { t } = useTranslation()
	const tk = useKeyTranslation()
	const sidebar = useSidebar()
	const collapsed = sidebar.collapsed
	// While dragging the edge: the width under the pointer, remembered only on release.
	const [dragWidth, setDragWidth] = useState<number | null>(null)
	const location = useLocation()
	const scrollRef = useRef<HTMLDivElement>(null)
	useContainerScrollRestoration(scrollRef, `${location.pathname}${location.search}`)

	const routeKey = `${location.pathname}?${location.search}`
	const drawer = useMobileDrawer()
	const { open, setOpen, menuButtonRef } = drawer

	// Phone top bar: the page's title, an in-place search field and the save button (route `handle`).
	const bar = usePageBar()
	const navigate = useNavigate()
	const typed = new URLSearchParams(location.search).get("q") ?? ""
	const q = typed.trim()
	const [searchFor, setSearchFor] = useState<string | null>(null)
	const field = bar?.search && "action" in bar.search ? bar.search : null
	const searchOpen = Boolean(field) && (field?.always || q !== "" || searchFor === routeKey)
	// The search page is left for where the user came from.
	const leaveTo = field?.always ? searchOrigin(location.state) : null
	const closeSearch = () => {
		setSearchFor(null)
		if (leaveTo) void navigate(leaveTo)
		else if (q && field) void navigate(field.clearTo)
	}

	// Phones: the bar (and a view's pinned filter row) slides away while the list scrolls down, and
	// comes back on the way up. The bar floats over the scroll box, which reserves its height.
	const headerRef = useRef<HTMLElement>(null)
	const [barHeight, setBarHeight] = useState<number | null>(null)
	useEffect(() => {
		const el = headerRef.current
		if (!el) return
		const observer = new ResizeObserver(() => setBarHeight(el.offsetHeight))
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	const [barHiddenFor, setBarHiddenFor] = useState<string | null>(null)
	const barHidden = barHiddenFor === routeKey && !open && !searchOpen
	useEffect(() => {
		const el = scrollRef.current
		if (!el) return
		let last = el.scrollTop
		// Only the user's own scrolling hides it: not the restored position when coming back to a list.
		let touched = false
		const onInput = () => {
			touched = true
		}
		const onScroll = () => {
			const y = el.scrollTop
			// Near the top (bar plus a filter row): always shown. Past the end (bounce): ignore.
			if (y < 140) {
				setBarHiddenFor(null)
				last = y
				return
			}
			if (y > el.scrollHeight - el.clientHeight - 2) return
			if (Math.abs(y - last) < 8) return
			setBarHiddenFor(y > last && touched ? routeKey : null)
			last = y
		}
		el.addEventListener("scroll", onScroll, { passive: true })
		el.addEventListener("touchstart", onInput, { passive: true })
		el.addEventListener("wheel", onInput, { passive: true })
		return () => {
			el.removeEventListener("scroll", onScroll)
			el.removeEventListener("touchstart", onInput)
			el.removeEventListener("wheel", onInput)
		}
	}, [routeKey])

	return (
		<div className="flex h-dvh md:h-auto md:min-h-screen">
			<aside
				style={collapsed ? undefined : { width: dragWidth ?? sidebar.width }}
				className={cn(
					"hidden shrink-0 flex-col border-r border-border bg-muted/40 p-4 md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto",
					dragWidth === null && "transition-[width] duration-150",
					collapsed && "w-16 px-2",
				)}
			>
				<SidebarContent
					user={user}
					feedNew={feedNew}
					editionDue={editionDue}
					topics={topics}
					savedSearches={savedSearches}
					collapsed={collapsed}
					onToggle={() => setSidebar({ collapsed: !collapsed })}
				/>
				{collapsed ? null : (
					<SidebarResizer
						width={dragWidth ?? sidebar.width}
						onResize={setDragWidth}
						onCommit={(width) => setSidebar({ width })}
					/>
				)}
			</aside>

			<div
				// Behind the open drawer (a modal), nothing takes the focus or the pointer.
				inert={open}
				data-bar-hidden={barHidden || undefined}
				style={barHeight ? ({ "--bar-h": `${barHeight}px` } as React.CSSProperties) : undefined}
				className="group/shell relative flex min-w-0 flex-1 flex-col"
			>
				<header
					ref={headerRef}
					className={cn(
						"safe-top absolute inset-x-0 top-0 z-20 flex min-h-13 items-center gap-1 border-b border-border bg-bg/90 px-2 py-1.5 backdrop-blur transition-transform duration-200 md:hidden",
						barHidden && "-translate-y-full",
					)}
				>
					{field && searchOpen ? (
						<>
							{/* Where the menu button is on other pages. Not an ✕: the field has its own, to clear it. */}
							<button
								type="button"
								onClick={closeSearch}
								aria-label={t("actions.back")}
								className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
							>
								<ArrowLeft className="size-5" aria-hidden />
							</button>
							<SearchField
								// A chip or a link changed the query: the field shows the new one.
								key={field.always ? typed : undefined}
								action={field.action}
								value={field.always ? typed : q}
								clearTo={field.clearTo}
								escapeTo={leaveTo ?? undefined}
								operators={field.always}
								onSearch={field.always ? countTopicSearch : undefined}
								placeholder={tk(field.placeholderKey)}
								label={tk(field.labelKey)}
								clearLabel={tk(field.clearKey)}
								autoFocus={!field.always || awaitsWords(typed)}
								className="min-w-0 flex-1"
								inputClassName="w-full focus:w-full sm:w-full sm:focus:w-full"
							/>
						</>
					) : (
						<>
							<button
								ref={menuButtonRef}
								type="button"
								onClick={() => setOpen(true)}
								aria-label={t("nav.menu")}
								aria-expanded={open}
								aria-controls="mobile-drawer"
								className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
							>
								<Menu className="size-5" aria-hidden />
							</button>
							<h1 className="min-w-0 flex-1 truncate font-display text-lg font-medium">
								{bar ? (bar.title ?? tk(bar.titleKey)) : t("appName")}
							</h1>
							{bar?.search && "to" in bar.search ? (
								<Link
									to={bar.search.to}
									state={{ from: location.pathname + location.search }}
									aria-label={tk(bar.search.labelKey)}
									className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
								>
									<Search className="size-5" aria-hidden />
								</Link>
							) : field ? (
								<button
									type="button"
									onClick={() => setSearchFor(routeKey)}
									aria-label={tk(field.labelKey)}
									className="rounded-md p-2.5 text-muted-fg hover:bg-muted hover:text-fg"
								>
									<Search className="size-5" aria-hidden />
								</button>
							) : null}
							{bar?.select ? <SelectButton /> : null}
							{bar?.layoutToggle ? <LayoutToggle /> : null}
							{bar?.save ? <SaveLinkDialog /> : null}
						</>
					)}
				</header>
				{/* Phones: this box scrolls under the floating bar, so the bar stays put when the list bounces. */}
				<div
					ref={scrollRef}
					className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pt-(--bar-h,3.5rem) md:min-h-full md:overflow-visible md:pt-0"
				>
					{notice}
					<PullToRefresh scrollRef={scrollRef}>{children}</PullToRefresh>
				</div>
			</div>

			<MobileDrawer drawer={drawer}>
				<SidebarContent
					user={user}
					feedNew={feedNew}
					editionDue={editionDue}
					topics={topics}
					savedSearches={savedSearches}
					onNavigate={() => setOpen(false)}
					onClose={() => setOpen(false)}
				/>
			</MobileDrawer>
		</div>
	)
}

const scrollPositions = new Map<string, number>()

/** The phone content box is the scroller, so React Router's window scroll restoration misses it. */
function useContainerScrollRestoration(ref: React.RefObject<HTMLDivElement | null>, key: string) {
	useEffect(() => {
		const el = ref.current
		if (!el) return
		el.scrollTop = scrollPositions.get(key) ?? 0
		const onScroll = () => scrollPositions.set(key, el.scrollTop)
		el.addEventListener("scroll", onScroll, { passive: true })
		return () => el.removeEventListener("scroll", onScroll)
	}, [ref, key])
}
