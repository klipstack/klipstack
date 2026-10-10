import { BookOpen, Copy, ExternalLink, LoaderCircle, Plus, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { useMediaQuery } from "~/hooks/use-media-query"
import type { LinkPreviewCache } from "~/lib/link-preview-cache"
import { saveErrorKey } from "~/lib/save-errors"
import { showToast } from "~/lib/toast"

export interface LinkTarget {
	href: string
	text: string
	/** Id of the saved article this link points to, when it is one. */
	savedId: string | null
	rect: DOMRect
	/** Opened by the mouse resting on the link, and not pinned since: leaving closes it. */
	hovered?: boolean
}

interface Props {
	link: LinkTarget
	previews: LinkPreviewCache
	/** Passed as `state.from` so the opened article's Back goes to this reader. */
	from: string
	onSaved: (href: string, id: string) => void
	onClose: () => void
	/** Keeps a hovered card open while the pointer is inside it (`useLinkHover`). */
	hover?: {
		onPointerEnter: (event: React.PointerEvent) => void
		onPointerLeave: (event: React.PointerEvent) => void
	}
	/** Something was done in the card: it stays until closed. */
	onPin?: () => void
}

/**
 * Links inside an article do not navigate on their own: this asks what to do. Open the original
 * (new tab), save it to the library, or, for links to articles already saved, open those here.
 * Anchored to the link with a mouse; a bottom sheet on touch devices. A mouse resting on a link
 * opens it too; clicking the link, or anything in the card, pins it.
 */
export function LinkPopover(props: Props) {
	return <LinkCard key={props.link.href} {...props} />
}

function LinkCard({ link, previews, from, onSaved, onClose, hover, onPin }: Props) {
	const { t } = useTranslation("reader")
	const { t: tl } = useTranslation("library")
	const touch = useMediaQuery("(pointer: coarse)")
	const ref = useRef<HTMLDivElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	// `/api/documents` answers as the API does: the article, or the error body.
	const fetcher = useFetcher<{
		article?: { id: string }
		error?: { code: string; details?: Record<string, unknown> }
	}>()
	const saving = fetcher.state !== "idle"
	const error = fetcher.data?.error ? saveErrorKey(fetcher.data.error) : null
	const [preview, setPreview] = useState(() => previews.peek(link.href)?.value)
	const loading = preview === undefined
	const [position, setPosition] = useState({ top: 8, left: 8 })

	// Opened on purpose (a click, a key), it takes the focus. Opened by a passing mouse, it does not.
	const [takeFocus] = useState(!link.hovered)
	useLayoutEffect(() => {
		if (!takeFocus) return
		const previous = document.activeElement
		const card = ref.current
		closeRef.current?.focus({ preventScroll: true })
		return () => {
			if (
				previous instanceof HTMLElement &&
				previous.isConnected &&
				card?.contains(document.activeElement)
			)
				previous.focus({ preventScroll: true })
		}
	}, [takeFocus])

	useEffect(() => {
		let active = true
		void previews.load(link.href).result.then((result) => {
			if (active) setPreview(result)
		})
		return () => {
			active = false
		}
	}, [link.href, previews])

	// Metadata and images change the card's height after it opens. Keep it in the viewport.
	useLayoutEffect(() => {
		const card = ref.current
		if (touch || !card) return
		const scrollY = window.scrollY
		const scrollX = window.scrollX
		const place = () => {
			const anchorTop = link.rect.top + scrollY - window.scrollY
			const anchorBottom = link.rect.bottom + scrollY - window.scrollY
			const below = window.innerHeight - anchorBottom - 16
			const above = anchorTop - 16
			const top =
				card.offsetHeight <= below || below >= above
					? anchorBottom + 8
					: anchorTop - card.offsetHeight - 8
			setPosition({
				top: Math.max(8, Math.min(top, window.innerHeight - card.offsetHeight - 8)),
				left: Math.max(
					8,
					Math.min(
						link.rect.left + scrollX - window.scrollX,
						window.innerWidth - card.offsetWidth - 8,
					),
				),
			})
		}
		place()
		const observer = new ResizeObserver(place)
		observer.observe(card)
		window.addEventListener("resize", place)
		window.addEventListener("scroll", place)
		return () => {
			observer.disconnect()
			window.removeEventListener("resize", place)
			window.removeEventListener("scroll", place)
		}
	}, [link.rect, touch])

	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			const target = e.target as Element
			// Its own link: the click that follows pins the card, it does not open it again.
			if (target.closest?.<HTMLAnchorElement>("a[href]")?.href === link.href) return
			if (ref.current && !ref.current.contains(target)) onClose()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		document.addEventListener("pointerdown", onDown)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown)
			document.removeEventListener("keydown", onKey)
		}
	}, [onClose, link.href])

	// Saved: tell the reader (the link now counts as saved) and offer to open it.
	useEffect(() => {
		if (fetcher.state !== "idle" || !fetcher.data?.article) return
		const { id } = fetcher.data.article
		onSaved(link.href, id)
		showToast({
			message: t("link.savedToast"),
			link: { label: t("link.savedOpen"), to: `/read/${id}` },
		})
		onClose()
	}, [fetcher.state, fetcher.data, link.href, onSaved, onClose, t])

	const host = (() => {
		try {
			return new URL(link.href).hostname.replace(/^www\./, "")
		} catch {
			return link.href
		}
	})()

	const action =
		"flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
	const imageUrl = preview?.imageUrl
	const copyOriginal = async () => {
		try {
			await navigator.clipboard.writeText(link.href)
			showToast({ message: t("link.copied") })
		} catch {
			showToast({ message: t("link.copyFailed") })
		}
	}

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label={t("link.label")}
			data-placement={touch ? "bottom" : "floating"}
			data-hovered={link.hovered ? "" : undefined}
			{...hover}
			onPointerDown={onPin}
			onFocus={onPin}
			style={
				touch
					? undefined
					: {
							position: "fixed",
							...position,
							width: 360,
							maxWidth: "calc(100vw - 16px)",
							maxHeight: "calc(100dvh - 16px)",
						}
			}
			className={
				touch
					? "safe-bottom fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
					: "z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
			}
		>
			<div className="min-h-0 overflow-y-auto">
				{imageUrl ? <PreviewImage key={imageUrl} src={imageUrl} /> : null}
				<button
					ref={closeRef}
					type="button"
					onClick={onClose}
					className="absolute right-2 top-2 rounded-full bg-card/95 p-2 text-muted-fg shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent"
					aria-label={t("highlights.toolbar.close")}
				>
					<X className="size-4" aria-hidden />
				</button>
				{loading ? (
					<div
						role="status"
						className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3 pr-12 text-sm font-medium"
					>
						<LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
						{t("link.loadingPreview")}
					</div>
				) : null}
				<div className="space-y-2 p-4">
					<p className="truncate pr-7 text-xs font-medium text-muted-fg">
						{preview?.siteName || host}
					</p>
					<h2 className="line-clamp-3 break-words text-base font-semibold leading-snug">
						{preview?.title || link.text || host}
					</h2>
					{preview?.author ? (
						<p className="line-clamp-1 text-xs text-muted-fg">{preview.author}</p>
					) : null}
					{preview?.description ? (
						<p className="line-clamp-3 break-words text-sm leading-relaxed text-muted-fg">
							{preview.description}
						</p>
					) : null}
					<p className="truncate text-xs text-muted-fg" title={link.href}>
						{link.href}
					</p>
					{loading ? (
						<div aria-hidden className="space-y-2 pt-1 motion-safe:animate-pulse">
							<div className="h-2 w-full rounded bg-muted" />
							<div className="h-2 w-2/3 rounded bg-muted" />
						</div>
					) : null}
				</div>
			</div>
			<div className="flex shrink-0 flex-col border-t border-border p-2">
				{link.savedId ? (
					<Link to={`/read/${link.savedId}`} state={{ from }} className={action}>
						<BookOpen className="size-4 text-accent" aria-hidden />
						{t("link.openSaved")}
					</Link>
				) : (
					<button
						type="button"
						disabled={saving}
						onClick={() =>
							fetcher.submit(JSON.stringify({ url: link.href, source: "web" }), {
								method: "post",
								action: "/api/documents",
								encType: "application/json",
							})
						}
						className={action}
					>
						<Plus className="size-4 text-accent" aria-hidden />
						{saving ? t("link.saving") : t("link.save")}
					</button>
				)}
				<a href={link.href} target="_blank" rel="noopener noreferrer" className={action}>
					<ExternalLink className="size-4" aria-hidden />
					{t("link.openOriginal")}
				</a>
				<button type="button" onClick={copyOriginal} className={action}>
					<Copy className="size-4" aria-hidden />
					{t("link.copyOriginal")}
				</button>
				{error ? <p className="px-3 pb-1 text-xs text-danger">{tl(error)}</p> : null}
			</div>
		</div>
	)
}

function PreviewImage({ src }: { src: string }) {
	const { t } = useTranslation("reader")
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading")
	if (state === "failed") return null
	return (
		<div className="relative h-36 bg-muted">
			{state === "loading" ? (
				<div
					role="status"
					className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-fg"
				>
					<LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
					{t("link.loadingImage")}
				</div>
			) : null}
			<img
				src={src}
				alt=""
				referrerPolicy="no-referrer"
				onLoad={() => setState("ready")}
				onError={() => setState("failed")}
				className={`h-full w-full object-cover ${state === "loading" ? "invisible" : ""}`}
			/>
		</div>
	)
}
