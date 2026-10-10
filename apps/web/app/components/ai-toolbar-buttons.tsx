import type { AiThreadAction } from "@klipstack/db"
import { useTranslation } from "react-i18next"
import { AI_ACTION_ICONS } from "./ai-card"
import { TOOLBAR_LABEL_BUTTON } from "./reader-toolbar"

/** Explain, Define and Ask, in a reader toolbar. */
export function AiToolbarButtons({
	onAsk,
	disabled,
}: {
	onAsk: (action: AiThreadAction) => void
	disabled?: boolean
}) {
	const { t } = useTranslation("reader")
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
						className={TOOLBAR_LABEL_BUTTON}
					>
						<Icon className="size-4" aria-hidden />
						{t(`ai.actions.${action}`)}
					</button>
				)
			})}
		</>
	)
}
