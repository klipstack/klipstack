import { type RefObject, useEffect, useState } from "react"
import { createLinkPreviewCache } from "~/lib/link-preview-cache"

/** Fetch only after deliberate mouse hover (or keyboard focus), never on touch or page load. */
export function useLinkPreviews(rootRef: RefObject<HTMLElement | null>, enabled: boolean) {
	const [previews] = useState(createLinkPreviewCache)
	useEffect(() => {
		const root = rootRef.current
		if (!enabled || !root) return
		let timer: ReturnType<typeof setTimeout> | undefined
		const linkAt = (target: EventTarget | null) => {
			const link = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null
			return link &&
				root.contains(link) &&
				!link.getAttribute("href")?.startsWith("#") &&
				/^https?:/i.test(link.href)
				? link
				: null
		}
		const onOver = (event: PointerEvent) => {
			if (event.pointerType !== "mouse" || event.buttons) return
			const link = linkAt(event.target)
			if (!link || link === linkAt(event.relatedTarget)) return
			clearTimeout(timer)
			timer = setTimeout(() => previews.prefetch(link.href), 150)
		}
		const onOut = (event: PointerEvent) => {
			if (linkAt(event.target) !== linkAt(event.relatedTarget)) clearTimeout(timer)
		}
		const onFocus = (event: FocusEvent) => {
			const link = linkAt(event.target)
			if (link?.matches(":focus-visible")) previews.prefetch(link.href)
		}
		root.addEventListener("pointerover", onOver)
		root.addEventListener("pointerout", onOut)
		root.addEventListener("focusin", onFocus)
		return () => {
			clearTimeout(timer)
			root.removeEventListener("pointerover", onOver)
			root.removeEventListener("pointerout", onOut)
			root.removeEventListener("focusin", onFocus)
		}
	}, [rootRef, enabled, previews])
	return previews
}
