import type * as React from "react"
import { cn } from "~/lib/utils"

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
	// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- htmlFor is passed by callers
	return <label className={cn("text-sm font-medium leading-none", className)} {...props} />
}
