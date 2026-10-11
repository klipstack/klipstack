import { useCallback, useEffect, useInsertionEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { showToast } from "~/lib/toast"

/** What unmarking answers when it took the article out of the draft in progress. */
type DraftUndo = { undo: { intent: string; fields: Record<string, string> } }

function draftUndo(answer: unknown): DraftUndo["undo"] | null {
	if (!answer || typeof answer !== "object" || !("undo" in answer)) return null
	const { undo } = answer as Partial<DraftUndo>
	return undo && typeof undo.intent === "string" ? undo : null
}

/**
 * The toast after unmarking took an article out of the draft in progress: its copy there may hold
 * the user's edits, and Undo puts it back as it was. `show(answer)` for one answer at a time; the
 * hook's argument, for a fetcher's latest. Once per answer.
 */
export function useDraftUndoToast(answer?: unknown) {
	const { t } = useTranslation("library")
	const text = useRef({ message: t("toast.unshortlisted"), label: t("toast.undo") })
	useInsertionEffect(() => {
		text.current = { message: t("toast.unshortlisted"), label: t("toast.undo") }
	})
	const show = useCallback((value: unknown) => {
		const undo = draftUndo(value)
		if (!undo) return
		showToast({
			message: text.current.message,
			undo: { action: "/documents/bulk", ...undo, label: text.current.label },
		})
	}, [])
	useEffect(() => {
		show(answer)
	}, [answer, show])
	return show
}
