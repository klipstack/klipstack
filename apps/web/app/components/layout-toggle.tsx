import { LayoutGrid, List } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useMediaQuery } from "~/hooks/use-media-query"
import { setListLayout, useListLayout } from "~/lib/list-layout"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"

/** Switches list views between the vertical list and the grid; labels say what you will get. */
export function LayoutToggle({ className }: { className?: string }) {
	const { t } = useTranslation("library")
	const pref = useListLayout()
	const wide = useMediaQuery("(min-width: 768px)")
	const effective = pref === "auto" ? (wide ? "list" : "grid") : pref
	const next = effective === "grid" ? "list" : "grid"
	const label = t(`layout.${next}`)
	return (
		<button
			type="button"
			onClick={() => setListLayout(next)}
			aria-label={label}
			{...tooltip(label)}
			data-testid="layout-toggle"
			className={cn("rounded-md p-2.5 text-muted-fg hover:bg-hover hover:text-fg", className)}
		>
			{next === "grid" ? (
				<LayoutGrid className="size-5" aria-hidden />
			) : (
				<List className="size-5" aria-hidden />
			)}
		</button>
	)
}
