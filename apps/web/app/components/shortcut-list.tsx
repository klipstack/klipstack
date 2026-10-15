import { useId } from "react"
import { useTranslation } from "react-i18next"
import { isSingleKey, SHORTCUT_GROUPS } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

type Group = (typeof SHORTCUT_GROUPS)[number]["id"]

/**
 * The keyboard shortcuts, a table per group, from `SHORTCUT_GROUPS`: Settings shows them all, the
 * reader's `?` its own first. Rows that need AI only with `ai`. With single-key shortcuts `off`,
 * those keys stay listed, faded, and a row with no key left working says it is off.
 */
export function ShortcutList({
	groups = SHORTCUT_GROUPS.map((g) => g.id),
	ai,
	off,
	compact = false,
}: {
	groups?: Group[]
	ai: boolean
	off: boolean
	compact?: boolean
}) {
	return (
		<div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
			{groups.map((id) => (
				<ShortcutGroup key={id} id={id} ai={ai} off={off} />
			))}
		</div>
	)
}

function ShortcutGroup({ id, ai, off }: { id: Group; ai: boolean; off: boolean }) {
	const { t } = useTranslation("common")
	const headingId = useId()
	const rows = SHORTCUT_GROUPS.find((g) => g.id === id)!.rows.filter(
		(row) => ai || !("ai" in row && row.ai),
	)
	return (
		<section aria-labelledby={headingId}>
			<h2
				id={headingId}
				className="mb-1.5 text-xs font-medium tracking-wide text-muted-fg uppercase"
			>
				{t(`shortcuts.groups.${id}`)}
			</h2>
			<table className="w-full table-fixed text-sm">
				<tbody>
					{rows.map((row) => {
						const keys = row.keys.map((key) => ({ key, off: off && isSingleKey(key) }))
						const rowOff = keys.every((k) => k.off)
						return (
							<tr key={row.id} className="border-t border-border/60 first:border-t-0">
								<td className="w-32 py-1.5 pr-4 sm:w-48">
									<span className="flex flex-wrap gap-1">
										{keys.map(({ key, off: keyOff }) => (
											<kbd
												key={key}
												data-off={keyOff ? "" : undefined}
												className={cn(
													"inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-sans text-xs text-fg",
													keyOff && "text-muted-fg line-through opacity-60",
												)}
											>
												{key}
											</kbd>
										))}
									</span>
								</td>
								<td className={cn("py-1.5", rowOff && "text-muted-fg")}>
									{t(`shortcuts.rows.${row.id}`)}
									{rowOff ? (
										<span className="ml-2 rounded-full border border-border px-1.5 py-px text-xs">
											{t("shortcuts.offTag")}
										</span>
									) : null}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</section>
	)
}
