import {
	ArrowLeft,
	Bookmark,
	CircleAlert,
	Compass,
	House,
	type Inbox,
	LibraryBig,
	Menu,
	Newspaper,
	NotebookPen,
	PanelLeftClose,
	PanelLeftOpen,
	Rss,
	Search,
	Shapes,
	Tag,
	X,
} from "lucide-react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, NavLink, useFetcher, useLocation, useNavigate } from "react-router"
import { useKeyTranslation } from "~/lib/i18n-keys"
import { isLibraryPath } from "~/lib/library-views"
import { usePageBar } from "~/lib/page-bar"
import { awaitsWords, searchOrigin, searchPath } from "~/lib/search-page"
import { setSidebar, useSidebar } from "~/lib/sidebar"
import { countTopicSearch } from "~/lib/topic-use"
import { cn } from "~/lib/utils"
import type { SidebarNewsItem } from "~/services/news.server"
import { type AccountUser, AccountMenu } from "./account-menu"
import { BrandLogoSmall } from "./brand-mark"
import { CommandPaletteButton } from "./command-palette"
import { GettingStarted, type GettingStartedNav } from "./getting-started"
import { LayoutToggle } from "./layout-toggle"
import { MobileDrawer, useMobileDrawer } from "./mobile-drawer"
import { MenuNavLink, MoreMenu, type MoreMenuHandle } from "./more-menu"
import { NewsStack } from "./news-stack"
import { PullToRefresh } from "./pull-to-refresh"
import { SaveLinkButton, SaveLinkDialog } from "./save-link-dialog"
import {
	SavedSearchDialog,
	type SavedSearchItem,
	SavedSearchMenuItems,
} from "./saved-search-dialog"
import { SearchField } from "./search-field"
import { SelectButton } from "./select-button"
import { SidebarResizer } from "./sidebar-resizer"
import { SupportButton, SupportPanel } from "./support-panel"
import { tooltip } from "./tooltip-host"

const items = [
	{ to: "/home", key: "nav.home", icon: House },
	// One entry for the inbox, archive, starred and trash: the library page switches between them.
	{ to: "/library", key: "nav.library", icon: LibraryBig },
	{ to: "/feed", key: "nav.feed", icon: Rss },
	{ to: "/notebook", key: "nav.notebook", icon: NotebookPen },
	{ to: "/editions", key: "nav.editions", icon: Newspaper },
	// One link, not the tags themselves: a library can have hundreds. The command menu finds one.
	{ to: "/tags", key: "nav.tags", icon: Tag },
	{ to: "/topics", key: "nav.topics", icon: Shapes },
	// Texts to add with one click: the starter shelves, for everyone, not only an empty library.
	{ to: "/texts", key: "nav.discover", icon: Compass },
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
					: "font-medium [&_[data-nav-ink]]:marked-item"
				: collapsed
					? "hover:ink-hover"
					: "hover:[&_[data-nav-ink]]:ink-hover-item",
		)

/** Icon centered in a slot as wide as the brand mark, so nav labels align with the app name. */
export function NavIcon({ icon: Icon }: { icon: typeof Inbox }) {
	return (
		<span className="flex w-6 shrink-0 justify-center">
			<Icon className="size-4" aria-hidden />
		</span>
	)
}

/**
 * A sidebar item's icon and name: what its stroke of ink covers, grey when pointed at (`linkClass`),
 * yellow when it is where the reader is.
 */
export function NavItemInk({
	icon,
	truncate,
	children,
}: {
	icon: typeof Inbox
	truncate?: boolean
	children: React.ReactNode
}) {
	return (
		<span data-nav-ink className="flex min-w-0 items-center gap-2">
			<NavIcon icon={icon} />
			<span className={truncate ? "truncate" : undefined}>{children}</span>
		</span>
	)
}

/**
 * New posts in the feeds, as a mailbox says it: its little flag raised. In the place of the other
 * items' dots, and as small.
 */
function MailboxFlag({
	testId,
	label,
	className,
}: {
	testId: string
	label: string
	className?: string
}) {
	return (
		<svg
			data-testid={testId}
			role="img"
			aria-label={label}
			viewBox="0 0 10 14"
			className={cn("h-3.5 w-2.5 shrink-0 text-accent", className)}
		>
			<path d="M2 1.5v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<path d="M2.6 1.2h6.2l-1.6 2.1 1.6 2.1H2.6z" fill="currentColor" />
		</svg>
	)
}

/** Navigation, theme switch, account: shared by the desktop sidebar and the mobile drawer. */
function SidebarContent({
	user,
	feeds,
	feedNew,
	editions,
	editionDue,
	topics,
	gettingStarted,
	news,
	savedSearches,
	support,
	collapsed = false,
	onToggle,
	onNavigate,
	onClose,
}: {
	/** Who is signed in: the account button shows the name. */
	user: AccountUser
	feeds: boolean
	feedNew: number
	editions: boolean
	editionDue: boolean
	topics: TopicsNav
	gettingStarted: GettingStartedNav
	news: SidebarNewsItem[]
	savedSearches: SavedSearchItem[]
	/** Contact support shows. */
	support: boolean
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
	const library = isLibraryPath(useLocation().pathname)
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
							className="rounded-md p-2 text-muted-fg hover:bg-hover"
						>
							<X className="size-5" aria-hidden />
						</button>
					) : null}
				</div>
			</div>
			<nav className="flex flex-1 flex-col gap-1">
				{items
					.filter(
						({ to }) =>
							(to !== "/topics" || topics) &&
							(to !== "/editions" || editions) &&
							(to !== "/feed" || feeds),
					)
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
						const content = (
							<>
								{collapsed ? (
									<NavIcon icon={Icon} />
								) : (
									<NavItemInk icon={Icon}>{t(key)}</NavItemInk>
								)}
								{dot && to === "/feed" ? (
									<MailboxFlag
										testId={dot.testId}
										label={dot.label}
										className={collapsed ? "absolute top-0.5 right-1" : "mr-1 ml-auto"}
									/>
								) : dot ? (
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
							</>
						)
						const shared = {
							to,
							prefetch: "render" as const,
							onClick: onNavigate,
							// A rail shows icons only: the name is still there for screen readers.
							...(collapsed
								? { "aria-label": railLabel, ...tooltip(railLabel, undefined, "right") }
								: {}),
						}
						// The archive, starred and the trash are tabs of the library: its entry stays marked there.
						return to === "/library" ? (
							<Link
								key={to}
								{...shared}
								aria-current={library ? "page" : undefined}
								className={linkClass(collapsed)({ isActive: library })}
							>
								{content}
							</Link>
						) : (
							<NavLink
								key={to}
								{...shared}
								// An edition's editor and preview are still Editions.
								end={to !== "/editions"}
								className={linkClass(collapsed)}
							>
								{content}
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
			{/* Below the list, not in it: steps to do, not places to go. */}
			<GettingStarted
				card={gettingStarted}
				collapsed={collapsed}
				onExpand={onToggle}
				onNavigate={onNavigate}
			/>
			{/* At the foot, above the divider: news, not a place to go. */}
			<div className="mt-auto">
				<NewsStack news={news} collapsed={collapsed} onExpand={onToggle} onNavigate={onNavigate} />
			</div>
			<div className="flex flex-col gap-1 border-t border-border pt-3">
				{/* Below the divider: the keyboard is the way in, this is how people find it. */}
				<CommandPaletteButton onOpen={onNavigate} collapsed={collapsed} />
				{support ? <SupportButton onOpen={onNavigate} collapsed={collapsed} /> : null}
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
				current ? "marked" : "text-fg hover:ink-hover",
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
				current
					? "font-medium [&_[data-nav-ink]]:marked-item"
					: "hover:[&_[data-nav-ink]]:ink-hover-item",
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
				<NavItemInk icon={Bookmark} truncate>
					{saved.name}
				</NavItemInk>
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
	feeds,
	feedNew,
	editions,
	editionDue,
	topics = null,
	gettingStarted = null,
	news = [],
	savedSearches,
	support = null,
}: {
	children: React.ReactNode
	notice?: React.ReactNode
	/** Who is signed in: the account button shows the name. */
	user: AccountUser
	/** Feeds are turned on for the account, from the layout loader. */
	feeds: boolean
	/** New posts in the user's feeds, from the layout loader. */
	feedNew: number
	/** Editions are turned on for the account, from the layout loader. */
	editions: boolean
	/** A new edition is due (`editionNudge`), from the layout loader. */
	editionDue: boolean
	/** Topics, for accounts that have them, from the layout loader. */
	topics?: TopicsNav
	/** The Getting started card (`gettingStarted`), from the layout loader. */
	gettingStarted?: GettingStartedNav
	/** The sidebar's news (`newsForSidebar`), from the layout loader. */
	news?: SidebarNewsItem[]
	/** By name, from the layout loader. */
	savedSearches: SavedSearchItem[]
	/** The SuppyHQ account behind Contact support, from the layout loader. */
	support?: { tenant: string } | null
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
					feeds={feeds}
					feedNew={feedNew}
					editions={editions}
					editionDue={editionDue}
					topics={topics}
					gettingStarted={gettingStarted}
					news={news}
					savedSearches={savedSearches}
					support={Boolean(support)}
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
								className="rounded-md p-2.5 text-muted-fg hover:bg-hover hover:text-fg"
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
								className="rounded-md p-2.5 text-muted-fg hover:bg-hover hover:text-fg"
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
									className="rounded-md p-2.5 text-muted-fg hover:bg-hover hover:text-fg"
								>
									<Search className="size-5" aria-hidden />
								</Link>
							) : field ? (
								<button
									type="button"
									onClick={() => setSearchFor(routeKey)}
									aria-label={tk(field.labelKey)}
									className="rounded-md p-2.5 text-muted-fg hover:bg-hover hover:text-fg"
								>
									<Search className="size-5" aria-hidden />
								</button>
							) : null}
							{bar?.select ? <SelectButton /> : null}
							{bar?.layoutToggle ? <LayoutToggle /> : null}
							{bar?.save ? <SaveLinkButton /> : null}
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

			{/* The one Save link dialog: the page's buttons, the command menu and `?save` open it. */}
			<SaveLinkDialog />
			{support ? (
				<SupportPanel tenant={support.tenant} email={user.email} name={user.name} />
			) : null}

			<MobileDrawer drawer={drawer}>
				<SidebarContent
					user={user}
					feeds={feeds}
					feedNew={feedNew}
					editions={editions}
					editionDue={editionDue}
					topics={topics}
					gettingStarted={gettingStarted}
					news={news}
					savedSearches={savedSearches}
					support={Boolean(support)}
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
