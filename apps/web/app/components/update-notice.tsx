import { RefreshCw, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { checkAppVersion, useAppVersion } from "~/lib/app-version"

/** The newer version this tab was told about and closed the notice for. */
const DISMISSED = "update-notice-dismissed"

// Storage can be unavailable (on the server, in private windows): the notice then closes until the
// page reloads. Nothing shows before hydration, so reading it on the first render is safe.
function stored(): string | null {
	try {
		return sessionStorage.getItem(DISMISSED)
	} catch {
		return null
	}
}

/**
 * Tells the reader a newer version of the app is live, and offers to reload. It stays until they
 * reload or close it; closed, it is back only for the version after that. It never reloads by
 * itself: a note may be half written. Mounted once, in the toast host, so the two stack.
 */
export function UpdateNotice() {
	const { t } = useTranslation()
	const { newer } = useAppVersion()
	const { pathname } = useLocation()
	const [dismissed, setDismissed] = useState(stored)

	useEffect(() => {
		document.addEventListener("visibilitychange", checkAppVersion)
		return () => document.removeEventListener("visibilitychange", checkAppVersion)
	}, [])
	// On load and on each navigation; checkAppVersion keeps to one request every few minutes.
	useEffect(() => void checkAppVersion(), [pathname])

	if (!newer || newer === dismissed) return null
	const close = () => {
		try {
			sessionStorage.setItem(DISMISSED, newer)
		} catch {}
		setDismissed(newer)
	}
	return (
		<div
			role="status"
			className="pointer-events-auto flex items-center gap-3 rounded-full bg-fg py-2 pr-2 pl-4 text-sm text-bg shadow-lg"
		>
			<RefreshCw className="size-4 shrink-0" aria-hidden />
			<span>{t("updateNotice.message")}</span>
			<button
				type="button"
				onClick={() => window.location.reload()}
				className="rounded-full px-2 py-1 font-semibold text-link-inverse underline-offset-2 hover:underline focus-visible:outline-link-inverse"
			>
				{t("updateNotice.reload")}
			</button>
			<button
				type="button"
				onClick={close}
				aria-label={t("actions.close")}
				className="rounded-full p-1.5 text-bg/70 hover:bg-bg/10 hover:text-bg focus-visible:outline-link-inverse"
			>
				<X className="size-4" aria-hidden />
			</button>
		</div>
	)
}
