import { Command, defaultFilter } from "cmdk"
import {
	Archive,
	Bookmark,
	Check,
	Clipboard,
	FileText,
	Highlighter,
	House,
	LibraryBig,
	LogOut,
	Monitor,
	Moon,
	Newspaper,
	NotebookPen,
	Plus,
	Rss,
	Search,
	Settings,
	Star,
	Tag,
	Sun,
	Trash2,
	X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useNavigate, useRouteLoaderData, useSubmit } from "react-router"
import { useTagList } from "~/hooks/use-tag-list"
import {
	type CommandGroup,
	contextCommands,
	openPalette,
	type PaletteCommand,
	setPaletteOpen,
	usePaletteHint,
	usePaletteOpen,
} from "~/lib/commands"
import { searchPath, tagSearchPath } from "~/lib/search-page"
import { SETTINGS_HOME } from "~/lib/settings-origin"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { loader as rootLoader } from "~/root"
import type { loader as layoutLoader } from "~/routes/app-layout"
import { Kbd } from "./more-menu"
import { tooltip } from "./tooltip-host"

interface SearchItem {
	id: string
	title: string
	siteName: string | null
	status: string
	archived: boolean
}

interface SearchAnswer {
	items: SearchItem[]
	highlights: Array<{ id: string; documentId: string; title: string; quote: string }>
	notes: Array<{ documentId: string; title: string; note: string }>
}

const URL_PATTERN = /^https?:\/\/\S+$/i

/** Rows the server found: they show whatever the menu's own matching thinks of them. */
const FOUND = ["doc-", "hl-", "note-"]

/**
 * The server already matched the articles, highlights and notes, so they always show, but below any command that
 * matches what was typed: "trash" + Enter goes to the trash, not to an article named after it.
 * Last comes the way to the search page: with nothing else found, Enter searches.
 */
const filter: NonNullable<React.ComponentProps<typeof Command>["filter"]> = (
	value,
	search,
	keywords,
) => {
	const score = defaultFilter(value, search, keywords)
	if (value === "search-all") return 0.0005
	return FOUND.some((prefix) => value.startsWith(prefix)) ? Math.max(score, 0.001) : score
}

/**
 * ⌘K / Ctrl+K palette: search the library, save a link, go anywhere, run app actions, and act on
 * whatever the page registered (the open article, the card under the list cursor).
 */
export function CommandPalette() {
	const { t } = useTranslation()
	const { t: tl } = useTranslation("library")
	const open = usePaletteOpen()
	const [query, setQuery] = useState("")
	const navigate = useNavigate()
	const submit = useSubmit()
	const search = useFetcher<SearchAnswer>()
	// Read when the menu mounts and again at every opening. The menu matches them itself as commands
	// are matched, so they need no request per key, and "wa" finds "Work Advice".
	const tags = useTagList(open)
	// The row under the cursor. The menu keeps it while it is there, so a tag that arrives after the
	// first keys would sit above a selection already made, and Enter would search for articles
	// instead. When new tags come under a typed query, the selection starts over: the menu then
	// takes its best row again.
	const [selected, setSelected] = useState("")
	const [listed, setListed] = useState(tags)
	const prefs = useFetcher()
	const root = useRouteLoaderData<typeof rootLoader>("root")
	// From the layout, like the sidebar's section: fresh after every change, and no request of its
	// own. The reader is outside the layout, so its menu has none.
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
				e.preventDefault()
				setPaletteOpen((o) => !o)
			}
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [])

	// Every opening starts from an empty query, and from the first row.
	if (!open && query !== "") setQuery("")
	if (!open && selected !== "") setSelected("")
	if (tags !== listed) {
		setListed(tags)
		const added = tags.some((tag) => !listed.some((known) => known.id === tag.id))
		if (added && query.trim() && !URL_PATTERN.test(query.trim())) setSelected("")
	}

	// The fetcher changes on every render; its `load` does not, so only query/open retrigger this.
	const loadSearch = search.load
	useEffect(() => {
		if (!open) return
		const q = query.trim()
		if (q.length < 2 || URL_PATTERN.test(q)) return
		const timer = window.setTimeout(
			() => loadSearch(`/api/search?annotations=1&q=${encodeURIComponent(q)}`),
			180,
		)
		return () => window.clearTimeout(timer)
	}, [query, open, loadSearch])

	// Selecting any item closes the palette first (see Item).
	const close = () => setPaletteOpen(false)
	const go = (to: string) => void navigate(to)
	const saveFromClipboard = async () => {
		const text = await navigator.clipboard?.readText().catch(() => "")
		const url = text?.trim() ?? ""
		if (URL_PATTERN.test(url)) void navigate(`/add?url=${encodeURIComponent(url)}`)
		else showToast({ message: t("palette.clipboardEmpty") })
	}

	const trimmed = query.trim()
	const isUrl = URL_PATTERN.test(trimmed)
	const searching = trimmed.length >= 2 && !isUrl
	const results = searching ? (search.data?.items ?? []) : []
	const highlightResults = searching ? (search.data?.highlights ?? []) : []
	const noteResults = searching ? (search.data?.notes ?? []) : []
	// Only once something is typed: a library's tags are many, and nobody opened the menu for a list.
	const tagItems = trimmed && !isUrl ? tags : []
	const pendingTheme = prefs.formData?.get("theme")
	const theme = typeof pendingTheme === "string" ? pendingTheme : (root?.theme ?? "system")

	const navigation: PaletteCommand[] = [
		{ id: "go-home", label: t("nav.home"), icon: House, run: () => go("/home") },
		{ id: "go-inbox", label: t("nav.inbox"), icon: LibraryBig, run: () => go("/library") },
		{ id: "go-feed", label: t("nav.feed"), icon: Rss, run: () => go("/feed") },
		{ id: "go-archive", label: t("nav.archive"), icon: Archive, run: () => go("/archive") },
		{ id: "go-starred", label: t("nav.starred"), icon: Star, run: () => go("/starred") },
		{
			id: "go-notebook",
			label: t("nav.notebook"),
			icon: NotebookPen,
			// Highlights live in the Notebook too.
			keywords: [t("palette.notes"), t("palette.highlights")],
			run: () => go("/notebook"),
		},
		{ id: "go-editions", label: t("nav.editions"), icon: Newspaper, run: () => go("/editions") },
		{ id: "go-tags", label: t("nav.tags"), icon: Tag, run: () => go("/tags") },
		{ id: "go-trash", label: t("nav.trash"), icon: Trash2, run: () => go("/trash") },
		{ id: "go-settings", label: t("nav.settings"), icon: Settings, run: () => go(SETTINGS_HOME) },
		...(layout?.savedSearches ?? []).map((saved): PaletteCommand => ({
			id: `saved-${saved.id}`,
			label: saved.name,
			icon: Bookmark,
			keywords: [t("savedSearches.heading"), saved.query],
			run: () => go(searchPath(saved.query)),
		})),
	]
	const actions: PaletteCommand[] = [
		{ id: "save-link", label: tl("add.title"), icon: Plus, run: () => go("/add") },
		{
			id: "save-clipboard",
			label: t("palette.saveClipboard"),
			icon: Clipboard,
			keywords: ["paste"],
			run: () => void saveFromClipboard(),
		},
		...(
			[
				["system", Monitor],
				["light", Sun],
				["dark", Moon],
			] as const
		).map(([value, icon]): PaletteCommand => ({
			id: `theme-${value}`,
			label: t("palette.theme", { theme: t(`theme.${value}`) }),
			icon: theme === value ? Check : icon,
			keywords: ["theme", "appearance", "mode"],
			run: () => prefs.submit({ theme: value }, { method: "post", action: "/prefs" }),
		})),
		{
			id: "logout",
			label: t("nav.logout"),
			icon: LogOut,
			keywords: ["sign out"],
			run: () => void submit(null, { method: "post", action: "/logout" }),
		},
	]
	// Read on every render while open: the page's commands act on its current state.
	const context: CommandGroup[] = open ? contextCommands() : []

	return (
		<Command.Dialog
			open={open}
			onOpenChange={setPaletteOpen}
			value={selected}
			onValueChange={setSelected}
			label={t("palette.label")}
			shouldFilter={!isUrl}
			filter={filter}
			// Phones: a full-screen view, no backdrop. Larger screens: a floating panel over a dimmed page.
			className="fixed inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] z-50 flex flex-col overflow-hidden bg-card md:inset-x-0 md:top-[12vh] md:bottom-auto md:mx-auto md:block md:w-[min(640px,92vw)] md:rounded-2xl md:border md:border-border md:p-0 md:shadow-2xl"
			overlayClassName="fixed inset-0 z-40 md:bg-black/40"
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
				<Search className="size-4 text-muted-fg" aria-hidden />
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder={t("palette.placeholder")}
					className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-fg sm:text-sm"
				/>
				{/* Phones: a close icon, there is no backdrop to tap. Larger screens: the key that closes it. */}
				<button
					type="button"
					onClick={close}
					aria-label={t("actions.close")}
					className="-mr-1.5 rounded-md p-2 text-muted-fg hover:bg-muted hover:text-fg md:hidden"
				>
					<X className="size-5" aria-hidden />
				</button>
				<button
					type="button"
					onClick={close}
					className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-fg hover:bg-muted md:block"
				>
					esc
				</button>
			</div>
			<Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[60vh]">
				<Command.Empty className="px-3 py-6 text-center text-sm text-muted-fg">
					{t("palette.empty")}
				</Command.Empty>
				{isUrl ? (
					<Group heading={t("palette.actions")}>
						<Item
							command={{
								id: "save-url",
								label: `${tl("add.submit")}: ${trimmed}`,
								icon: Plus,
								run: () => go(`/add?url=${encodeURIComponent(trimmed)}`),
							}}
						/>
					</Group>
				) : (
					<>
						{context.map((group) => (
							<Group key={group.heading} heading={group.heading}>
								{group.commands.map((c) => (
									<Item key={c.id} command={c} />
								))}
							</Group>
						))}
						<Group heading={t("palette.navigate")}>
							{navigation.map((c) => (
								<Item key={c.id} command={c} />
							))}
						</Group>
						<Group heading={t("palette.actions")}>
							{actions.map((c) => (
								<Item key={c.id} command={c} />
							))}
						</Group>
						{tagItems.length > 0 ? (
							<Group heading={t("nav.tags")}>
								{tagItems.map((tag) => (
									<Item
										key={tag.id}
										command={{
											id: `tag-${tag.id}`,
											label: tag.name,
											detail: t("nav.tagCount", { count: tag.articles }),
											icon: Tag,
											run: () => go(tagSearchPath(tag.name)),
										}}
									/>
								))}
							</Group>
						) : null}
						{results.length > 0 ? (
							<Group heading={t("palette.results")}>
								{results.map((r) => (
									<Item
										key={r.id}
										command={{
											id: `doc-${r.id}`,
											label: r.title,
											detail: r.siteName,
											icon: FileText,
											run: () => go(`/read/${r.id}`),
										}}
									/>
								))}
							</Group>
						) : null}
						{highlightResults.length > 0 ? (
							<Group heading={t("palette.highlights")}>
								{highlightResults.map((h) => (
									<Item
										key={h.id}
										command={{
											id: `hl-${h.id}`,
											label: h.quote,
											detail: h.title,
											icon: Highlighter,
											run: () => go(`/read/${h.documentId}#h=${h.id}`),
										}}
									/>
								))}
							</Group>
						) : null}
						{noteResults.length > 0 ? (
							<Group heading={t("palette.notes")}>
								{noteResults.map((n) => (
									<Item
										key={n.documentId}
										command={{
											id: `note-${n.documentId}`,
											label: n.note,
											detail: n.title,
											icon: NotebookPen,
											run: () => go(`/read/${n.documentId}#note`),
										}}
									/>
								))}
							</Group>
						) : null}
						{searching ? (
							<Group heading={t("palette.search")}>
								{/* The menu opens what it found by its words; the search page reads them, and takes operators. */}
								<Item
									command={{
										id: "search-all",
										label: t("palette.searchFor", { q: trimmed }),
										icon: Search,
										run: () => go(searchPath(trimmed)),
									}}
								/>
							</Group>
						) : null}
					</>
				)}
			</Command.List>
		</Command.Dialog>
	)
}

/** Opens the palette; the way in on touch screens, where there is no ⌘K. */
export function CommandPaletteButton({
	onOpen,
	collapsed = false,
	className,
}: {
	/** The phone drawer closes itself. */
	onOpen?: () => void
	/** Icon only, as a rail. */
	collapsed?: boolean
	className?: string
}) {
	const { t } = useTranslation()
	const hint = usePaletteHint()
	const label = t("palette.search")
	return (
		<button
			type="button"
			onClick={() => {
				onOpen?.()
				openPalette()
			}}
			aria-haspopup="dialog"
			aria-label={label}
			{...tooltip(label, hint || undefined, "right")}
			className={cn(
				"flex items-center gap-2 rounded-lg text-sm text-muted-fg hover:bg-fg/10 hover:text-fg",
				collapsed ? "mx-auto size-9 justify-center" : "w-full px-2 py-2 md:py-1.5",
				className,
			)}
		>
			<span className="flex w-6 shrink-0 justify-center">
				<Search className="size-4" aria-hidden />
			</span>
			{collapsed ? null : (
				<>
					{label}
					{hint ? <Kbd className="ml-auto hidden md:inline">{hint}</Kbd> : null}
				</>
			)}
		</button>
	)
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
	return (
		<Command.Group
			heading={heading}
			className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-fg"
		>
			{children}
		</Command.Group>
	)
}

function Item({
	command: { id, label, detail, icon: Icon, keywords, shortcut, danger, run },
}: {
	command: PaletteCommand & { detail?: string | null }
}) {
	return (
		<Command.Item
			value={id}
			keywords={[label, ...(keywords ?? [])]}
			onSelect={() => {
				setPaletteOpen(false)
				run()
			}}
			className={cn(
				"flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm",
				danger
					? "text-danger aria-selected:bg-muted"
					: "aria-selected:bg-selected aria-selected:text-selected-fg",
			)}
		>
			<Icon className="size-4 shrink-0 text-muted-fg" aria-hidden />
			<span className="flex min-w-0 flex-1 items-center">
				<span className="truncate">{label}</span>
				{detail ? (
					<span className="ml-2 max-w-[40%] shrink-0 truncate text-xs text-muted-fg">{detail}</span>
				) : null}
			</span>
			{shortcut ? <Kbd className="pl-4">{shortcut}</Kbd> : null}
		</Command.Item>
	)
}
