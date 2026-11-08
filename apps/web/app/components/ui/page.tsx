import type * as React from "react"
import { cn } from "~/lib/utils"

/**
 * The frame of a page in the app and in Settings: one width and one left edge for all of them, so
 * the title stays where it was going from page to page. `narrow` keeps the content at a reading
 * width against that same edge, rather than centring a narrower frame of its own.
 */
export function Page({
	narrow,
	className,
	...props
}: React.ComponentProps<"main"> & { narrow?: boolean }) {
	return (
		<main
			className={cn(
				"mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8",
				narrow && "*:max-w-2xl",
				className,
			)}
			{...props}
		/>
	)
}
