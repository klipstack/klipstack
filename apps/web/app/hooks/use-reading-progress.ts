import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"

/**
 * Time on the article's text (tab visible) after which a new article is no longer new. It counts
 * from when the text first reaches the top of the window, or ends in it: not while the title and
 * the brief are on screen over a longer text, so asking for its brief leaves the article new.
 */
const OPENED_AFTER_MS = 10_000
/** How near the window's top (share of its height) the text starts once the reader is on it. */
const TEXT_AT_TOP = 0.15

interface Doc {
	id: string
	firstOpenedAt: Date | string | null
	readingPosition: number
	readingCycle: number
}

/**
 * Where the reader is in the article: resumes the saved position, saves it while scrolling and
 * on the way out. A new article stops being new (`engage`) after a while on its text, a real
 * scroll through it, or a highlight; until then no position is saved.
 */
export function useReadingProgress(doc: Doc, ready: boolean) {
	const stateAction = `/documents/${doc.id}/state`

	// ---- no longer new ----
	const { submit: submitOpen } = useFetcher()
	const engaged = useRef(Boolean(doc.firstOpenedAt))
	const engage = useCallback(() => {
		if (engaged.current || !ready) return
		engaged.current = true
		// This one loads the page again: opening can start a new reading cycle, which saves need.
		void submitOpen({ intent: "open" }, { method: "post", action: stateAction })
	}, [submitOpen, stateAction, ready])
	useEffect(() => {
		if (!ready || engaged.current) return
		let visibleMs = 0
		let started = false
		const id = window.setInterval(() => {
			if (document.visibilityState !== "visible") return
			started ||= onText()
			if (!started) return
			visibleMs += 1000
			if (visibleMs >= OPENED_AFTER_MS) engage()
		}, 1000)
		return () => window.clearInterval(id)
	}, [ready, engage])

	// ---- position ----
	const [progress, setProgress] = useState(doc.readingPosition)
	const lastSent = useRef(doc.readingPosition)
	const latest = useRef(doc.readingPosition)
	// Its own fetcher: a scroll save must not cancel an article change on its way.
	const { submit: sendProgress } = useFetcher()
	const submitProgress = useCallback(
		(progress: number) => {
			// A new article glanced at and left keeps no progress either.
			if (!engaged.current) return
			if (Math.abs(progress - lastSent.current) < 0.05 && progress < 0.98) return
			lastSent.current = progress
			// Nothing on screen reads the saved position back, so no loader runs again: a reload
			// would resend the whole article about twenty times per read.
			void sendProgress(
				{ intent: "progress", progress: String(progress), cycle: String(doc.readingCycle) },
				{ method: "post", action: stateAction, defaultShouldRevalidate: false },
			)
		},
		[sendProgress, stateAction, doc.readingCycle],
	)
	// On the way out (route change, tab close, phone lock) send the exact position, no debounce.
	const flushPosition = useCallback(() => {
		if (!engaged.current || latest.current === lastSent.current) return
		lastSent.current = latest.current
		const body = new FormData()
		body.set("intent", "progress")
		body.set("progress", String(latest.current))
		body.set("cycle", String(doc.readingCycle))
		navigator.sendBeacon(stateAction, body)
	}, [stateAction, doc.readingCycle])
	useEffect(() => {
		if (!ready) return
		let timer: number | undefined
		// Where the reader reached the text: a screen scrolled from there is reading it. The scroll
		// through the brief before it, longer than the window on a phone, is not.
		let textY: number | undefined
		const onScroll = () => {
			const el = document.documentElement
			if (textY === undefined && onText()) {
				// Where the text crossed the line, also when one jump past it (the scrollbar, End) got
				// there; not before where the page opened, which a link to a highlight puts in the text.
				const top = document.querySelector(".reader-content")!.getBoundingClientRect().top
				const crossed = el.scrollTop + top - window.innerHeight * TEXT_AT_TOP
				textY = Math.min(el.scrollTop, Math.max(startY, crossed))
			}
			if (textY !== undefined && Math.abs(el.scrollTop - textY) >= el.clientHeight) engage()
			const max = scrollSpan(el)
			const progress = max <= 0 ? 1 : Math.min(1, (el.scrollTop + el.clientHeight * 0.2) / max)
			latest.current = progress
			setProgress(progress)
			window.clearTimeout(timer)
			timer = window.setTimeout(() => submitProgress(progress), 1500)
		}
		// Resume where you left off (inverse of the formula above), unless a highlight link or the
		// browser's own restoration already positioned the page. A link to the note (#note) only
		// opens the sidebar. Barely-started or finished articles open at the top.
		const stored = doc.readingPosition
		const hash = window.location.hash
		if ((!hash || hash === "#note") && window.scrollY === 0 && stored >= 0.05 && stored <= 0.95) {
			const el = document.documentElement
			const max = scrollSpan(el)
			window.scrollTo({
				top: Math.max(0, stored * max - el.clientHeight * 0.2),
				behavior: "instant",
			})
		}
		const startY = window.scrollY
		onScroll()
		window.addEventListener("scroll", onScroll, { passive: true })
		window.addEventListener("pagehide", flushPosition)
		return () => {
			window.removeEventListener("scroll", onScroll)
			window.removeEventListener("pagehide", flushPosition)
			window.clearTimeout(timer)
			flushPosition()
		}
	}, [ready, submitProgress, flushPosition, doc.readingPosition, engage])

	return { engage, progress }
}

/**
 * The reader is on the article's text: the title and the brief above it are scrolled away, or the
 * text ends in the window (a short one, read from where it is).
 */
function onText(): boolean {
	const text = document.querySelector(".reader-content")?.getBoundingClientRect()
	return (
		text != null &&
		(text.top <= window.innerHeight * TEXT_AT_TOP || text.bottom <= window.innerHeight)
	)
}

/**
 * How far the page scrolls while reading the article: to its end, not through what comes after it
 * (`data-after-reading`: the end of the article with its note, then the shelf of what to read
 * next), so an article read to its end is read.
 */
export function scrollSpan(el: HTMLElement): number {
	const after = document.querySelector<HTMLElement>("[data-after-reading]")
	if (!after) return el.scrollHeight - el.clientHeight
	const top =
		after.getBoundingClientRect().top +
		window.scrollY -
		Number.parseFloat(getComputedStyle(after).marginTop)
	return top - el.clientHeight
}
