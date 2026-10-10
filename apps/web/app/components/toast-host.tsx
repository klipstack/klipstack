import { TriangleAlert, X } from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useFetchers } from "react-router"
import { useRestoreConflictToast } from "~/hooks/use-restore-conflict-toast"
import {
	dismissToast,
	holdToast,
	releaseToast,
	restoreFocusFromToast,
	type Toast,
	useToasts,
} from "~/lib/toast"

const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"
const UNDO_FETCHER = "toast-undo"

/**
 * Renders toasts from `~/lib/toast` (mounted once, in the root). Undo posts through a fetcher.
 * The live region stays in the page, so a screen reader announces each toast as it arrives. A toast
 * waits while the pointer is over it or the focus is in it, and ⌘Z / Ctrl+Z presses its Undo from
 * anywhere nothing is being typed.
 */
export function ToastHost() {
	const toasts = useToasts()
	const fetcher = useFetcher({ key: UNDO_FETCHER })
	const fetchers = useFetchers()
	// An undo pressed while the change it undoes is still on its way waits for it: sent at once, it
	// could reach the server first, and the change would win.
	const queued = useRef<Toast["undo"]>(undefined)
	const sending = (action: string) =>
		fetchers.some(
			(f) =>
				f.key !== UNDO_FETCHER &&
				f.state === "submitting" &&
				f.formAction !== undefined &&
				new URL(f.formAction, window.location.origin).pathname === action,
		)
	const send = (undo: NonNullable<Toast["undo"]>) =>
		void fetcher.submit(
			{ intent: undo.intent, ...undo.fields },
			{ method: "post", action: undo.action },
		)
	const flushUndo = useEffectEvent(() => {
		const undo = queued.current
		if (!undo || sending(undo.action)) return
		queued.current = undefined
		send(undo)
	})
	// Whenever a fetcher moves on: the change a queued undo waits for may have landed.
	useEffect(() => flushUndo(), [fetchers])
	const { t } = useTranslation()
	const regionRef = useRef<HTMLDivElement>(null)
	const [hovered, setHovered] = useState(false)
	const [focused, setFocused] = useState(false)
	// Undoing a delete can fail when the same page was saved again meanwhile.
	useRestoreConflictToast(fetcher.data)
	const current = toasts[0]

	useEffect(() => {
		if (!current) return
		if (hovered || focused) holdToast(current.id)
		else releaseToast(current.id)
	}, [current, hovered, focused])

	const undo = (toast: Toast) => {
		if (!toast.undo) return
		if (sending(toast.undo.action)) queued.current = toast.undo
		else send(toast.undo)
		leave(toast)
	}
	// Pressed from inside the toast, the focus would fall to the body when it goes.
	const leave = (toast: Toast) => {
		const hadFocus = regionRef.current?.contains(document.activeElement) ?? false
		dismissToast(toast.id)
		setFocused(false)
		setHovered(false)
		if (hadFocus) restoreFocusFromToast()
	}

	useEffect(() => {
		if (!current?.undo) return
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing) return
			if (e.key.toLowerCase() !== "z" || e.defaultPrevented) return
			// Typing: the field's own undo.
			if (e.target instanceof Element && e.target.closest(TYPING)) return
			e.preventDefault()
			undo(current)
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})

	return (
		<div
			ref={regionRef}
			// Always in the page, so screen readers announce what is added to it: a region inserted
			// together with its text often goes unread.
			aria-live="polite"
			// Centered at the bottom, lifted over the reader's "finished?" bar while that is up
			// (app.css): the two stack instead of overlapping.
			className="toast-host pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
		>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					role="status"
					onPointerEnter={() => setHovered(true)}
					onPointerLeave={() => setHovered(false)}
					onFocus={() => setFocused(true)}
					onBlur={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
					}}
					className="pointer-events-auto flex items-center gap-3 rounded-full bg-fg py-2 pr-2 pl-4 text-sm text-bg shadow-lg"
				>
					{toast.warn ? <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden /> : null}
					<span>{toast.message}</span>
					{toast.link ? (
						<Link
							to={toast.link.to}
							onClick={() => leave(toast)}
							className="rounded-full px-2 py-1 font-semibold text-link-inverse underline-offset-2 hover:underline focus-visible:outline-link-inverse"
						>
							{toast.link.label}
						</Link>
					) : null}
					{toast.undo ? (
						<button
							type="button"
							onClick={() => undo(toast)}
							aria-keyshortcuts="Meta+Z Control+Z"
							className="rounded-full px-2 py-1 font-semibold text-bg underline-offset-2 hover:underline focus-visible:outline-link-inverse"
						>
							{toast.undo.label}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => leave(toast)}
						aria-label={t("actions.close")}
						className="rounded-full p-1.5 text-bg/70 hover:bg-bg/10 hover:text-bg focus-visible:outline-link-inverse"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>
			))}
		</div>
	)
}
