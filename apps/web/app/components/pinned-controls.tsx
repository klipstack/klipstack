import { useEffect, useRef, useState } from "react"
import { cn } from "~/lib/utils"

/**
 * Keeps a list view's filter row pinned while the list scrolls. Desktop: at the top of the window,
 * and once the page title has scrolled away the view's name slides into the row. Phones: under the
 * top bar (which already names the view), hiding and returning with it.
 */
export function PinnedControls({ title, children }: { title: string; children: React.ReactNode }) {
	const sentinelRef = useRef<HTMLDivElement>(null)
	const [stuck, setStuck] = useState(false)
	useEffect(() => {
		const el = sentinelRef.current
		if (!el) return
		const observer = new IntersectionObserver(([entry]) => {
			if (entry) setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0)
		})
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	return (
		<>
			<div ref={sentinelRef} aria-hidden className="h-px" />
			<div
				className={cn(
					// Phones: pinned under the floating top bar (sticky offsets start inside the scroll box's
					// padding, which is the bar's height), and slides away with it.
					"-mx-4 sticky top-0 z-10 bg-bg/90 px-4 backdrop-blur transition-transform duration-200 group-data-bar-hidden/shell:-translate-y-[calc(100%+var(--bar-h,3.5rem))]",
					"md:mt-2 md:border-b md:py-2 md:transition-colors",
					stuck ? "md:border-border" : "md:border-transparent",
				)}
			>
				<div className="flex items-center">
					<p
						aria-hidden
						className={cn(
							"hidden shrink-0 truncate text-sm font-semibold transition-all duration-200 md:block",
							stuck ? "mr-3 max-w-48 opacity-100" : "max-w-0 opacity-0",
						)}
					>
						{title}
					</p>
					<div className="min-w-0 flex-1">{children}</div>
				</div>
			</div>
		</>
	)
}
