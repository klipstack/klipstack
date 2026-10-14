import { FileText } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "~/lib/utils"

export interface LinkOption {
	id: string
	title: string
	siteName: string | null
	archived: boolean
}

interface Props {
	/** The caret, in viewport coordinates. */
	rect: DOMRect
	items: LinkOption[]
	selected: number
	/** True while nothing has been typed after `[[`: the rows are the recent articles. */
	recent: boolean
	onPick: (index: number) => void
	onHover: (index: number) => void
}

export const MENU_WIDTH = 288
const GAP = 6

/**
 * The articles offered after `[[`. Sits at the caret, flipping above it when the keyboard or the
 * bottom of the window leaves no room below.
 */
export function NoteLinkMenu({ rect, items, selected, recent, onPick, onHover }: Props) {
	const { t } = useTranslation("reader")
	const ref = useRef<HTMLDivElement>(null)
	const [top, setTop] = useState<number | null>(null)

	// Measure again whenever the rows change
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const view = window.visualViewport
		const height = view?.height ?? window.innerHeight
		const offset = view?.offsetTop ?? 0
		const below = rect.bottom + GAP
		setTop(below + el.offsetHeight > offset + height ? rect.top - el.offsetHeight - GAP : below)
	}, [rect.top, rect.bottom, items])

	const left = Math.min(Math.max(8, rect.left), window.innerWidth - MENU_WIDTH - 8)
	return (
		<div
			ref={ref}
			data-testid="note-link-menu"
			style={{ top: top ?? rect.bottom + GAP, left, width: MENU_WIDTH }}
			className={cn(
				"fixed z-50 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg",
				top === null && "invisible",
			)}
		>
			{items.length === 0 ? (
				<p className="px-3 py-2 text-sm text-muted-fg">{t("noteLinks.empty")}</p>
			) : (
				<>
					{recent ? (
						<p className="px-3 py-1 text-xs font-medium text-muted-fg">{t("noteLinks.recent")}</p>
					) : null}
					<div
						role="listbox"
						aria-label={t("noteLinks.search")}
						className="max-h-64 overflow-y-auto"
					>
						{items.map((item, i) => (
							<div key={item.id}>
								<button
									type="button"
									id={`note-link-option-${i}`}
									role="option"
									aria-selected={i === selected}
									data-testid="note-link-option"
									// The editor keeps the caret: picking is a mousedown, never a focus change.
									onMouseDown={(e) => {
										e.preventDefault()
										onPick(i)
									}}
									onMouseEnter={() => onHover(i)}
									className={cn(
										"flex w-full items-center gap-2 px-3 py-1.5 text-left",
										i === selected && "bg-fg/10",
									)}
								>
									<FileText className="size-4 shrink-0 text-muted-fg" aria-hidden />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm">{item.title}</span>
										{item.siteName ? (
											<span className="block truncate text-xs text-muted-fg">{item.siteName}</span>
										) : null}
									</span>
									{item.archived ? (
										<span className="shrink-0 rounded border border-border px-1 text-[0.65rem] text-muted-fg">
											{t("noteLinks.archived")}
										</span>
									) : null}
								</button>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	)
}
