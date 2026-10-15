import { useEffect, useEffectEvent } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useLocation } from "react-router"
import { prepareMotion } from "~/lib/motion"
import { saveErrorKey } from "~/lib/save-errors"
import { pastedLink } from "~/lib/shortcuts"
import { showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"

type Saved = WebResult<{ saved: true; id: string; created: boolean }>

/**
 * ⌘V / Ctrl+V anywhere in the app, outside a field: a link alone on the clipboard is saved, as the
 * Save link dialog saves it (the library's action), and a toast offers to open it or undo.
 */
export function PasteToSave() {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<Saved>()
	const location = useLocation()
	const submit = fetcher.submit
	useEffect(() => {
		const onPaste = (e: ClipboardEvent) => {
			const url = pastedLink(e)
			if (!url) return
			e.preventDefault()
			prepareMotion()
			void submit({ url }, { method: "post", action: "/library" })
		}
		document.addEventListener("paste", onPaste)
		return () => document.removeEventListener("paste", onPaste)
	}, [submit])

	const onAnswer = useEffectEvent((answer: Saved | undefined) => {
		if (!answer) return
		if (!answer.ok) {
			showToast({ message: t(saveErrorKey(answer.error)), warn: true })
			return
		}
		const open = { label: t("add.open"), to: `/read/${answer.id}` }
		if (!answer.created) {
			showToast({ message: t("add.already"), link: open })
			return
		}
		showToast({
			message: t("add.saved"),
			link: open,
			// As the dialog: the library's first page shows the new card come in; anywhere else, the clip.
			clip: location.pathname !== "/library" || location.search !== "",
			undo: {
				action: `/documents/${answer.id}/state`,
				intent: "delete",
				label: t("toast.undo"),
			},
		})
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])
	return null
}
