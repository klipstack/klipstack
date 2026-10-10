import { Fragment, type Ref } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { DocumentCard } from "~/components/document-card"
import type { ListSelection } from "~/hooks/use-list-cursor"
import { BULK_FETCHER } from "~/lib/bulk-actions"
import { type DateGroup, dateGroupLabel } from "~/lib/date-groups"
import { useListLayout } from "~/lib/list-layout"
import { cn } from "~/lib/utils"
import type { LibraryCard } from "~/services/documents.server"

/** The cards of a list view or of a search, as a list or a grid; `useListCursor` moves its cursor. */
export function DocumentList({
	items,
	groups,
	listRef,
	cursorId,
	onVanish,
	selection,
	className,
}: {
	items: LibraryCard[]
	/** One per item: a heading goes before the first card of each group. */
	groups?: DateGroup[] | null
	listRef?: Ref<HTMLUListElement>
	cursorId?: string | null
	onVanish?: (id: string) => void
	selection?: ListSelection
	className?: string
}) {
	const { t, i18n } = useTranslation("library")
	const layout = useListLayout()
	// A bulk change on its way: its cards show it already.
	const bulk = useFetcher({ key: BULK_FETCHER })
	const bulkIntent = bulk.formData?.get("intent")
	const bulkIds = new Set(String(bulk.formData?.get("ids") ?? "").split(","))
	return (
		<ul
			ref={listRef}
			data-layout={layout}
			className={cn(
				"flex flex-col pt-3 md:mt-4 md:pt-0 layout-grid:grid layout-grid:grid-cols-2 layout-grid:gap-x-4 layout-grid:gap-y-8 md:layout-grid:gap-x-6 lg:layout-grid:grid-cols-3",
				className,
			)}
		>
			{items.map((doc, i) => {
				const group = groups?.[i]
				return (
					<Fragment key={doc.id}>
						{group && group !== groups?.[i - 1] ? (
							<li className="col-span-full pt-6 pb-1 text-sm font-medium text-muted-fg first:pt-0 layout-grid:pt-2 layout-grid:pb-0 layout-grid:first:pt-0">
								<h2>{dateGroupLabel(group, i18n.language, (key) => t(`groups.${key}`))}</h2>
							</li>
						) : null}
						<DocumentCard
							doc={doc}
							cursor={doc.id === cursorId}
							onVanish={onVanish}
							checked={selection?.checked.has(doc.id) ?? false}
							selecting={selection?.selecting ?? false}
							onCheck={selection?.toggle}
							pendingIntent={
								typeof bulkIntent === "string" && bulkIds.has(doc.id) ? bulkIntent : null
							}
						/>
					</Fragment>
				)
			})}
		</ul>
	)
}
