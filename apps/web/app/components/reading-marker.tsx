import { useLayoutEffect, useState } from "react"

/**
 * The bar in the gutter beside the paragraph read from the keyboard (`useReadingCursor`). Placed
 * inside the article, which is positioned, and placed again whenever the article's size changes.
 */
export function ReadingMarker({
	paragraph,
	articleRef,
	contentRef,
}: {
	paragraph: Range
	articleRef: React.RefObject<HTMLElement | null>
	contentRef: React.RefObject<HTMLElement | null>
}) {
	const [place, setPlace] = useState<{ top: number; left: number; height: number } | null>(null)
	useLayoutEffect(() => {
		const article = articleRef.current
		const content = contentRef.current
		if (!article || !content) return
		const measure = () => {
			const box = article.getBoundingClientRect()
			const rect = paragraph.getBoundingClientRect()
			const left = content.getBoundingClientRect().left - box.left
			setPlace({ top: rect.top - box.top, left: left - 14, height: rect.height })
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(article)
		return () => observer.disconnect()
	}, [paragraph, articleRef, contentRef])
	if (!place) return null
	return (
		<div
			aria-hidden
			data-testid="reading-marker"
			className="pointer-events-none absolute w-[3px] rounded-full bg-accent transition-[top,height] duration-150 motion-reduce:transition-none"
			style={place}
		/>
	)
}
