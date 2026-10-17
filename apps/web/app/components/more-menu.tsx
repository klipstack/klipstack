import { Check, MoreHorizontal } from "lucide-react"
import {
	createContext,
	useContext,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react"
import { createPortal } from "react-dom"
import { type FetcherWithComponents, Link } from "react-router"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"

const MenuContext = createContext<() => void>(() => undefined)

const ITEMS = "[role='menuitem'], [role='menuitemradio']"

export interface MoreMenuHandle {
	/** Opens the menu at a point (a right-click) instead of under its button. */
	openAt: (x: number, y: number) => void
	/** Restore focus after a dialog opened from this menu closes. */
	focus: () => void
}

type Position = { top: number; right: number } | { top: number; left: number }

/** Whether some of `rect` is inside the window: a hidden button has no size. */
export function inWindow(rect: DOMRect) {
	return (
		rect.width > 0 &&
		rect.bottom > 0 &&
		rect.right > 0 &&
		rect.top < window.innerHeight &&
		rect.left < window.innerWidth
	)
}

/** Between a button and a menu opened beside it: clears the collapsed sidebar's edge. */
const SIDE_GAP = 16

/**
 * A "…" button with a small dropdown of secondary actions. Same on desktop and phones.
 * The dropdown is portaled to the document or its containing dialog with a fixed position, so
 * neighboring cards cannot cover it and menus inside a modal stay interactive.
 */
export function MoreMenu({
	ref,
	label,
	tooltipSide,
	side,
	align,
	icon,
	className,
	children,
}: {
	ref?: React.Ref<MoreMenuHandle>
	label: string
	/** Where the button's tooltip opens. */
	tooltipSide?: "right"
	/** Opens beside the button instead of under it: a flyout from the collapsed sidebar. */
	side?: "right"
	/** Under the button from its left edge, as long as it fits: a menu at the start of a row. */
	align?: "start"
	/** Replaces the "…" icon. */
	icon?: React.ReactNode
	className?: string
	children: React.ReactNode
}) {
	const [open, setOpen] = useState(false)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
	const [position, setPosition] = useState<Position | null>(null)
	const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
	// Which item takes the focus when the menu opens: the last one after ArrowUp on the button.
	const firstFocus = useRef<"first" | "last">("first")
	// Where the button was when the menu was last placed: a scroll moves the menu as far as the button.
	const anchor = useRef<{ top: number; left: number } | null>(null)

	/**
	 * Closes the menu. Focus that was in it goes back to the button (the menu is portaled to the end
	 * of the page, so it would otherwise fall to the body); an item that opens a dialog moves it on.
	 */
	const close = () => {
		setOpen(false)
		const active = document.activeElement
		if (!active || active === document.body || menuRef.current?.contains(active))
			buttonRef.current?.focus({ preventScroll: true })
	}

	useImperativeHandle(ref, () => ({
		focus: () => buttonRef.current?.focus({ preventScroll: true }),
		openAt: (x, y) => {
			setPoint({ x, y })
			setPosition({ top: y, left: x })
			setOpen(true)
		},
	}))

	// Closed, the menu forgets the point: the button opens it next to itself.
	if (!open && point) setPoint(null)

	useLayoutEffect(() => {
		if (!open) return
		// A modal makes body-level menus inert and covers them with its backdrop.
		setPortalTarget(buttonRef.current?.closest("dialog") ?? document.body)
		const rect = buttonRef.current?.getBoundingClientRect()
		anchor.current = rect ? { top: rect.top, left: rect.left } : null
		// At a point, `openAt` has placed it already.
		if (point) return
		const place = () => {
			const rect = buttonRef.current?.getBoundingClientRect()
			if (!rect) return
			anchor.current = { top: rect.top, left: rect.left }
			setPosition(
				side === "right"
					? { top: rect.top, left: rect.right + SIDE_GAP }
					: align === "start"
						? { top: rect.bottom + 4, left: rect.left }
						: { top: rect.bottom + 4, right: window.innerWidth - rect.right },
			)
		}
		place()
		window.addEventListener("resize", place)
		return () => window.removeEventListener("resize", place)
	}, [open, point, side, align])

	// Keep the menu inside the window once its size is known: clamped at a point, above its button
	// when there is no room below (a row at the bottom of the screen), and against the button's left
	// edge when its right one would push the menu off the window (the collapsed sidebar).
	useLayoutEffect(() => {
		const menu = menuRef.current
		if (!menu || !position) return
		const { width, height } = menu.getBoundingClientRect()
		if (point) {
			if (!("left" in position)) return
			const left = Math.max(8, Math.min(point.x, window.innerWidth - width - 8))
			const top = Math.max(8, Math.min(point.y, window.innerHeight - height - 8))
			if (left !== position.left || top !== position.top) setPosition({ top, left })
			return
		}
		const rect = buttonRef.current?.getBoundingClientRect()
		if (!rect) return
		if (side === "right") {
			// Level with the button, moved up only as far as the window's bottom edge needs.
			const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))
			if (!("left" in position) || top !== position.top)
				setPosition({ top, left: rect.right + SIDE_GAP })
			return
		}
		// Under the button when it fits, else above it when that fits; chosen again as a scroll moves it.
		const below = rect.bottom + 4
		const above = rect.top - height - 4
		const top = below + height > window.innerHeight - 8 && above >= 8 ? above : below
		const fromLeft =
			align === "start" ? rect.left + width <= window.innerWidth - 8 : rect.right - width < 8
		const next: Position = fromLeft
			? { top, left: rect.left }
			: { top, right: window.innerWidth - rect.right }
		const same =
			next.top === position.top &&
			("left" in next
				? "left" in position && next.left === position.left
				: "right" in position && next.right === position.right)
		if (!same) setPosition(next)
	}, [point, position, portalTarget, side, align])

	// Opened, the focus moves into the menu: keyboard and screen reader users land on its items.
	const shown = open && position !== null && portalTarget !== null
	useEffect(() => {
		if (!shown) return
		const items = menuRef.current?.querySelectorAll<HTMLElement>(ITEMS)
		const item = firstFocus.current === "last" ? items?.[items.length - 1] : items?.[0]
		item?.focus({ preventScroll: true })
		firstFocus.current = "first"
	}, [shown])

	/** Arrow keys, Home and End move between the items; Tab leaves the menu, back to its button. */
	const onMenuKeyDown = (e: React.KeyboardEvent) => {
		const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
		if (items.length === 0) return
		const index = items.indexOf(document.activeElement as HTMLElement)
		const focus = (i: number) => {
			e.preventDefault()
			items[(i + items.length) % items.length]?.focus({ preventScroll: true })
		}
		if (e.key === "ArrowDown") focus(index + 1)
		else if (e.key === "ArrowUp") focus(index < 0 ? items.length - 1 : index - 1)
		else if (e.key === "Home") focus(0)
		else if (e.key === "End") focus(items.length - 1)
		else if (e.key === "Tab") {
			e.preventDefault()
			close()
		}
	}

	useEffect(() => {
		if (!open) return
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node
			if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
			setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Dismiss the menu before its containing native dialog.
				e.preventDefault()
				setOpen(false)
				buttonRef.current?.focus({ preventScroll: true })
			}
		}
		// The menu follows its button through a scroll, and closes once the button leaves the window.
		// The browser reports a scroll a frame late: the one that brought the button into view for
		// the click arrives after the menu opened, and moved nothing since. A long menu scrolling its
		// own list moves nothing either.
		const onScroll = (e: Event) => {
			if (menuRef.current?.contains(e.target as Node)) return
			const rect = buttonRef.current?.getBoundingClientRect()
			if (!rect || !inWindow(rect)) {
				setOpen(false)
				return
			}
			const from = anchor.current
			anchor.current = { top: rect.top, left: rect.left }
			if (!from) return
			const dy = rect.top - from.top
			const dx = rect.left - from.left
			if (dx === 0 && dy === 0) return
			setPoint((p) => (p ? { x: p.x + dx, y: p.y + dy } : p))
			setPosition((p) =>
				!p
					? p
					: "left" in p
						? { top: p.top + dy, left: p.left + dx }
						: { top: p.top + dy, right: p.right - dx },
			)
		}
		document.addEventListener("pointerdown", onDown)
		document.addEventListener("keydown", onKey)
		document.addEventListener("scroll", onScroll, { capture: true, passive: true })
		return () => {
			document.removeEventListener("pointerdown", onDown)
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("scroll", onScroll, { capture: true })
		}
	}, [open])

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={label}
				{...tooltip(label, undefined, tooltipSide)}
				onClick={() => setOpen((o) => !o)}
				onKeyDown={(e) => {
					if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
					e.preventDefault()
					firstFocus.current = e.key === "ArrowUp" ? "last" : "first"
					setOpen(true)
				}}
				className={cn("rounded-md p-1.5 text-muted-fg hover:bg-hover hover:text-fg", className)}
			>
				{icon ?? <MoreHorizontal className="size-4" aria-hidden />}
			</button>
			{shown && portalTarget
				? createPortal(
						<MenuContext.Provider value={close}>
							<div
								ref={menuRef}
								role="menu"
								aria-label={label}
								// Its items take the focus; the menu itself only from script.
								tabIndex={-1}
								onKeyDown={onMenuKeyDown}
								style={{ position: "fixed", ...position }}
								className="z-50 flex min-w-48 flex-col rounded-lg border border-border bg-card p-1 shadow-lg"
							>
								{children}
							</div>
						</MenuContext.Provider>,
						portalTarget,
					)
				: null}
		</>
	)
}

/**
 * A menu item that posts `intent` (+ `fields`) to `action` through the given fetcher. `shortcut`
 * is the key that does the same thing, shown at the right edge.
 */
export function MenuAction({
	fetcher,
	action,
	intent,
	fields,
	icon,
	danger,
	shortcut,
	onSubmit,
	children,
}: {
	fetcher: FetcherWithComponents<unknown>
	action: string
	intent: string
	fields?: Record<string, string>
	icon?: React.ReactNode
	danger?: boolean
	shortcut?: string
	onSubmit?: () => void
	children: React.ReactNode
}) {
	const close = useContext(MenuContext)
	return (
		<fetcher.Form
			method="post"
			action={action}
			onSubmit={() => {
				onSubmit?.()
				close()
			}}
		>
			<input type="hidden" name="intent" value={intent} />
			{Object.entries(fields ?? {}).map(([name, value]) => (
				<input key={name} type="hidden" name={name} value={value} />
			))}
			<button
				type="submit"
				role="menuitem"
				className={cn(
					"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover",
					danger ? "text-danger" : "text-fg",
				)}
			>
				{icon}
				{children}
				{shortcut ? <Kbd className="ml-auto pl-4">{shortcut}</Kbd> : null}
			</button>
		</fetcher.Form>
	)
}

/** A menu item that runs `onClick` and closes the menu. `shortcut` is the key that does the same. */
export function MenuButton({
	icon,
	danger,
	shortcut,
	onClick,
	children,
}: {
	icon?: React.ReactNode
	danger?: boolean
	shortcut?: string
	onClick: () => void
	children: React.ReactNode
}) {
	const close = useContext(MenuContext)
	return (
		<button
			type="button"
			role="menuitem"
			onClick={() => {
				close()
				onClick()
			}}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover",
				danger ? "text-danger" : "text-fg",
			)}
		>
			{icon}
			{children}
			{shortcut ? <Kbd className="ml-auto pl-4">{shortcut}</Kbd> : null}
		</button>
	)
}

/** A menu item that opens `href` in a new tab, or saves it with `download`, and closes the menu. */
export function MenuLink({
	icon,
	href,
	download,
	children,
}: {
	icon?: React.ReactNode
	href: string
	download?: boolean
	children: React.ReactNode
}) {
	const close = useContext(MenuContext)
	return (
		<a
			href={href}
			{...(download ? { download: true } : { target: "_blank", rel: "noopener noreferrer" })}
			role="menuitem"
			onClick={close}
			className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover"
		>
			{icon}
			{children}
		</a>
	)
}

/** A line between groups of items. */
export function MenuSeparator() {
	return <div aria-hidden className="my-1 border-t border-border" />
}

/** A key hint next to an action; decoration only. */
export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
	return (
		<kbd aria-hidden className={cn("font-sans text-xs text-muted-fg tracking-wide", className)}>
			{children}
		</kbd>
	)
}

/** One of a set of choices inside a menu; picking one leaves the menu open to show the change. */
export function MenuRadio({
	icon,
	checked,
	onSelect,
	children,
}: {
	icon?: React.ReactNode
	checked: boolean
	onSelect: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			role="menuitemradio"
			aria-checked={checked}
			onClick={onSelect}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
				checked ? "font-medium text-fg hover:bg-hover" : "text-muted-fg hover:bg-hover",
			)}
		>
			{icon}
			{children}
			{checked ? <Check className="ml-auto size-4" aria-hidden /> : null}
		</button>
	)
}

/** A menu item that navigates inside the app. */
export function MenuNavLink({
	icon,
	to,
	state,
	current = false,
	replace = false,
	onChoose,
	children,
}: {
	icon?: React.ReactNode
	to: string
	/** Before the menu closes and the link is followed. */
	onChoose?: () => void
	state?: unknown
	/** Replaces the page in the history, keeping the scroll: a choice on the page, not a new page. */
	replace?: boolean
	/** The page shows this destination already. */
	current?: boolean
	children: React.ReactNode
}) {
	const close = useContext(MenuContext)
	return (
		<Link
			to={to}
			state={state}
			replace={replace}
			preventScrollReset={replace}
			role="menuitem"
			aria-current={current ? "page" : undefined}
			onClick={() => {
				onChoose?.()
				close()
			}}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
				current ? "bg-hover font-medium text-fg" : "text-fg hover:bg-hover",
			)}
		>
			{icon}
			{children}
		</Link>
	)
}
