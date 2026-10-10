import { useEffect, useInsertionEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { alreadySaved, alreadySavedToast } from "~/lib/restore-conflict"
import { showToast } from "~/lib/toast"

/**
 * Shows the "already in your library" warning when a restore answer says so. Once per answer: a
 * language switch or a strings load must not bring back an old warning.
 */
export function useRestoreConflictToast(answer: unknown) {
	const { t } = useTranslation("library")
	const text = useRef({ message: t("toast.alreadySaved"), open: t("toast.openSaved") })
	useInsertionEffect(() => {
		text.current = { message: t("toast.alreadySaved"), open: t("toast.openSaved") }
	})
	useEffect(() => {
		const conflict = alreadySaved(answer)
		if (conflict) showToast(alreadySavedToast(conflict, text.current))
	}, [answer])
}
