import type { AiThreadAction } from "@klipstack/db"
import { useTranslation } from "react-i18next"
import { useQuestionsLeft } from "~/hooks/use-ai-allowance"
import { cn } from "~/lib/utils"
import { AI_ACTION_ICONS } from "./ai-card"
import { TOOLBAR_LABEL_BUTTON } from "./reader-toolbar"
import { tooltip } from "./tooltip-host"

/**
 * Explain, Define and Ask, in a reader toolbar. With no questions left this month they stay, dimmed:
 * pressing one opens the card that says why.
 */
export function AiToolbarButtons({
	onAsk,
	disabled,
}: {
	onAsk: (action: AiThreadAction) => void
	disabled?: boolean
}) {
	const { t } = useTranslation("reader")
	const { none } = useQuestionsLeft()
	return (
		<>
			<span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
			{(["explain", "define", "ask"] as const).map((action) => {
				const Icon = AI_ACTION_ICONS[action]
				return (
					<button
						key={action}
						type="button"
						disabled={disabled}
						onClick={() => onAsk(action)}
						{...(none ? tooltip(t("ai.noneLeft")) : {})}
						data-none-left={none || undefined}
						className={cn(TOOLBAR_LABEL_BUTTON, none && "opacity-50")}
					>
						<Icon className="size-4" aria-hidden />
						{t(`ai.actions.${action}`)}
					</button>
				)
			})}
		</>
	)
}
