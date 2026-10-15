import { X } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, useRouteLoaderData } from "react-router"
import { ShortcutList } from "~/components/shortcut-list"
import type { loader as rootLoader } from "~/root"

/**
 * The reader's keyboard shortcuts, in a modal: `?` or the top bar's button opens it. While it is
 * open the page's keys wait (a modal owns the keyboard: lib/shortcuts.ts).
 */
export function ShortcutsDialog({
	open,
	ai,
	onClose,
}: {
	open: boolean
	ai: boolean
	onClose: () => void
}) {
	const { t } = useTranslation("common")
	const ref = useRef<HTMLDialogElement>(null)
	const off = useRouteLoaderData<typeof rootLoader>("root")?.shortcutsOff ?? false
	useEffect(() => {
		const dialog = ref.current
		if (!dialog) return
		if (open && !dialog.open) dialog.showModal()
		if (!open && dialog.open) dialog.close()
	}, [open])
	return (
		<dialog
			ref={ref}
			aria-labelledby="shortcuts-title"
			onClose={onClose}
			onClick={(e) => {
				if (e.target === ref.current) onClose()
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose()
			}}
			className="m-auto max-h-[85vh] w-[min(30rem,92vw)] overflow-y-auto rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
		>
			{open ? (
				<div className="flex flex-col gap-4 p-6">
					<div className="flex items-start justify-between gap-4">
						<h2 id="shortcuts-title" className="text-lg font-semibold">
							{t("shortcuts.title")}
						</h2>
						<button
							type="button"
							onClick={onClose}
							className="-m-1 rounded-md p-1.5 text-muted-fg hover:bg-muted"
							aria-label={t("actions.close")}
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>
					{off ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-sm">
							{t("shortcuts.off")}{" "}
							<Link to="/settings/shortcuts" className="underline">
								{t("shortcuts.turnOn")}
							</Link>
						</p>
					) : null}
					<ShortcutList groups={["reader", "general"]} ai={ai} off={off} compact />
					<Link to="/settings/shortcuts" className="text-sm text-accent underline">
						{t("shortcuts.all")}
					</Link>
				</div>
			) : null}
		</dialog>
	)
}
