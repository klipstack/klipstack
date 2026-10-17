import { highlightShareText } from "@klipstack/api-contract/highlight-share"
import { extractLinkIds } from "@klipstack/api-contract/note-links"
import { Copy, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { copyRich } from "~/lib/copy-link"
import { highlightColor, highlightColorName } from "~/lib/highlight-colors"
import { safeHost, siteLabel } from "~/lib/site-label"
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
}

/**
 * Sharing a highlight: a preview of what goes out, the choice to leave the note out, and the ways to
 * share it. The note goes too unless the reader unticks it. Mount it to open it.
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
		copyRich(markdown, html, t("highlights.share.copied"))
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
							<NoteText text={shownNote} plainLinks />
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

				<div className="flex flex-wrap justify-end gap-2">
					<Button ref={copyRef} onClick={copy} disabled={!linkUrls}>
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
