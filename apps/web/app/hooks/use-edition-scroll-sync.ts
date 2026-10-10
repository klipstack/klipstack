import { type RefObject, useEffect } from "react"
import { ITEM_ATTRIBUTE } from "~/components/edition-current-marker"
import { lineAt, mapLine } from "~/lib/scroll-sync"

/** What each article card of the editor carries, for the preview to follow it. */
export const CARD_ATTRIBUTE = "data-edition-card"

interface Side {
	/** The top, each item's start, the end: in the side's own scroll coordinates. */
	bounds: number[]
	/** The reading line, in the same coordinates. */
	line: number
	/** How far down the view the line is, as a fraction. */
	fraction: number
	/** Scrolls so that `y` is at `fraction` of the way down the view. */
	scrollTo: (y: number, fraction: number) => void
}

/**
 * The editor and its preview pane keep the same article in view. The side the user last scrolled,
 * clicked or typed in leads; the other follows at once, to the same article and as far through it.
 * Following is a scroll the user did not make, so it never leads back. When the preview is hidden
 * (a narrow page), nothing happens.
 *
 * `editor` is the editor column, scrolled with the window; `pane` scrolls the preview.
 */
export function useEditionScrollSync(
	editor: RefObject<HTMLElement | null>,
	pane: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		const main = editor.current
		const scroller = pane.current
		if (!main || !scroller) return
		let leader: "editor" | "preview" = "editor"
		let frame = 0

		const editorSide = (): Side => {
			const at = (el: Element) => el.getBoundingClientRect().top + window.scrollY
			const top = at(main)
			const cards = [...main.querySelectorAll(`[${CARD_ATTRIBUTE}]`)].map(at)
			const height = window.innerHeight
			const max = document.documentElement.scrollHeight - height
			const fraction = lineAt(window.scrollY, height, max)
			return {
				bounds: [top, ...cards, top + main.offsetHeight],
				line: window.scrollY + fraction * height,
				fraction,
				scrollTo: (y, f) => window.scrollTo({ top: y - f * height, behavior: "instant" }),
			}
		}
		const previewSide = (): Side => {
			const origin = scroller.getBoundingClientRect().top - scroller.scrollTop
			const at = (el: Element) => el.getBoundingClientRect().top - origin
			const page = scroller.firstElementChild
			const top = page ? at(page) : 0
			// Each article's list item: the space above an article belongs to it.
			const items = [...scroller.querySelectorAll(`[${ITEM_ATTRIBUTE}]`)].map((article) =>
				at(article.closest("li") ?? article),
			)
			const height = scroller.clientHeight
			const fraction = lineAt(scroller.scrollTop, height, scroller.scrollHeight - height)
			return {
				bounds: [top, ...items, top + (page?.scrollHeight ?? 0)],
				line: scroller.scrollTop + fraction * height,
				fraction,
				scrollTo: (y, f) => scroller.scrollTo({ top: y - f * height, behavior: "instant" }),
			}
		}

		const follow = () => {
			frame = 0
			// Hidden on a narrow page: `display: none` has no offset parent.
			if (scroller.offsetParent === null) return
			const [from, to] =
				leader === "editor" ? [editorSide(), previewSide()] : [previewSide(), editorSide()]
			to.scrollTo(mapLine(from.bounds, from.line, to.bounds), from.fraction)
		}
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(follow)
		}
		// Only the leader's scrolls count: the follower's are ours.
		const onWindowScroll = () => {
			if (leader === "editor") schedule()
		}
		const onPaneScroll = () => {
			if (leader === "preview") schedule()
		}
		const onInput = (event: Event) => {
			leader = scroller.contains(event.target as Node) ? "preview" : "editor"
		}

		const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const
		for (const type of inputs)
			window.addEventListener(type, onInput, { capture: true, passive: true })
		window.addEventListener("scroll", onWindowScroll, { passive: true })
		scroller.addEventListener("scroll", onPaneScroll, { passive: true })
		window.addEventListener("resize", schedule)
		// A save redraws the preview, images load, a card opens: the leader's place stays put and
		// the follower finds it again.
		const resized = new ResizeObserver(schedule)
		resized.observe(main)
		if (scroller.firstElementChild) resized.observe(scroller.firstElementChild)
		schedule()
		return () => {
			cancelAnimationFrame(frame)
			for (const type of inputs) window.removeEventListener(type, onInput, { capture: true })
			window.removeEventListener("scroll", onWindowScroll)
			scroller.removeEventListener("scroll", onPaneScroll)
			window.removeEventListener("resize", schedule)
			resized.disconnect()
		}
	}, [editor, pane])
}
