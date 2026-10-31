import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	type ShouldRevalidateFunctionArgs,
	useLocation,
	useMatches,
	useRouteLoaderData,
} from "react-router"
import type { Route } from "./+types/root"
import "@fontsource-variable/newsreader"
import "./app.css"
import { CommandPalette } from "./components/command-palette"
import { ErrorContent } from "./components/error-content"
import { NavigationProgress } from "./components/navigation-progress"
import { PasteToSave } from "./components/paste-to-save"
import { ToastHost } from "./components/toast-host"
import { TooltipHost } from "./components/tooltip-host"
import { useFreshDocumentOnLeave } from "./hooks/use-fresh-document"
import { useLiveUpdates } from "./hooks/use-live-updates"
import { useStandaloneTitle } from "./hooks/use-standalone-title"
import { cacheIdentity } from "./lib/cache-identity.server"
import { appVersion } from "./lib/env.server"
import { getInstance, getLocale, i18nextMiddleware, localeVersion } from "./lib/i18n.server"
import { parseLayoutCookie } from "./lib/list-layout"
import { PAGE_TITLES } from "./lib/page-title"
import { getSession, getUser, sessionMiddleware } from "./lib/session.server"
import { useRememberSettingsOrigin } from "./lib/settings-origin"
import { parseSidebarCookie } from "./lib/sidebar"

export const middleware: Route.MiddlewareFunction[] = [sessionMiddleware, i18nextMiddleware]

export const links: Route.LinksFunction = () => [
	{ rel: "icon", type: "image/svg+xml", href: "/icons/favicon.svg?v=2" },
	{ rel: "icon", href: "/favicon.ico?v=2", sizes: "48x48" },
	{ rel: "icon", type: "image/png", sizes: "32x32", href: "/icons/favicon-32.png?v=2" },
	{ rel: "icon", type: "image/png", sizes: "16x16", href: "/icons/favicon-16.png?v=2" },
	{ rel: "apple-touch-icon", sizes: "180x180", href: "/icons/apple-touch-icon.png?v=2" },
	{ rel: "manifest", href: "/manifest.webmanifest" },
]

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = getUser(context)
	const prefs = user?.prefs as { theme?: string; shortcuts?: string } | undefined
	const theme = prefs?.theme
	const i18n = getInstance(context)
	return {
		shortcutsOff: prefs?.shortcuts === "off",
		version: appVersion,
		locale: getLocale(context),
		localeVersion,
		layout: parseLayoutCookie(request.headers.get("cookie")),
		sidebar: parseSidebarCookie(request.headers.get("cookie")),
		theme: theme === "light" || theme === "dark" ? theme : null,
		loggedIn: Boolean(user),
		cacheIdentity: cacheIdentity(getSession(context)?.session.id),
		titles: Object.fromEntries(PAGE_TITLES.map((key) => [key, i18n.t(key)])),
	}
}

/** A route's `handle` for a page in another language than the reader's, from its loader data. */
export interface PageLanguage {
	lang: (loaderData: unknown) => string | undefined
}

/** Session, theme and locale only change through actions; skip the round trip otherwise. */
export function shouldRevalidate({
	formMethod,
	defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
	return formMethod ? defaultShouldRevalidate : false
}

export function Layout({ children }: { children: React.ReactNode }) {
	// Clear badges left by earlier versions, even when the reader is signed out.
	useEffect(() => {
		const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
		void nav.clearAppBadge?.().catch(() => undefined)
	}, [])
	const { i18n } = useTranslation()
	const root = useRouteLoaderData<typeof loader>("root")
	const { search } = useLocation()
	const lang =
		useMatches()
			.map((match) => (match.handle as Partial<PageLanguage> | undefined)?.lang?.(match.loaderData))
			.findLast(Boolean) ?? i18n.language
	// Local previews can override appearance without changing the account or device preference.
	const previewTheme = import.meta.env.DEV ? new URLSearchParams(search).get("theme") : null
	const theme = previewTheme === "light" || previewTheme === "dark" ? previewTheme : root?.theme
	return (
		<html
			lang={lang}
			dir={i18n.dir(lang)}
			data-theme={theme ?? undefined}
			// Read by ~/lib/shortcuts, which runs outside React.
			data-shortcuts={root?.shortcutsOff ? "off" : undefined}
		>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
				<meta name="locale-version" content={root?.localeVersion ?? ""} />
				<meta name="app-version" content={root?.version ?? ""} />
				<meta name="cache-identity" content={root?.cacheIdentity ?? "none"} />
				<meta name="application-name" content="Klipstack" />
				<meta name="apple-mobile-web-app-title" content="Klipstack" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-status-bar-style" content="default" />
				<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfaf7" />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1a1511" />
				<Meta />
				{/* Stylesheets and preloads need no nonce (the policy limits scripts only). The browser
				    hides a nonce from the client, whose render would then not match the server's. */}
				<Links nonce="" />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	)
}

export default function App({ loaderData: { locale, loggedIn } }: Route.ComponentProps) {
	const { i18n } = useTranslation()
	useEffect(() => {
		if (i18n.language !== locale) void i18n.changeLanguage(locale)
	}, [locale, i18n])
	useEffect(() => {
		// Lets tests and progressive enhancements know client JS is live.
		document.documentElement.dataset.hydrated = "1"
	}, [])
	useLiveUpdates(loggedIn)
	useStandaloneTitle()
	useRememberSettingsOrigin()
	useFreshDocumentOnLeave()
	return (
		<>
			<NavigationProgress />
			<Outlet />
			{loggedIn ? <CommandPalette /> : null}
			{loggedIn ? <PasteToSave /> : null}
			<ToastHost />
			<TooltipHost />
		</>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <ErrorContent error={error} brand />
}
