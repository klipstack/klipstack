import type { UserPrefs } from "@klipstack/db"
import { ALargeSmall } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"

type Prefs = Required<UserPrefs>

const SIZE_LABEL: Record<Prefs["fontSize"], string> = { sm: "A-", md: "A", lg: "A+", xl: "A++" }

export function ReaderPrefs({
	prefs,
	onChange,
}: {
	prefs: Prefs
	onChange: (next: Prefs) => void
}) {
	const { t } = useTranslation("reader")
	const { t: tc } = useTranslation()
	const fetcher = useFetcher()
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!open) return
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("pointerdown", onDown)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown)
			document.removeEventListener("keydown", onKey)
		}
	}, [open])

	function set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
		const next = { ...prefs, [key]: value }
		onChange(next)
		fetcher.submit({ [key]: value }, { method: "post", action: "/prefs" })
	}

	/** One row of choices for a preference: `label` names each value. */
	function group<K extends keyof Prefs>(
		key: K,
		title: string,
		values: readonly Prefs[K][],
		label: (value: Prefs[K]) => string,
	) {
		return (
			<fieldset key={key} className="mb-3 last:mb-0">
				<legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-fg">
					{title}
				</legend>
				<div className="flex gap-1 rounded-lg bg-muted p-1">
					{values.map((v) => (
						<button
							key={v}
							type="button"
							onClick={() => set(key, v)}
							aria-pressed={prefs[key] === v}
							className={cn(
								"flex-1 rounded-md px-2 py-1 text-sm",
								prefs[key] === v
									? "bg-card text-fg shadow-xs outline-1 outline-border"
									: "text-muted-fg hover:text-fg",
							)}
						>
							{label(v)}
						</button>
					))}
				</div>
			</fieldset>
		)
	}

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				aria-haspopup="dialog"
				{...tooltip(t("actions.prefs"))}
				aria-label={t("actions.prefs")}
				className="rounded-md p-2 text-muted-fg hover:bg-hover hover:text-fg"
			>
				<ALargeSmall className="size-5" aria-hidden />
			</button>
			{open ? (
				<div
					role="dialog"
					aria-label={t("prefs.title")}
					className="absolute left-0 z-20 mt-2 w-64 rounded-xl border border-border bg-card p-3 shadow-lg"
				>
					{group("font", t("prefs.font"), ["serif", "sans", "dyslexic"], (v) => t(`prefs.${v}`))}
					{group("fontSize", t("prefs.size"), ["sm", "md", "lg", "xl"], (v) => SIZE_LABEL[v])}
					{group("width", t("prefs.width"), ["narrow", "normal", "wide"], (v) => t(`prefs.${v}`))}
					{group("theme", t("prefs.theme"), ["system", "light", "dark"], (v) => tc(`theme.${v}`))}
				</div>
			) : null}
		</div>
	)
}
