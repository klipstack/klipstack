import { Command } from "cmdk"
import { Check, LoaderCircle, Plus, Search, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { cn } from "~/lib/utils"
import type { WebResult } from "~/lib/web-result"
import type { PickerDocuments, SuggestedDocument } from "~/services/editions.server"
import { errorText } from "./edition-item-card"
import { Button } from "./ui/button"

interface Found {
	id: string
	title: string
	siteName: string | null
}

/**
 * Where an edition's articles come from: a dialog with the shortlist and what was read lately and,
 * as you type, the whole library. Adding one copies it to the end of the edition; the dialog stays
 * open for the next.
 */
export function EditionPicker({
	editionId,
	picker,
	added,
	className,
}: {
	editionId: string
	picker: PickerDocuments
	/** Articles in the edition already. */
	added: ReadonlySet<string>
	className?: string
}) {
	const { t } = useTranslation("editions")
	const [open, setOpen] = useState(false)
	return (
		<>
			<Button
				variant="secondary"
				size="sm"
				aria-haspopup="dialog"
				onClick={() => setOpen(true)}
				className={className}
			>
				<Plus className="size-4" aria-hidden />
				{t("picker.open")}
			</Button>
			{open ? (
				<PickerDialog
					editionId={editionId}
					picker={picker}
					added={added}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	)
}

/** Any article of the library, by title, site, author or address: `/api/search`, as you type. */
function useLibrarySearch(q: string): Found[] | null {
	const [results, setResults] = useState<{ q: string; items: Found[] } | null>(null)
	useEffect(() => {
		if (!q) return
		const controller = new AbortController()
		const timer = window.setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
					signal: controller.signal,
				})
				if (res.ok) setResults({ q, items: ((await res.json()) as { items: Found[] }).items })
			} catch {
				// Aborted by the next keystroke, or offline: the last results stay.
			}
		}, 200)
		return () => {
			window.clearTimeout(timer)
			controller.abort()
		}
	}, [q])
	// A cleared field shows nothing, whatever the last answer was.
	return q ? (results?.items ?? null) : null
}

function PickerDialog({
	editionId,
	picker,
	added,
	onClose,
}: {
	editionId: string
	picker: PickerDocuments
	added: ReadonlySet<string>
	onClose: () => void
}) {
	const { t } = useTranslation("editions")
	const { t: tc } = useTranslation()
	const [query, setQuery] = useState("")
	const q = query.trim()
	const found = useLibrarySearch(q)
	const { shortlist, lately } = picker
	// A found article that is also in the shortlist or read lately says so, and comes first; the
	// rest of the library follows, quieter.
	const byId = new Map([...lately, ...shortlist].map((doc) => [doc.id, doc]))
	const marked = new Set(shortlist.map((doc) => doc.id))
	const badges = (doc: SuggestedDocument | undefined, finished = true) =>
		doc
			? [
					marked.has(doc.id) ? t("shortlist.badge") : null,
					finished && doc.finished ? t("suggested.finished") : null,
					doc.starred ? t("suggested.starred") : null,
					doc.highlights > 0 ? t("suggested.highlights", { count: doc.highlights }) : null,
					doc.note ? t("suggested.note") : null,
				]
			: []
	const ranked = found
		? [...found.filter((doc) => byId.has(doc.id)), ...found.filter((doc) => !byId.has(doc.id))]
		: null
	const missing = shortlist.filter((doc) => !doc.added && !added.has(doc.id)).length
	const row = (doc: SuggestedDocument, finished = true) => (
		<PickRow
			key={doc.id}
			editionId={editionId}
			doc={{ id: doc.id, title: doc.title?.trim() || doc.url, siteName: doc.siteName }}
			added={doc.added || added.has(doc.id)}
			badges={badges(doc, finished)}
		/>
	)
	return (
		<Command.Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose()
			}}
			label={t("picker.title")}
			shouldFilter={false}
			loop
			// Phones: a full-screen view, no backdrop. Larger screens: a floating panel over a dimmed page.
			className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-card pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:inset-x-0 md:top-[12vh] md:bottom-auto md:mx-auto md:block md:w-[min(640px,92vw)] md:rounded-2xl md:border md:border-border md:p-0 md:shadow-2xl"
			overlayClassName="fixed inset-0 z-40 md:bg-black/40"
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
				<Search className="size-4 text-muted-fg" aria-hidden />
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder={t("picker.placeholder")}
					className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-fg sm:text-sm"
				/>
				<button
					type="button"
					onClick={onClose}
					aria-label={tc("actions.close")}
					className="-mr-1.5 rounded-md p-2 text-muted-fg hover:bg-muted hover:text-fg"
				>
					<X className="size-5 md:size-4" aria-hidden />
				</button>
			</div>
			<Command.List
				data-testid={q ? "edition-search-results" : "edition-suggested"}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[60vh]"
			>
				{q ? (
					ranked === null ? null : ranked.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-muted-fg">{t("picker.empty")}</p>
					) : (
						<Group heading={t("picker.library")}>
							{ranked.map((doc) => (
								<PickRow
									key={doc.id}
									editionId={editionId}
									doc={doc}
									added={added.has(doc.id)}
									badges={badges(byId.get(doc.id))}
									quiet={!byId.has(doc.id)}
								/>
							))}
						</Group>
					)
				) : shortlist.length === 0 && lately.length === 0 ? (
					<p className="px-3 py-6 text-center text-sm text-muted-fg">{t("suggested.empty")}</p>
				) : (
					<>
						{shortlist.length > 0 ? (
							<Group
								heading={t("shortlist.heading")}
								detail={t("shortlist.detail")}
								testId="edition-shortlist"
							>
								{missing > 1 ? <AddShortlistRow editionId={editionId} count={missing} /> : null}
								{shortlist.map((doc) => row(doc))}
							</Group>
						) : null}
						{lately.length > 0 ? (
							<Group
								heading={t("lately.heading")}
								detail={t("lately.detail")}
								testId="edition-lately"
							>
								{/* All finished: no badge says so. */}
								{lately.map((doc) => row(doc, false))}
							</Group>
						) : null}
					</>
				)}
			</Command.List>
		</Command.Dialog>
	)
}

function Group({
	heading,
	detail,
	testId,
	children,
}: {
	heading: string
	detail?: string
	testId?: string
	children: React.ReactNode
}) {
	return (
		<Command.Group
			data-testid={testId}
			heading={
				<>
					{heading}
					{detail ? <span className="block font-normal">{detail}</span> : null}
				</>
			}
			className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-fg"
		>
			{children}
		</Command.Group>
	)
}

/**
 * An article to add: its title and site, what happened to it, and whether it is in. Enter or a
 * click adds it.
 */
function PickRow({
	editionId,
	doc,
	added,
	badges,
	quiet = false,
}: {
	editionId: string
	doc: Found
	added: boolean
	badges: Array<string | null>
	/** Found in the library, neither in the shortlist nor read lately: shown, less loudly. */
	quiet?: boolean
}) {
	const { t } = useTranslation("editions")
	const fetcher = useFetcher<WebResult>()
	const adding = fetcher.state !== "idle"
	const error = !adding && fetcher.data && !fetcher.data.ok ? fetcher.data.error : null
	const shown = badges.filter((badge): badge is string => Boolean(badge))
	return (
		<Command.Item
			value={doc.id}
			onSelect={() => {
				if (added || adding) return
				void fetcher.submit(
					{ intent: "add-item", documentId: doc.id },
					{ method: "post", action: `/editions/${editionId}`, encType: "application/json" },
				)
			}}
			aria-disabled={added || undefined}
			className={cn(
				"flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 aria-selected:bg-fg/10",
				quiet && "text-muted-fg",
			)}
		>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{doc.title}</p>
				{doc.siteName || shown.length > 0 ? (
					<p className="mt-0.5 truncate text-xs opacity-70">
						{[doc.siteName, ...shown].filter(Boolean).join(" · ")}
					</p>
				) : null}
				{error ? (
					<p role="alert" className="mt-1 text-xs text-danger">
						{errorText(t, error)}
					</p>
				) : null}
			</div>
			<span
				className={cn(
					"inline-flex h-6 shrink-0 items-center gap-1 text-xs",
					added ? "opacity-70" : "font-medium",
				)}
			>
				{added ? (
					<>
						<Check className="size-4" aria-hidden />
						{t("suggested.added")}
					</>
				) : adding ? (
					<LoaderCircle className="size-4 animate-spin" aria-label={t("picker.adding")} />
				) : (
					<>
						<Plus className="size-4" aria-hidden />
						{t("suggested.add")}
					</>
				)}
			</span>
		</Command.Item>
	)
}

/** "Add all", first in the shortlist: a row, so the keyboard reaches it as it reaches the others. */
function AddShortlistRow({ editionId, count }: { editionId: string; count: number }) {
	const { t } = useTranslation("editions")
	const fetcher = useFetcher<WebResult>()
	const adding = fetcher.state !== "idle"
	return (
		<Command.Item
			value="add-shortlist"
			onSelect={() => {
				if (adding) return
				void fetcher.submit(
					{ intent: "add-shortlist" },
					{ method: "post", action: `/editions/${editionId}`, encType: "application/json" },
				)
			}}
			className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium aria-selected:bg-fg/10"
		>
			{adding ? (
				<LoaderCircle className="size-4 animate-spin" aria-hidden />
			) : (
				<Plus className="size-4" aria-hidden />
			)}
			{t("shortlist.addAll", { count })}
		</Command.Item>
	)
}

/** Adds every article of the shortlist the edition does not have yet. */
export function AddShortlist({
	editionId,
	count,
	className,
}: {
	editionId: string
	count: number
	className?: string
}) {
	const { t } = useTranslation("editions")
	const fetcher = useFetcher<WebResult>()
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			disabled={fetcher.state !== "idle"}
			onClick={() =>
				void fetcher.submit(
					{ intent: "add-shortlist" },
					{ method: "post", action: `/editions/${editionId}`, encType: "application/json" },
				)
			}
			className={className}
		>
			{fetcher.state !== "idle" ? (
				<LoaderCircle className="size-4 animate-spin" aria-hidden />
			) : (
				<Plus className="size-4" aria-hidden />
			)}
			{t("shortlist.addAll", { count })}
		</Button>
	)
}
