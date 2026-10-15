import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/** Our own utilities that set what Tailwind's do: a later one replaces the classes it overrides. */
const twMerge = extendTailwindMerge<"chip">({
	extend: {
		// `chip` (app.css) sets its padding and corners: a button's own give way to it.
		classGroups: { chip: ["chip"] },
		conflictingClassGroups: { chip: ["p", "px", "py", "pt", "pr", "pb", "pl", "rounded"] },
	},
})

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}
