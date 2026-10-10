import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { useMediaQuery } from "~/hooks/use-media-query"
import { cn } from "~/lib/utils"

/**
 * The phone drawer's state. It is open only for the route it was opened on: navigating closes it
 * with no effect. Closed, it hands the focus back to the button that opened it.
 */
export function useMobileDrawer() {
	const location = useLocation()
	const routeKey = `${location.pathname}?${location.search}`
	const [openFor, setOpenFor] = useState<string | null>(null)
	// The drawer exists below `md` only: a window widened past it closes the drawer, whose modal
	// state would otherwise leave the page inert behind an invisible drawer.
	const wide = useMediaQuery("(min-width: 48rem)")
	const open = openFor === routeKey && !wide
	const setOpen = (next: boolean) => setOpenFor(next ? routeKey : null)
	const drawerRef = useRef<HTMLDivElement>(null)
	const menuButtonRef = useRef<HTMLButtonElement>(null)

	useEffect(() => {
		if (!open) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpenFor(null)
		}
		document.addEventListener("keydown", onKey)
		drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus()
		return () => document.removeEventListener("keydown", onKey)
	}, [open])
	// Closed (Escape, the backdrop, a link), the drawer hands the focus back to the button that
	// opened it, unless something else has taken it: a closed drawer is inert and cannot hold it.
	const wasOpen = useRef(false)
	useEffect(() => {
		if (open) {
			wasOpen.current = true
			return
		}
		if (!wasOpen.current) return
		wasOpen.current = false
		const active = document.activeElement
		if (!active || active === document.body || drawerRef.current?.contains(active))
			menuButtonRef.current?.focus({ preventScroll: true })
	}, [open])

	return { open, setOpen, drawerRef, menuButtonRef }
}

/** Phones: a modal panel from the left. Closed, it is off screen and inert: Tab cannot reach it. */
export function MobileDrawer({
	drawer,
	children,
}: {
	drawer: ReturnType<typeof useMobileDrawer>
	children: React.ReactNode
}) {
	const { t } = useTranslation()
	const { open, setOpen, drawerRef } = drawer
	return (
		<div
			className={cn("fixed inset-0 z-40 md:hidden", open ? "" : "pointer-events-none")}
			aria-hidden={!open}
			inert={!open}
		>
			<button
				type="button"
				tabIndex={-1}
				aria-label={t("actions.close")}
				onClick={() => setOpen(false)}
				className={cn(
					"absolute inset-0 bg-black/40 transition-opacity",
					open ? "opacity-100" : "opacity-0",
				)}
			/>
			<div
				id="mobile-drawer"
				ref={drawerRef}
				role="dialog"
				aria-modal="true"
				aria-label={t("nav.menu")}
				className={cn(
					"absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-card p-4 pt-[max(env(safe-area-inset-top),1rem)] shadow-2xl transition-transform",
					open ? "translate-x-0" : "-translate-x-full",
				)}
			>
				{children}
			</div>
		</div>
	)
}
