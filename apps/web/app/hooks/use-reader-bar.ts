import { useEffect, useRef, useState } from "react"
import { firstRect } from "~/lib/highlights.client"

/** Scrolled less than this, the phone top bar stays in view. */
const BAR_ALWAYS_SHOWN_ABOVE = 64

/**
 * The reader's top bar: it shows the title once the article's own has scrolled away, and on
 * phones slides away while scrolling down and comes back on the way up.
 */
export function useReaderBar(ready: boolean) {
	const titleRef = useRef<HTMLElement>(null)
	const headerRef = useRef<HTMLElement>(null)
	const [titleAway, setTitleAway] = useState(false)
	const [barHidden, setBarHidden] = useState(false)

	useEffect(() => {
		const el = titleRef.current
		if (!ready || !el) return
		// Top margin: the sticky bar covers the first ~60px of the viewport.
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry) setTitleAway(!entry.isIntersecting && entry.boundingClientRect.top < 0)
			},
			{ rootMargin: "-64px 0px 0px 0px" },
		)
		observer.observe(el)
		return () => observer.disconnect()
	}, [ready])

	useEffect(() => {
		if (!ready) return
		let last = window.scrollY
		const onScroll = () => {
			const el = document.documentElement
			const y = el.scrollTop
			// Near the top: always shown. Past the end (iOS bounce): ignore the rebound.
			if (y < BAR_ALWAYS_SHOWN_ABOVE) {
				setBarHidden(false)
				last = y
				return
			}
			if (y > el.scrollHeight - el.clientHeight - 2) return
			if (Math.abs(y - last) < 8) return
			setBarHidden(y > last)
			last = y
		}
		window.addEventListener("scroll", onScroll, { passive: true })
		return () => window.removeEventListener("scroll", onScroll)
	}, [ready])

	return { titleRef, headerRef, titleAway, barHidden }
}

/**
 * Phones edit highlights in a sheet at the bottom of the screen: bring the highlight in focus to
 * the top so the sheet does not cover it. Scrolling down hides the top bar, unless we stay near
 * the top. The keyboard (typing a note) shrinks the visible area and iOS pans the page: align
 * again then.
 */
export function useAlignForSheet(
	focusId: string | null,
	touch: boolean,
	rangesRef: React.RefObject<Map<string, Range>>,
	headerRef: React.RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		if (!focusId || !touch) return
		const vv = window.visualViewport
		const align = () => {
			const range = rangesRef.current.get(focusId)
			const rect = range ? firstRect(range) : null
			const header = headerRef.current
			if (!rect || !header) return
			const gap = 12
			const viewTop = vv?.offsetTop ?? 0
			const hiddenBarTop = Number.parseFloat(getComputedStyle(header).paddingTop) + gap
			let top = window.scrollY + rect.top - viewTop - hiddenBarTop
			if (top < BAR_ALWAYS_SHOWN_ABOVE)
				top = window.scrollY + rect.top - viewTop - header.offsetHeight - gap
			window.scrollTo({ top: Math.max(0, top), behavior: "smooth" })
		}
		align()
		// Only a keyboard-sized change: Safari's toolbar collapsing while scrolling is not one.
		let height = vv?.height ?? 0
		// iOS goes on panning the page to show the caret once the keyboard is up, and again while
		// typing, with no resize to tell us. For a moment after either, a pan no finger made is undone.
		let settleUntil = 0
		let touching = false
		let timer = 0
		const settle = () => {
			settleUntil = performance.now() + 1000
		}
		const onResize = () => {
			if (!vv || Math.abs(vv.height - height) < 120) return
			height = vv.height
			settle()
			align()
		}
		// Once the pan has come to rest: aligning on every event would restart the smooth scroll.
		const onPan = () => {
			window.clearTimeout(timer)
			if (touching || performance.now() > settleUntil) return
			timer = window.setTimeout(() => {
				if (!touching) align()
			}, 100)
		}
		const onTouchStart = () => {
			touching = true
			window.clearTimeout(timer)
		}
		const onTouchEnd = (e: TouchEvent) => {
			touching = e.touches.length > 0
		}
		vv?.addEventListener("resize", onResize)
		vv?.addEventListener("scroll", onPan)
		document.addEventListener("focusin", settle)
		document.addEventListener("input", settle, true)
		document.addEventListener("touchstart", onTouchStart, { passive: true })
		document.addEventListener("touchend", onTouchEnd)
		document.addEventListener("touchcancel", onTouchEnd)
		return () => {
			window.clearTimeout(timer)
			vv?.removeEventListener("resize", onResize)
			vv?.removeEventListener("scroll", onPan)
			document.removeEventListener("focusin", settle)
			document.removeEventListener("input", settle, true)
			document.removeEventListener("touchstart", onTouchStart)
			document.removeEventListener("touchend", onTouchEnd)
			document.removeEventListener("touchcancel", onTouchEnd)
		}
	}, [focusId, touch, rangesRef, headerRef])
}
