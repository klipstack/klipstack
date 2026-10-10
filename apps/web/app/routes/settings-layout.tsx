import { Outlet } from "react-router"
import { ErrorContent } from "~/components/error-content"
import { SettingsShell } from "~/components/settings-shell"
import type { Route } from "./+types/settings-layout"

/** Settings in a frame of their own, instead of the app's. Each section signs in for itself. */
export default function SettingsLayout() {
	return (
		<SettingsShell>
			<Outlet />
		</SettingsShell>
	)
}

/** A failing section (offline, a crash) keeps the sections and the way back around it. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return (
		<SettingsShell>
			<ErrorContent error={error} />
		</SettingsShell>
	)
}
