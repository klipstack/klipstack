import { useTranslation } from "react-i18next"
import { pressSelect, useSelecting } from "~/lib/selection-mode"
import { cn } from "~/lib/utils"

/**
 * Select / Done for multi-select on phones, which have no hover to show the boxes. In the top bar
 * of the list views, and in the search page's chips row (there the top bar is the search field).
 */
export function SelectButton({ className }: { className?: string }) {
	const { t } = useTranslation()
	const selecting = useSelecting()
	return (
		<button
			type="button"
			onClick={pressSelect}
			className={cn(
				"shrink-0 rounded-md px-2.5 py-2 text-sm font-medium text-link hover:bg-hover",
				className,
			)}
		>
			{selecting ? t("actions.done") : t("actions.select")}
		</button>
	)
}
