import type { UserPrefs } from "@klipstack/db"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useFetcher, useRouteLoaderData } from "react-router"
import { cn } from "~/lib/utils"
import type { loader as rootLoader } from "~/root"
import { tooltip } from "./tooltip-host"

type Theme = NonNullable<UserPrefs["theme"]>

const OPTIONS: Array<{ value: Theme; icon: typeof Sun }> = [
	{ value: "system", icon: Monitor },
	{ value: "light", icon: Sun },
	{ value: "dark", icon: Moon },
]

function isTheme(value: unknown): value is Theme {
	return value === "system" || value === "light" || value === "dark"
}

/**
 * System / Light / Dark. Saves to the user's prefs; the root loader revalidates and sets
 * `data-theme` on <html>, so the choice applies everywhere at once. "System" removes the
 * override and lets `prefers-color-scheme` decide.
 */
export function ThemePicker({
	compact = false,
	className,
}: {
	compact?: boolean
	className?: string
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher()
	const root = useRouteLoaderData<typeof rootLoader>("root")
	const pending = fetcher.formData?.get("theme")
	const current: Theme = isTheme(pending) ? pending : isTheme(root?.theme) ? root.theme : "system"

	return (
		<fieldset
			className={cn("flex gap-1 rounded-lg bg-muted p-1", className)}
			aria-label={t("theme.label")}
		>
			{OPTIONS.map(({ value, icon: Icon }) => (
				<button
					key={value}
					type="button"
					onClick={() => fetcher.submit({ theme: value }, { method: "post", action: "/prefs" })}
					aria-pressed={current === value}
					aria-label={compact ? t(`theme.${value}`) : undefined}
					{...(compact ? tooltip(t(`theme.${value}`)) : {})}
					className={cn(
						"flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-sm",
						compact ? "px-2" : "px-3",
						current === value
							? "bg-selected text-selected-fg shadow-xs"
							: "text-muted-fg hover:text-fg",
					)}
				>
					<Icon className="size-4" aria-hidden />
					{compact ? null : t(`theme.${value}`)}
				</button>
			))}
		</fieldset>
	)
}
