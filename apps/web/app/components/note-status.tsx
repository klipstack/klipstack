import type { NoteSaveStatus } from "@klipstack/sdk/note-autosave"
import { useTranslation } from "react-i18next"

/** Where an autosaved note stands: saving, saved, or not saved with a Retry. */
export function NoteStatus({ status, onRetry }: { status: NoteSaveStatus; onRetry: () => void }) {
	const { t } = useTranslation("reader")
	if (status === "saving")
		return <span className="text-muted-fg">{t("highlights.sidebar.noteSaving")}</span>
	if (status === "saved")
		return <span className="text-muted-fg">{t("highlights.sidebar.noteSaved")}</span>
	if (status === "error")
		return (
			<span role="alert" className="text-danger">
				{t("highlights.sidebar.noteFailed")} ·{" "}
				<button type="button" onClick={onRetry} className="text-link underline">
					{t("highlights.sidebar.noteRetry")}
				</button>
			</span>
		)
	return null
}

/** Who reads the article's note: the reader alone, unlike the note for an edition's readers. */
export function ArticleNoteLabel() {
	const { t } = useTranslation("reader")
	return (
		<span className="font-medium text-muted-fg">
			{t("highlights.sidebar.note")}
			<span className="font-normal"> · {t("highlights.sidebar.noteOnlyYou")}</span>
		</span>
	)
}
