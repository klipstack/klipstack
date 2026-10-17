import { highlightShareText } from "@klipstack/api-contract/highlight-share"
import { extractLinkIds } from "@klipstack/api-contract/note-links"
import { Copy, Link2, Share, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { copyRich, copyText } from "~/lib/copy-link"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import { safeHost, siteLabel } from "~/lib/site-label"
import type { WebResult } from "~/lib/web-result"
import type { ShareState } from "~/services/highlight-shares.server"
import { ClippingPaper } from "./clipping"
import { NoteText } from "./note-text"
import { PostIt, tiltFor } from "./post-it"
import { Button } from "./ui/button"

export interface ShareHighlight {
	id: string
	/** The quote as the reader sees it: its line breaks are its paragraphs. */
	exact: string
	note: string | null
	color: number
	article: { title: string | null; sourceUrl: string; siteName: string | null }
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

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
	}, [])
	// Copy takes the keyboard once it can copy: at once, or when the note's links are looked up.
	const ready = linkUrls !== null
	useEffect(() => {
		if (ready) copyRef.current?.focus()
	}, [ready])

	const copy = () => {
		const { markdown, html } = highlightShareText(
			{
				exact: h.exact,
				note,
				article: { title: h.article.title, url: h.article.sourceUrl, siteName: h.article.siteName },
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
			className="m-auto w-[min(30rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
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
			<div className="flex flex-col gap-5 p-6">
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

				{/* What goes out, as the Notebook shows it. */}
				<figure
					{...highlightColor(h.color)}
					data-testid="share-preview"
					className="clipping px-5 pt-[calc(var(--clip-top)+1rem)] pb-4"
				>
					<ClippingPaper id={h.id} />
					<blockquote className="line-clamp-[10] font-serif text-lg leading-normal text-fg">
						<span className="marker whitespace-pre-line">{h.exact.trim()}</span>
					</blockquote>
					{shownNote ? (
						<PostIt
							as="span"
							fit={shownNote}
							color={highlightColorName(h.color)}
							tilt={tiltFor(h.id)}
							className="mt-5 -mr-2 ml-auto text-base leading-snug"
						>
							<span className="line-clamp-[8]">
								<NoteText text={shownNote} plainLinks />
							</span>
						</PostIt>
					) : null}
					<figcaption className="mt-5 border-t border-border pt-3 text-sm">
						<span className="line-clamp-2 font-medium">
							{h.article.title ?? h.article.sourceUrl}
						</span>
						<span className="block truncate text-xs text-muted-fg">
							{siteLabel(h.article.siteName, safeHost(h.article.sourceUrl))}
						</span>
					</figcaption>
				</figure>

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

				{h.canLink === false ? null : <PublicLink link={link} withNote={note ? withNote : false} />}

				<div className="flex flex-wrap justify-end gap-2">
					<Button ref={copyRef} onClick={copy} disabled={!linkUrls} variant="secondary">
						<Copy className="size-4" aria-hidden />
						{t("highlights.share.copyText")}
					</Button>
				</div>
			</div>
		</dialog>
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
	// The latest answer wins: a change's, else the first look's.
	const answer = changer.data ?? loader.data
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
}: {
	link: ReturnType<typeof usePublicLink>
	withNote: boolean
}) {
	const { t } = useTranslation("reader")
	const { share, loading, busy, change, error } = link
	const url = share && !share.removed ? new URL(share.url, window.location.origin).href : null
	const stale = share && !share.removed ? share.changed || share.includeNote !== withNote : false
	const canShareSheet = typeof navigator !== "undefined" && typeof navigator.share === "function"

	return (
		<section
			aria-label={t("highlights.share.link.label")}
			data-testid="share-link"
			className="flex flex-col gap-3 rounded-xl border border-border p-4"
		>
			<h3 className="flex items-center gap-2 text-sm font-medium">
				<Link2 className="size-4" aria-hidden />
				{t("highlights.share.link.label")}
			</h3>
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
				</>
			) : (
				<>
					<p className="text-sm text-muted-fg">
						{t(withNote ? "highlights.share.link.aboutWithNote" : "highlights.share.link.about")}
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
		</section>
	)
}
