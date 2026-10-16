import { ArrowLeft } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, isRouteErrorResponse, Link, NavLink, Outlet, useLocation } from "react-router"
import { ErrorContent } from "~/components/error-content"
import { Button } from "~/components/ui/button"
import { useClientValue } from "~/hooks/use-client-value"
import { ensureAdminSafeWorker } from "~/lib/admin-freshness.client"
import { requireAdmin, signedInRecently } from "~/lib/admin.server"
import { pageTitle } from "~/lib/page-title"
import { cn } from "~/lib/utils"
import type { Route } from "./+types/admin-layout"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "common:nav.admin") }, { name: "robots", content: "noindex" }]
}

/** Each admin route checks for itself as well: this check alone would guard only the frame. */
export async function loader({ context, request }: Route.LoaderArgs) {
	const ctx = await requireAdmin(context, request)
	return { canWrite: signedInRecently(ctx) }
}

/** The write window closes while a page stays open: ask again on every navigation. */
export function shouldRevalidate() {
	return true
}

const SECTIONS = [
	{ to: "/admin", key: "overview", end: true },
	{ to: "/admin/invites", key: "invites", end: false },
	{ to: "/admin/requests", key: "requests", end: false },
	{ to: "/admin/reports", key: "reports", end: false },
	{ to: "/admin/users", key: "users", end: false },
	{ to: "/admin/usage", key: "usage", end: false },
	{ to: "/admin/jobs", key: "jobs", end: false },
	{ to: "/admin/system", key: "system", end: false },
	{ to: "/admin/audit", key: "audit", end: false },
] as const

function SignInAgain() {
	const { t } = useTranslation("admin")
	const { pathname, search } = useLocation()
	return (
		<Form method="post" action="/admin/reauthenticate" reloadDocument>
			<input type="hidden" name="returnTo" value={pathname + search} />
			<Button type="submit" size="sm">
				{t("reauth.submit")}
			</Button>
		</Form>
	)
}

function Frame({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation("admin")
	return (
		<div className="flex min-h-dvh flex-col bg-bg text-fg">
			<header className="border-border border-b bg-card">
				<div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
					<Link
						to="/library"
						prefetch="none"
						className="flex items-center gap-1 text-sm text-link hover:underline"
					>
						<ArrowLeft className="size-4" aria-hidden />
						{t("backToLibrary")}
					</Link>
					<span
						className="rounded-md bg-danger px-2 py-0.5 text-xs font-semibold text-danger-fg uppercase tracking-wide"
						data-testid="admin-label"
					>
						{t("label")}
					</span>
				</div>
				<nav
					aria-label={t("nav.label")}
					className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-2 pb-2"
				>
					{SECTIONS.map(({ to, key, end }) => (
						<NavLink
							key={key}
							to={to}
							end={end}
							prefetch="none"
							className={({ isActive }) =>
								cn(
									"whitespace-nowrap rounded-md px-3 py-1.5 text-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									isActive ? "bg-muted font-medium text-fg" : "text-muted-fg",
								)
							}
						>
							{t(`nav.${key}`)}
						</NavLink>
					))}
				</nav>
			</header>
			<main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
		</div>
	)
}

/**
 * Admin data is shown only fresh from the network: a page restored from the back/forward cache is
 * reloaded, going offline replaces the page, and a service worker from before this release is
 * updated first (see admin-freshness.client.ts). Logout and account changes already reload every
 * tab (offline.client.ts).
 */
function useFreshOnly() {
	const [state, setState] = useState<"ok" | "checking" | "failed" | "offline">("ok")
	// Already offline when the page opened. It stays that way: coming back online reloads the page.
	const offlineNow = useClientValue(() => !navigator.onLine, false)
	if (offlineNow && state !== "offline") setState("offline")
	useEffect(() => {
		let live = true
		const onShow = (event: PageTransitionEvent) => {
			if (event.persisted) window.location.reload()
		}
		const onOffline = () => setState("offline")
		const onOnline = () => window.location.reload()
		window.addEventListener("pageshow", onShow)
		window.addEventListener("offline", onOffline)
		window.addEventListener("online", onOnline)
		if (navigator.serviceWorker?.controller) {
			void ensureAdminSafeWorker().then((gate) => {
				if (!live) return
				if (gate === "updated") window.location.reload()
				else if (gate === "failed") setState("failed")
			})
		}
		return () => {
			live = false
			window.removeEventListener("pageshow", onShow)
			window.removeEventListener("offline", onOffline)
			window.removeEventListener("online", onOnline)
		}
	}, [])
	return state
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation("admin")
	const fresh = useFreshOnly()
	if (fresh === "offline" || fresh === "failed")
		return (
			<Frame>
				<h1 className="text-2xl font-semibold">
					{fresh === "offline" ? t("errors.offline") : t("errors.updateFailed")}
				</h1>
				{fresh === "offline" ? (
					<p className="mt-2 text-muted-fg">{t("errors.offlineDetail")}</p>
				) : null}
			</Frame>
		)
	return (
		<Frame>
			{loaderData.canWrite ? null : (
				<section
					className="mb-6 rounded-xl border border-accent/30 bg-card p-4"
					aria-labelledby="reauth-title"
					data-testid="reauth-banner"
				>
					<h2 id="reauth-title" className="font-semibold">
						{t("reauth.title")}
					</h2>
					<p className="mt-1 mb-3 text-sm text-muted-fg">{t("reauth.description")}</p>
					<SignInAgain />
				</section>
			)}
			<Outlet context={{ canWrite: loaderData.canWrite } satisfies AdminOutletContext} />
		</Frame>
	)
}

export interface AdminOutletContext {
	canWrite: boolean
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	const { t } = useTranslation("admin")
	const code =
		isRouteErrorResponse(error) && typeof error.data?.error === "string" ? error.data.error : null
	if (code === "reauthentication_required")
		return (
			<Frame>
				<h1 className="text-2xl font-semibold">{t("reauth.title")}</h1>
				<p className="mt-2 mb-4 text-muted-fg">{t("reauth.required")}</p>
				<SignInAgain />
			</Frame>
		)
	if (isRouteErrorResponse(error) && error.status === 403)
		return (
			<main className="mx-auto w-full max-w-2xl flex-1 p-8">
				<h1 className="text-2xl font-semibold">{t("errors.forbidden")}</h1>
				<p className="mt-2 text-muted-fg">{t("errors.forbiddenDetail")}</p>
				<Link to="/library" className="mt-4 inline-block text-link hover:underline">
					{t("backToLibrary")}
				</Link>
			</main>
		)
	return <ErrorContent error={error} />
}
