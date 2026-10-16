import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "~/lib/utils"

export const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				primary: "bg-accent text-accent-fg hover:opacity-90",
				secondary: "bg-muted text-fg hover:bg-border",
				ghost: "hover:bg-hover",
				link: "text-link underline-offset-4 hover:underline",
				danger: "bg-danger text-danger-fg hover:opacity-90",
			},
			size: {
				sm: "h-8 px-3",
				md: "h-10 px-4",
				lg: "h-11 px-6 text-base",
				icon: "h-9 w-9",
			},
		},
		defaultVariants: { variant: "primary", size: "md" },
	},
)

export interface ButtonProps
	extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
	return (
		// oxlint-disable-next-line react/button-has-type -- callers choose the type; it defaults to "button"
		<button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
	)
}
