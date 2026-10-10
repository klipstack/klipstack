import type { UserPrefs } from "@klipstack/db"
import { LogOut, Monitor, Moon, Settings, ShieldCheck, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Form, useFetcher, useRouteLoaderData } from "react-router"
import { SETTINGS_HOME } from "~/lib/settings-origin"
import { cn } from "~/lib/utils"
import type { loader as rootLoader } from "~/root"
import type { loader as appLayoutLoader } from "~/routes/app-layout"
import { MenuNavLink, MenuRadio, MoreMenu } from "./more-menu"

type Theme = NonNullable<UserPrefs["theme"]>

const THEMES: Array<{ value: Theme; icon: typeof Sun }> = [
	{ value: "system", icon: Monitor },
	{ value: "light", icon: Sun },
	{ value: "dark", icon: Moon },
]

const isTheme = (value: unknown): value is Theme =>
	value === "system" || value === "light" || value === "dark"

export interface AccountUser {
	name: string
	email: string
}

/**
 * Who is signed in, and the few things that belong to them: the theme, settings, logging out. One
 * button at the foot of the sidebar, with the person's name; everything else lives in its menu.
 */
export function AccountMenu({
	user,
	collapsed = false,
	onNavigate,
}: {
	user: AccountUser
	/** Just the avatar, as a rail. */
	collapsed?: boolean
	onNavigate?: () => void
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher()
	const root = useRouteLoaderData<typeof rootLoader>("root")
	// Only a flag: the link is a convenience, and /admin checks the account again on every request.
	const isAdmin = useRouteLoaderData<typeof appLayoutLoader>("routes/app-layout")?.isAdmin === true
	const pending = fetcher.formData?.get("theme")
	const theme: Theme = isTheme(pending) ? pending : isTheme(root?.theme) ? root.theme : "system"
	// A name is required, but a sign-in provider may hand over a blank one.
	const name = user.name.trim() || user.email

	return (
		<MoreMenu
			label={t("nav.account", { name })}
			tooltipSide="right"
			className={cn(
				"flex items-center gap-2 text-left hover:bg-fg/10",
				collapsed ? "!p-0 mx-auto size-9 justify-center" : "!p-2 w-full",
			)}
			icon={
				<>
					<span
						aria-hidden
						className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg uppercase"
					>
						{[...name][0]}
					</span>
					{collapsed ? null : (
						<span className="min-w-0 flex-1 truncate text-sm text-muted-fg">{name}</span>
					)}
				</>
			}
		>
			{/* The name on the button; the address here, which tells two accounts apart. */}
			<p className="px-2 py-1.5 text-xs text-muted-fg" title={user.email}>
				{name === user.email ? null : (
					<span className="block truncate text-sm font-medium text-fg">{name}</span>
				)}
				<span className="block truncate">{user.email}</span>
			</p>
			<fieldset aria-label={t("theme.label")} className="my-1 border-border border-y py-1">
				{THEMES.map(({ value, icon: Icon }) => (
					<MenuRadio
						key={value}
						checked={theme === value}
						onSelect={() => fetcher.submit({ theme: value }, { method: "post", action: "/prefs" })}
						icon={<Icon className="size-4" aria-hidden />}
					>
						{t(`theme.${value}`)}
					</MenuRadio>
				))}
			</fieldset>
			<MenuNavLink to={SETTINGS_HOME} icon={<Settings className="size-4" aria-hidden />}>
				{t("nav.settings")}
			</MenuNavLink>
			{isAdmin ? (
				<MenuNavLink to="/admin" icon={<ShieldCheck className="size-4" aria-hidden />}>
					{t("nav.admin")}
				</MenuNavLink>
			) : null}
			<Form method="post" action="/logout" onSubmit={onNavigate}>
				<button
					type="submit"
					role="menuitem"
					className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-muted"
				>
					<LogOut className="size-4" aria-hidden />
					{t("nav.logout")}
				</button>
			</Form>
		</MoreMenu>
	)
}
