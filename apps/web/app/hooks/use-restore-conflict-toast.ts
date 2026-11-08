import { useTranslation } from "react-i18next"
import { useFetcherAnswer } from "~/hooks/use-fetcher-answer"
import { alreadySaved, alreadySavedToast } from "~/lib/restore-conflict"
import { showToast } from "~/lib/toast"

/**
 * Shows the "already in your library" warning when a restore answer says so. Once per answer: a
 * language switch or a strings load must not bring back an old warning.
 */
export function useRestoreConflictToast(fetcher: { state: string; data: unknown }) {
	const { t } = useTranslation("library")
	useFetcherAnswer(fetcher, (answer) => {
		const conflict = alreadySaved(answer)
		if (conflict)
			showToast(
				alreadySavedToast(conflict, {
					message: t("toast.alreadySaved"),
					open: t("toast.openSaved"),
				}),
			)
	})
}
