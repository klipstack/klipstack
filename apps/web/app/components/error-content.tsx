import { Trans, useTranslation } from "react-i18next"
import { isRouteErrorResponse, Link, useRouteLoaderData } from "react-router"
import { useClientValue } from "~/hooks/use-client-value"
import type { loader as rootLoader } from "~/root"
import { BrandLogo } from "./brand-mark"

/**
 * The body of an error page: says "offline" when that is the reason, otherwise status or message.
 * `brand`: the page has no frame of its own (an unknown URL, a public page), so the logo leads home.
 */
export function ErrorContent({ error, brand = false }: { error: unknown; brand?: boolean }) {
	const { t } = useTranslation()
	const offline = useClientValue(() => !navigator.onLine, false)
	let message: string = t("errors.generic")
	let details: string = t("errors.unexpected")
	let stack: string | undefined

	if (offline) {
		message = t("errors.offline")
		details = t("errors.offlineDetail")
	} else if (isRouteErrorResponse(error)) {
		if (error.status === 404) return <NotFound brand={brand} />
		if (error.status === 410) {
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

/** A 404, set as an article that isn't there: its reading time, its headline, a line marked. */
function NotFound({ brand }: { brand: boolean }) {
	const { t } = useTranslation()
	const loggedIn = useRouteLoaderData<typeof rootLoader>("root")?.loggedIn ?? false
	return (
		<main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 md:py-20">
			{brand ? (
				<Link to="/" className="mb-12 inline-flex md:mb-20">
					<BrandLogo className="h-8 w-auto sm:h-9" markClassName="text-accent" />
				</Link>
			) : null}
			<p className="text-sm text-muted-fg">{t("errors.notFound.kicker")}</p>
			<h1 className="page-title mt-3 text-balance md:text-5xl md:leading-tight">
				{t("errors.notFound.title")}
			</h1>
			<p className="mt-5 text-lg text-muted-fg">
				<Trans
					t={t}
					i18nKey="errors.notFound.detail"
					components={{ mark: <mark className="marker swipe text-fg!" /> }}
				/>
			</p>
			<div className="mt-8 flex flex-wrap gap-3">
				{loggedIn ? (
					<>
						<Link
							to="/home"
							className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90"
						>
							{t("errors.notFound.home")}
						</Link>
						<Link
							to="/search"
							className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-hover"
						>
							{t("errors.notFound.search")}
						</Link>
					</>
				) : (
					<Link
						to="/"
						className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90"
					>
						{t("errors.notFound.landing")}
					</Link>
				)}
			</div>
		</main>
	)
}
