import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useNavigate } from "react-router"
import { showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"

/** Keep navigation in the page: saving can remove its card from Home before revalidation ends. */
export function useFeedReader(from: "/feed" | "/home") {
	const { t } = useTranslation("feed")
	const read = useFetcher<WebResult<{ read?: string }>>()
	const navigate = useNavigate()
	useEffect(() => {
		if (read.state !== "idle") return
		if (read.data?.ok && read.data.read)
			void navigate(`/read/${read.data.read}`, { state: { from } })
		else if (read.data?.ok === false) {
			const limit = read.data.error.code === "limit_reached"
			showToast({ message: t(limit ? "toast.saveLimit" : "toast.saveFailed") })
		}
	}, [read.state, read.data, navigate, from, t])
	return {
		onRead: (itemId: string) => {
			if (read.state === "idle")
				void read.submit({ intent: "save-read", itemId }, { method: "post", action: "/feed" })
		},
		readingId: read.state !== "idle" ? read.formData?.get("itemId") : null,
	}
}
