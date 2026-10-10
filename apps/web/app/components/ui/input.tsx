import type * as React from "react"
import { cn } from "~/lib/utils"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			className={cn(
				"flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg shadow-xs placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	)
}
