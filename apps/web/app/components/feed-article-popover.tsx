import { BookOpen, Bookmark, ExternalLink, X } from "lucide-react"
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { useMediaQuery } from "~/hooks/use-media-query"

/** The title and the entry's context menu share this action sheet. */
export function FeedArticlePopover({
	id,
	title,
	url,
	documentId,
	from,
	anchor,
	point,
	busy,
	onClose,
	onOpenOriginal,
	onSave,
	onRead,
	onDismiss,
}: {
	id: string
	title: string
	url: string
	documentId: string | null
	from: "/feed" | "/home"
	anchor: RefObject<HTMLButtonElement | null>
	point?: { x: number; y: number }
	busy: boolean
	onClose: () => void
	onOpenOriginal: () => void
	onSave: () => void
	onRead: () => void
	onDismiss: () => void
}) {
	const { t } = useTranslation("feed")
	const touch = useMediaQuery("(pointer: coarse)")
	const ref = useRef<HTMLDivElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const [position, setPosition] = useState({ top: 0, left: 0 })

	useLayoutEffect(() => {
		const card = ref.current
		const trigger = anchor.current
		closeRef.current?.focus({ preventScroll: true })
		return () => {
			if (card?.contains(document.activeElement) && trigger?.isConnected) {
				trigger.focus({ preventScroll: true })
			}
		}
	}, [anchor])

	useLayoutEffect(() => {
		if (touch) return
		const card = ref.current
		if (!card) return
		const place = () => {
			const rect = anchor.current?.getBoundingClientRect()
			if (!rect) return
			const below = point?.y ?? rect.bottom + 6
			const top =
				!point && below + card.offsetHeight > window.innerHeight - 8
					? rect.top - card.offsetHeight - 6
					: below
			setPosition({
				top: Math.max(8, Math.min(top, window.innerHeight - card.offsetHeight - 8)),
				left: Math.max(
					8,
					Math.min(point?.x ?? rect.left, window.innerWidth - card.offsetWidth - 8),
				),
			})
		}
		place()
		const observer = new ResizeObserver(place)
		observer.observe(card)
		window.addEventListener("resize", place)
		return () => {
			observer.disconnect()
			window.removeEventListener("resize", place)
		}
	}, [anchor, point, touch])

	useEffect(() => {
		const outside = (event: Event) => {
			const target = event.target as Node
			if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose()
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				onClose()
			}
		}
		const onScroll = (event: Event) => {
			if (!touch && !ref.current?.contains(event.target as Node)) onClose()
		}
		document.addEventListener("pointerdown", outside)
		document.addEventListener("focusin", outside)
		document.addEventListener("keydown", onKey)
		document.addEventListener("scroll", onScroll, { capture: true, passive: true })
		return () => {
			document.removeEventListener("pointerdown", outside)
			document.removeEventListener("focusin", outside)
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("scroll", onScroll, { capture: true })
		}
	}, [anchor, onClose, touch])

	return createPortal(
		<div
			ref={ref}
			id={id}
			role="dialog"
			aria-label={t("item.actions")}
			aria-describedby={`${id}-title`}
			data-placement={touch ? "bottom" : "floating"}
			onContextMenu={(event) => event.stopPropagation()}
			style={
				touch
					? undefined
					: {
							position: "fixed",
							...position,
							width: 320,
							maxWidth: "calc(100vw - 16px)",
							maxHeight: "calc(100dvh - 16px)",
						}
			}
			className={
				touch
					? "safe-bottom fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-2 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
					: "z-50 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl"
			}
		>
			<div className="flex items-start gap-2 pb-2 pl-3">
				<p
					id={`${id}-title`}
					className="line-clamp-3 flex-1 pt-2 font-serif text-base leading-snug break-words"
				>
					{title}
				</p>
				<button
					ref={closeRef}
					type="button"
					onClick={onClose}
					aria-label={t("item.close")}
					className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent"
				>
					<X className="size-4" aria-hidden />
				</button>
			</div>
			<div className="flex flex-col">
				{documentId ? (
					<Link to={`/read/${documentId}`} state={{ from }} onClick={onClose} className={action}>
						<BookOpen className="size-4" aria-hidden />
						{t("item.read")}
					</Link>
				) : (
					<>
						<button type="button" disabled={busy} onClick={onSave} className={action}>
							<Bookmark className="size-4" aria-hidden />
							{t("item.save")}
						</button>
						<button type="button" disabled={busy} onClick={onRead} className={action}>
							<BookOpen className="size-4" aria-hidden />
							{t("item.saveRead")}
						</button>
					</>
				)}
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer"
					onClick={onOpenOriginal}
					onAuxClick={(event) => {
						if (event.button === 1) onOpenOriginal()
					}}
					className={action}
				>
					<ExternalLink className="size-4" aria-hidden />
					{t("item.openOriginal")}
				</a>
				<div className="my-1 border-t border-border" />
				<button type="button" disabled={busy} onClick={onDismiss} className={action}>
					<X className="size-4" aria-hidden />
					{t("item.dismiss")}
				</button>
			</div>
		</div>,
		document.body,
	)
}

const action =
	"flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
