import { useTranslation } from "react-i18next"
import { useQuestionsLeft } from "~/hooks/use-ai-allowance"
import { cn } from "~/lib/utils"
import { ASK_AI_ICON } from "./ai-card"
import { TOOLBAR_LABEL_BUTTON } from "./reader-toolbar"
import { tooltip } from "./tooltip-host"

/**
 * Ask AI, in a reader toolbar: it opens a draft about the passage, where the reader chooses
 * Explain, Define or a question of their own. With no questions left this month it stays, dimmed:
 * pressing it opens the card that says why.
 */
export function AiToolbarButtons({ onAsk, disabled }: { onAsk: () => void; disabled?: boolean }) {
	const { t } = useTranslation("reader")
	const { none } = useQuestionsLeft()
	return (
		<>
			<span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
			<button
				type="button"
				disabled={disabled}
				onClick={onAsk}
				{...(none ? tooltip(t("ai.noneLeft")) : {})}
				data-none-left={none || undefined}
				className={cn(TOOLBAR_LABEL_BUTTON, none && "opacity-50")}
			>
				<ASK_AI_ICON className="size-4" aria-hidden />
				{t("ai.askAi")}
			</button>
		</>
	)
}
