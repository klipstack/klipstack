import {
	currentSection,
	OUTLINE_MIN_ENTRIES,
	type OutlineEntry,
	outlineOf,
} from "@klipstack/anchor"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMediaQuery } from "~/hooks/use-media-query"
import { cn } from "~/lib/utils"

/** The sticky top bar's height, plus some air: where a heading lands when picked. */
const OFFSET = 80
/** Room left of the article for the docked outline: 13rem, 1.5rem from the window's edge, a gap. */
const ROOM = 24 + 208 + 16
/** How long the pointer rests at the window's left edge before the outline slides in. */
const PEEK_DELAY_MS = 150
/** How long the pointer may stray off the slid-in outline before it goes. */
const HIDE_DELAY_MS = 350

/**
 * What the reader page knows of the outline, for the top bar's button: whether the article has
 * one, whether it fits docked beside the text, and whether it has slid in over the page.
 */
export function useOutline() {
	const [available, setAvailable] = useState(false)
	const [room, setRoom] = useState(false)
	const [peek, setPeek] = useState(false)
	return { available, setAvailable, room, setRoom, peek, setPeek }
}
export type OutlineState = ReturnType<typeof useOutline>

/** Marks the top bar's button: a press on it is not a press outside the slid-in outline. */
export const OUTLINE_TOGGLE = "data-outline-toggle"
/** The outline's element, which the top bar's button controls. */
export const OUTLINE_ID = "reader-outline"

const toggleButton = () => document.querySelector<HTMLElement>(`[${OUTLINE_TOGGLE}]`)

/**
 * The article's contents, left of the text: its headings, the one being read marked, each one a
 * jump to it. Docked beside the text when there is room and the reader wants it (`pinned`);
 * otherwise hidden, sliding in over the page from the top bar's button or, with a mouse, from the
 * window's left edge, and going again when the pointer leaves it or a heading is picked. Nothing
 * for an article with fewer than three headings.
 */
export function ReaderOutline({
	contentRef,
	articleRef,
	headerRef,
	html,
	pinned,
	state,
}: {
	contentRef: React.RefObject<HTMLElement | null>
	articleRef: React.RefObject<HTMLElement | null>
	headerRef: React.RefObject<HTMLElement | null>
	html: string
	pinned: boolean
	state: OutlineState
}) {
	const { t } = useTranslation("reader")
	const { room, setRoom, peek, setPeek, setAvailable } = state
	const mouse = useMediaQuery("(hover: hover) and (pointer: fine)")
	const [entries, setEntries] = useState<OutlineEntry[]>([])
	const [active, setActive] = useState(-1)
	const [top, setTop] = useState(0)
	const navRef = useRef<HTMLElement>(null)
	const timer = useRef<number | undefined>(undefined)
	const shown = entries.length >= OUTLINE_MIN_ENTRIES
	const docked = shown && room && pinned
	const floating = shown && !docked
	const visible = docked || (floating && peek)

	useEffect(() => {
		const root = contentRef.current
		setEntries(root && html ? outlineOf(root) : [])
	}, [contentRef, html])
	useEffect(() => setAvailable(shown), [shown, setAvailable])

	// Room beside the article, measured as the margin's notes measure theirs (useMarginRoom).
	useEffect(() => {
		const article = articleRef.current
		const page = article?.parentElement
		if (!article || !page) return
		const measure = () => {
			const left =
				page.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(page).paddingLeft)
			setRoom(article.getBoundingClientRect().left - left >= ROOM)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(page)
		observer.observe(article)
		window.addEventListener("resize", measure)
		return () => {
			observer.disconnect()
			window.removeEventListener("resize", measure)
		}
	}, [articleRef, setRoom])

	// Docked, it is never also slid in.
	useEffect(() => {
		if (!floating) setPeek(false)
	}, [floating, setPeek])

	// Slid in under the top bar, wherever the bar is (on phones it slides away while scrolling).
	// Before paint: opened by a timer, its first frame must not cover the bar.
	useLayoutEffect(() => {
		if (!peek) return
		const measure = () =>
			setTop(Math.max(0, headerRef.current?.getBoundingClientRect().bottom ?? 0))
		measure()
		const header = headerRef.current
		header?.addEventListener("transitionend", measure)
		return () => header?.removeEventListener("transitionend", measure)
	}, [peek, headerRef])

	// Opened from the button, the keyboard goes into it: to the section being read, or the first.
	useEffect(() => {
		if (!peek || document.activeElement !== toggleButton()) return
		const current = navRef.current?.querySelector<HTMLElement>("[aria-current]")
		;(current ?? navRef.current?.querySelector<HTMLElement>("button"))?.focus()
	}, [peek])

	const hideSoon = useCallback(() => {
		window.clearTimeout(timer.current)
		timer.current = window.setTimeout(() => setPeek(false), HIDE_DELAY_MS)
	}, [setPeek])
	const stay = () => window.clearTimeout(timer.current)
	useEffect(() => () => window.clearTimeout(timer.current), [])

	// Slid in, it goes on Escape (the keyboard back to the button) and on a press anywhere else. On
	// its way to the button, the pointer keeps it: the press there closes it.
	useEffect(() => {
		if (!floating || !peek) return
		const onDown = (e: PointerEvent) => {
			const target = e.target as Element
			if (navRef.current?.contains(target) || target.closest?.(`[${OUTLINE_TOGGLE}]`)) return
			setPeek(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return
			if (navRef.current?.contains(document.activeElement)) toggleButton()?.focus()
			setPeek(false)
		}
		const onOver = (e: PointerEvent) => {
			if ((e.target as Element).closest?.(`[${OUTLINE_TOGGLE}]`)) window.clearTimeout(timer.current)
		}
		document.addEventListener("pointerdown", onDown)
		document.addEventListener("keydown", onKey)
		document.addEventListener("pointerover", onOver)
		return () => {
			document.removeEventListener("pointerdown", onDown)
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("pointerover", onOver)
		}
	}, [floating, peek, setPeek])

	// The section being read: the last heading above the top third of the window. Measured only
	// while the outline shows.
	useEffect(() => {
		if (!visible) return
		let frame = 0
		const measure = () => {
			frame = 0
			setActive(currentSection(entries, window.innerHeight / 3))
		}
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(measure)
		}
		measure()
		window.addEventListener("scroll", onScroll, { passive: true })
		return () => {
			window.removeEventListener("scroll", onScroll)
			cancelAnimationFrame(frame)
		}
	}, [entries, visible])

	if (!shown) return null
	return (
		<>
			{floating && mouse && !peek ? (
				// The window's left edge: resting the pointer there slides the outline in.
				<div
					aria-hidden
					data-testid="outline-edge"
					className="fixed inset-y-0 left-0 z-30 w-3"
					onPointerEnter={(e) => {
						if (e.pointerType !== "mouse") return
						window.clearTimeout(timer.current)
						timer.current = window.setTimeout(() => setPeek(true), PEEK_DELAY_MS)
					}}
					onPointerLeave={stay}
				/>
			) : null}
			<nav
				ref={navRef}
				id={OUTLINE_ID}
				aria-label={t("outline.label")}
				data-testid="reader-outline"
				data-docked={docked ? "true" : undefined}
				onPointerEnter={floating && mouse ? stay : undefined}
				onPointerLeave={(e) => floating && mouse && e.pointerType === "mouse" && hideSoon()}
				style={floating ? { top } : undefined}
				className={cn(
					"fixed overflow-y-auto font-sans",
					docked
						? "top-24 left-6 max-h-[calc(100dvh-8rem)] w-52"
						: "bottom-0 left-0 z-30 w-72 max-w-[85vw] border-r border-border bg-bg px-3 py-5 shadow-xl duration-200 motion-reduce:transition-none",
					// Visible at once on the way in, so the keyboard can go into it; hidden once it is out.
					floating &&
						(peek
							? "transition-[translate]"
							: "invisible -translate-x-full transition-[translate,visibility]"),
				)}
			>
				<p className="mb-2 pl-3 text-xs font-medium tracking-wide text-muted-fg uppercase">
					{t("outline.label")}
				</p>
				<ol className="space-y-0.5 border-l border-border">
					{entries.map((entry, i) => (
						<li key={entry.key}>
							<button
								type="button"
								aria-current={i === active ? "location" : undefined}
								onClick={() => {
									const y = entry.el.getBoundingClientRect().top + window.scrollY - OFFSET
									const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
									window.scrollTo({ top: y, behavior: still ? "auto" : "smooth" })
									// The keyboard and a screen reader go on from the heading.
									if (!entry.el.hasAttribute("tabindex")) entry.el.setAttribute("tabindex", "-1")
									entry.el.focus({ preventScroll: true })
									if (floating) setPeek(false)
								}}
								className={cn(
									"-ml-px block w-full border-l-2 border-transparent py-1 pr-2 text-left text-[13px] leading-snug text-muted-fg transition-colors hover:text-fg",
									entry.depth === 0 ? "pl-3" : "pl-6",
									i === active && "border-fg font-medium text-fg",
								)}
							>
								<span className="line-clamp-2">{entry.text}</span>
							</button>
						</li>
					))}
				</ol>
			</nav>
		</>
	)
}
