import { useId } from "react"
import { useTranslation } from "react-i18next"
import { SHORTCUT_GROUPS } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

type Group = (typeof SHORTCUT_GROUPS)[number]["id"]

/**
 * The keyboard shortcuts, a table per group, from `SHORTCUT_GROUPS`: Settings shows them all, the
 * reader's `?` its own first. Rows that need AI only with `ai`.
 */
export function ShortcutList({
	groups = SHORTCUT_GROUPS.map((g) => g.id),
	ai,
	compact = false,
}: {
	groups?: Group[]
	ai: boolean
	compact?: boolean
}) {
	return (
		<div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
			{groups.map((id) => (
				<ShortcutGroup key={id} id={id} ai={ai} />
			))}
		</div>
	)
}

function ShortcutGroup({ id, ai }: { id: Group; ai: boolean }) {
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
					{rows.map((row) => (
						<tr key={row.id} className="border-t border-border/60 first:border-t-0">
							<td className="w-32 py-1.5 pr-4 sm:w-48">
								<span className="flex flex-wrap gap-1">
									{row.keys.map((key) => (
										<kbd
											key={key}
											className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-sans text-xs text-fg"
										>
											{key}
										</kbd>
									))}
								</span>
							</td>
							<td className="py-1.5">{t(`shortcuts.rows.${row.id}`)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	)
}
