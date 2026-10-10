import { useTranslation } from "react-i18next"
import { isRouteErrorResponse } from "react-router"
import { useClientValue } from "~/hooks/use-client-value"

/** The body of an error page: says "offline" when that is the reason, otherwise status or message. */
export function ErrorContent({ error }: { error: unknown }) {
	const { t } = useTranslation()
	const offline = useClientValue(() => !navigator.onLine, false)
	let message: string = t("errors.generic")
	let details: string = t("errors.unexpected")
	let stack: string | undefined

	if (offline) {
		message = t("errors.offline")
		details = t("errors.offlineDetail")
	} else if (isRouteErrorResponse(error)) {
		if (error.status === 404) {
			message = t("errors.notFound")
			details = t("errors.notFoundDetail")
		} else if (error.status === 410) {
			message = t("errors.gone")
			const removed = (error.data as { removed?: unknown } | null)?.removed === true
			details = t(removed ? "errors.goneRemoved" : "errors.goneDetail")
		} else {
			message = `${error.status}`
			details = error.statusText || details
		}
	} else if (import.meta.env.DEV && error instanceof Error) {
		details = error.message
		stack = error.stack
	}

	return (
		<main className="mx-auto w-full max-w-2xl flex-1 p-8">
			<h1 className="text-2xl font-semibold">{message}</h1>
			<p className="mt-2 text-muted-fg">{details}</p>
			{stack ? (
				<pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 text-xs">
					<code>{stack}</code>
				</pre>
			) : null}
		</main>
	)
}
