import { highlightShareText } from "@klipstack/api-contract/highlight-share"
import { extractLinkIds } from "@klipstack/api-contract/note-links"
import { Copy, Image as ImageIcon, Link2, Share, Type, X } from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { copyRich, copyText } from "~/lib/copy-link"
import { creditLabel } from "~/lib/site-label"
import type { WebResult } from "~/lib/web-result"
import type { ShareState } from "~/services/highlight-shares.server"
import { ClippingPaper } from "./clipping"
import { NoteText } from "./note-text"
import { PostIt, tiltFor } from "./post-it"
import { ShareHighlightImage, useDrawnPictures } from "./share-highlight-image"
import { Button } from "./ui/button"

export interface ShareHighlight {
	id: string
	/** The quote as the reader sees it: its line breaks are its paragraphs. */
	exact: string
	note: string | null
	article: {
		title: string | null
		sourceUrl: string
		siteName: string | null
		author: string | null
	}
	/** False for a highlight still being saved: it has no id to share at an address yet. */
	canLink?: boolean
}

/**
 * Sharing a highlight: a preview of what goes out, the choice to leave the note out, and the ways to
 * share it: as text, and at a public link (`/h/<id>`), which shows what was shared until it is
 * updated or stopped. The note goes too unless the reader unticks it. Mount it to open it.
 */
export function ShareHighlightDialog({
	highlight: h,
	onClose,
}: {
	highlight: ShareHighlight
	onClose: () => void
}) {
	const { t } = useTranslation("reader")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const copyRef = useRef<HTMLButtonElement>(null)
	const note = h.note?.trim() ? h.note : null
	const [withNote, setWithNote] = useState(true)
	const shownNote = withNote ? note : null
	const link = usePublicLink(h.id, h.canLink !== false)
	// A link shared already: the box says what its page shows, until the reader changes it.
	const [linkedNote, setLinkedNote] = useState<string | null>(null)
	if (link.share && !link.share.removed && linkedNote !== link.share.publicId) {
		setLinkedNote(link.share.publicId)
		setWithNote(link.share.includeNote)
	}

	const linkUrls = useLinkUrls(note)

	// Which way out: a highlight with a link opens on it; else the way chosen last; else text.
	const tabs: ShareTab[] = h.canLink === false ? ["text"] : ["text", "link", "image"]
	const [tab, setTab] = useState<ShareTab>(() => (h.canLink === false ? "text" : lastTab()))
	const [chosen, setChosen] = useState(false)
	const live = link.share !== null && !link.share.removed
	if (live && !chosen && tab !== "link") setTab("link")
	const choose = (name: ShareTab) => {
		setChosen(true)
		setTab(name)
		rememberTab(name)
	}

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
	}, [])
	const pictures = useDrawnPictures()
	const contentRef = useRef<HTMLDivElement>(null)
	const contentHeight = useHeight(contentRef)
	// Copy takes the keyboard once it can copy: at once, or when the note's links are looked up.
	const ready = linkUrls !== null
	// Only as the dialog opens: choosing a tab with the keyboard leaves focus on the tabs.
	const focused = useRef(false)
	useEffect(() => {
		if (!ready || focused.current) return
		focused.current = true
		if (tab === "text") copyRef.current?.focus()
	}, [ready, tab])

	const copy = () => {
		const { markdown, html } = highlightShareText(
			{
				exact: h.exact,
				note,
				article: {
					title: h.article.title,
					url: h.article.sourceUrl,
					siteName: h.article.siteName,
					author: h.article.author,
				},
				linkUrls: linkUrls ?? {},
			},
			withNote,
		)
		copyRich(markdown, html, t("highlights.share.copied"), t("highlights.share.copyFailed"))
		dialogRef.current?.close()
	}

	return (
		<dialog
			ref={dialogRef}
			aria-label={t("highlights.share.title")}
			data-testid="share-highlight-dialog"
			className="m-auto max-h-[92dvh] w-[min(30rem,92vw)] overflow-y-auto rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				// The page behind listens for keys on the document: not from here.
				e.stopPropagation()
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			{/* Switching tabs changes the dialog's height: it eases there instead of jumping. */}
			<div
				style={{ height: contentHeight ?? "auto" }}
				className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
			>
				<div ref={contentRef} className="flex flex-col gap-4 p-6">
					<div className="flex items-start justify-between gap-4">
						<h2 className="text-lg font-semibold">{t("highlights.share.title")}</h2>
						<button
							type="button"
							onClick={() => dialogRef.current?.close()}
							className="rounded-md p-1.5 text-muted-fg hover:bg-hover"
							aria-label={t("highlights.share.close")}
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>

					{tabs.length > 1 ? (
						<div
							role="tablist"
							aria-label={t("highlights.share.tabs.label")}
							className="flex gap-1 rounded-lg bg-muted p-1"
						>
							{tabs.map((name) => (
								<button
									key={name}
									type="button"
									role="tab"
									id={`share-tab-${name}`}
									aria-selected={tab === name}
									aria-controls="share-panel"
									tabIndex={tab === name ? 0 : -1}
									onClick={() => choose(name)}
									onKeyDown={(e) => {
										// Arrows move between the tabs, as tab lists do.
										const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
										if (!step) return
										e.preventDefault()
										const next = tabs[(tabs.indexOf(name) + step + tabs.length) % tabs.length]!
										choose(next)
										document.getElementById(`share-tab-${next}`)?.focus()
									}}
									className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${tab === name ? "bg-card font-medium text-fg shadow-sm" : "text-muted-fg hover:text-fg"}`}
								>
									{TAB_ICONS[name]}
									{t(`highlights.share.tabs.${name}`)}
								</button>
							))}
						</div>
					) : null}

					{note ? (
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={withNote}
								onChange={(e) => setWithNote(e.target.checked)}
							/>
							{t("highlights.share.includeNote")}
						</label>
					) : null}

					<div
						id="share-panel"
						role="tabpanel"
						aria-labelledby={tabs.length > 1 ? `share-tab-${tab}` : undefined}
						aria-label={tabs.length > 1 ? undefined : t("highlights.share.tabs.text")}
						className="flex flex-col gap-4"
					>
						{tab === "image" ? (
							<ShareHighlightImage
								id={h.id}
								withNote={note !== null && withNote}
								pictures={pictures}
							/>
						) : (
							<SharePreview highlight={h} note={shownNote} compact={tab === "link"} />
						)}
						{tab === "link" ? (
							<PublicLink
								link={link}
								withNote={withNote}
								hasNote={note !== null}
								onLeave={() => dialogRef.current?.close()}
							/>
						) : tab === "text" ? (
							<div className="flex justify-end">
								<Button ref={copyRef} onClick={copy} disabled={!linkUrls}>
									<Copy className="size-4" aria-hidden />
									{t("highlights.share.copyText")}
								</Button>
							</div>
						) : null}
					</div>
				</div>
			</div>
		</dialog>
	)
}

/** An element's height as it changes, for a parent to follow it (with a transition). */
function useHeight(ref: RefObject<HTMLElement | null>): number | null {
	const [height, setHeight] = useState<number | null>(null)
	useLayoutEffect(() => {
		const element = ref.current
		if (!element) return
		setHeight(element.offsetHeight)
		const observer = new ResizeObserver(() => setHeight(element.offsetHeight))
		observer.observe(element)
		return () => observer.disconnect()
	}, [ref])
	return height
}

type ShareTab = "text" | "link" | "image"

const TAB_ICONS: Record<ShareTab, ReactNode> = {
	text: <Type className="size-4" aria-hidden />,
	link: <Link2 className="size-4" aria-hidden />,
	image: <ImageIcon className="size-4" aria-hidden />,
}

const TAB_KEY = "klipstack:share-tab"

/** The way out chosen last on this device; text the first time. */
function lastTab(): ShareTab {
	try {
		const saved = localStorage.getItem(TAB_KEY)
		return saved === "link" || saved === "image" ? saved : "text"
	} catch {
		return "text"
	}
}

function rememberTab(tab: ShareTab) {
	try {
		localStorage.setItem(TAB_KEY, tab)
	} catch {
		// Private browsing without storage: the next dialog opens on text.
	}
}

/**
 * What goes out, as its page shows it: no marker, the note on yellow whatever its color. Compact
 * beside the link's controls, where the page shows it whole.
 */
function SharePreview({
	highlight: h,
	note,
	compact,
}: {
	highlight: ShareHighlight
	note: string | null
	compact: boolean
}) {
	return (
		<figure
			data-testid="share-preview"
			className="clipping px-5 pt-[calc(var(--clip-top)+1rem)] pb-4"
		>
			<ClippingPaper id={h.id} />
			<span aria-hidden className="-mb-2 block h-7 font-serif text-5xl leading-none text-muted-fg">
				“
			</span>
			<blockquote
				className={`font-serif leading-normal text-fg ${compact ? "line-clamp-5 text-base" : "line-clamp-[10] text-lg"}`}
			>
				<span className="whitespace-pre-line">{h.exact.trim()}</span>
			</blockquote>
			{note ? (
				<PostIt
					as="span"
					fit={note}
					tilt={tiltFor(h.id)}
					className={`-mr-2 ml-auto leading-snug ${compact ? "mt-3 text-sm" : "mt-5 text-base"}`}
				>
					<span className={compact ? "line-clamp-6" : "line-clamp-[8]"}>
						<NoteText text={note} plainLinks />
					</span>
				</PostIt>
			) : null}
			<figcaption className={`border-t border-border pt-3 text-sm ${compact ? "mt-3" : "mt-5"}`}>
				<span className="line-clamp-2 font-medium">{h.article.title ?? h.article.sourceUrl}</span>
				<span className="block truncate text-xs text-muted-fg">
					{creditLabel({ ...h.article, url: h.article.sourceUrl })}
				</span>
			</figcaption>
		</figure>
	)
}

/**
 * The original address of each article the note links to: shared, its links go there instead of
 * into the reader's library. Null while they are being looked up; a failed lookup leaves them as
 * titles.
 */
function useLinkUrls(note: string | null): Record<string, string> | null {
	const ids = note ? extractLinkIds(note) : []
	const key = ids.join(",")
	const [found, setFound] = useState<{ key: string; urls: Record<string, string> } | null>(null)
	useEffect(() => {
		if (!key) return
		let live = true
		const query = new URLSearchParams(key.split(",").map((id) => ["id", id]))
		fetch(`/api/note-links?${query}`)
			.then((r) => (r.ok ? (r.json() as Promise<{ urls: Record<string, string> }>) : { urls: {} }))
			.catch(() => ({ urls: {} }))
			.then(({ urls }) => live && setFound({ key, urls }))
		return () => {
			live = false
		}
	}, [key])
	if (!key) return {}
	return found?.key === key ? found.urls : null
}

type LinkState = ShareState | { removed: true } | null
type LinkAnswer = WebResult<{ share: LinkState }>

/** The highlight's public link: what it is, and the fetcher that changes it. */
function usePublicLink(id: string, enabled: boolean) {
	const loader = useFetcher<LinkAnswer>()
	const changer = useFetcher<LinkAnswer>()
	const href = `/highlights/${id}/share`
	useEffect(() => {
		if (enabled) void loader.load(href)
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- once per highlight
	}, [enabled, href])
	// A change's answer, else the look's, which runs again after each change: a change that failed
	// leaves the link as it was.
	const answer = changer.data?.ok ? changer.data : loader.data
	const share = answer?.ok ? answer.share : null
	const loading = enabled && loader.data === undefined
	const busy = changer.state !== "idle"
	const change = (body: { intent: "share"; includeNote: boolean } | { intent: "stop" }) =>
		changer.submit(body, { method: "post", action: href, encType: "application/json" })
	const error = changer.data?.ok === false ? changer.data.error : null
	return { share, loading, busy, change, error }
}

/**
 * The public link's part of the dialog. Not shared: what a link does, and Create link. Shared: the
 * address, Copy link (and the system's share sheet where there is one), Update link when the
 * highlight or the note choice moved on from what the page shows, and Stop sharing.
 */
function PublicLink({
	link,
	withNote,
	hasNote,
	onLeave,
}: {
	link: ReturnType<typeof usePublicLink>
	/**
	 * The note goes with the link, now or once there is one: a page shared before the highlight had
	 * a note offers an update when one is written.
	 */
	withNote: boolean
	hasNote: boolean
	/** Closes the dialog: the Notebook link leads away from it. */
	onLeave: () => void
}) {
	const { t } = useTranslation("reader")
	const { share, loading, busy, change, error } = link
	const url = share && !share.removed ? new URL(share.url, window.location.origin).href : null
	const stale = share && !share.removed ? share.changed || share.includeNote !== withNote : false
	const canShareSheet = typeof navigator !== "undefined" && typeof navigator.share === "function"

	return (
		<div data-testid="share-link" className="flex flex-col gap-3">
			{loading ? (
				<p className="text-sm text-muted-fg">{t("highlights.share.link.loading")}</p>
			) : share?.removed ? (
				<p className="text-sm text-muted-fg">{t("highlights.share.link.removed")}</p>
			) : url ? (
				<>
					<input
						readOnly
						value={url}
						aria-label={t("highlights.share.link.address")}
						onFocus={(e) => e.currentTarget.select()}
						className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
					/>
					{stale ? (
						<p className="text-sm text-muted-fg">{t("highlights.share.link.stale")}</p>
					) : null}
					<div className="flex flex-wrap gap-2">
						<Button size="sm" onClick={() => copyText(url, t("highlights.share.link.copied"))}>
							<Copy className="size-4" aria-hidden />
							{t("highlights.share.link.copy")}
						</Button>
						{canShareSheet ? (
							<Button
								size="sm"
								variant="secondary"
								onClick={() => void navigator.share({ url }).catch(() => {})}
							>
								<Share className="size-4" aria-hidden />
								{t("highlights.share.link.shareSheet")}
							</Button>
						) : null}
						{stale ? (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy}
								onClick={() => void change({ intent: "share", includeNote: withNote })}
							>
								{t("highlights.share.link.update")}
							</Button>
						) : null}
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={() => void change({ intent: "stop" })}
							className="ml-auto text-muted-fg"
						>
							{t("highlights.share.link.stop")}
						</Button>
					</div>
					<p className="text-xs text-muted-fg">
						<Trans
							t={t}
							i18nKey="highlights.share.link.all"
							components={{
								notebook: (
									<Link
										to="/notebook?show=shared"
										onClick={onLeave}
										className="text-link hover:underline"
									/>
								),
							}}
						/>
					</p>
				</>
			) : (
				<>
					<p className="text-sm text-muted-fg">
						{t(
							withNote && hasNote
								? "highlights.share.link.aboutWithNote"
								: "highlights.share.link.about",
						)}
					</p>
					<div>
						<Button
							size="sm"
							disabled={busy}
							onClick={() => void change({ intent: "share", includeNote: withNote })}
						>
							{t("highlights.share.link.create")}
						</Button>
					</div>
				</>
			)}
			{error ? (
				<p role="alert" className="text-sm text-danger">
					{t(
						error.code === "limit_reached"
							? "highlights.share.link.errors.limit"
							: error.code === "share_removed"
								? "highlights.share.link.removed"
								: "highlights.share.link.errors.failed",
					)}
				</p>
			) : null}
		</div>
	)
}
