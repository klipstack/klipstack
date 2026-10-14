import { Fragment, type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useLocation } from "react-router"
import { DocumentCard } from "~/components/document-card"
import type { ListSelection } from "~/hooks/use-list-cursor"
import { BULK_FETCHER } from "~/lib/bulk-actions"
import { type DateGroup, dateGroupLabel } from "~/lib/date-groups"
import { useListLayout } from "~/lib/list-layout"
import { type Entering, entersAs, reducedMotion, registerList, settleList } from "~/lib/motion"
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
	cardMenu,
	keepsArchived = false,
	topics,
	className,
}: {
	items: LibraryCard[]
	/** One per item: a heading goes before the first card of each group. */
	groups?: DateGroup[] | null
	listRef?: RefObject<HTMLUListElement | null>
	cursorId?: string | null
	onVanish?: (id: string) => void
	selection?: ListSelection
	/** Menu items the list adds to each card's ⋯ (`DocumentCard`'s `menuItems`). */
	cardMenu?: (doc: LibraryCard) => React.ReactNode
	/** The list shows archived and unarchived articles alike: archiving one does not take it out. */
	keepsArchived?: boolean
	/** The topic each card is in, by id, shown beside its source. */
	topics?: Record<string, string>
	className?: string
}) {
	const { t, i18n } = useTranslation("library")
	const layout = useListLayout()
	// A bulk change on its way: its cards show it already.
	const bulk = useFetcher({ key: BULK_FETCHER })
	const bulkIntent = bulk.formData?.get("intent")
	const bulkIds = new Set(String(bulk.formData?.get("ids") ?? "").split(","))
	const location = useLocation()
	const { ref, entering, entered } = useListMotion(items, location.key, listRef)
	return (
		<ul
			ref={ref}
			data-layout={layout}
			data-keeps-archived={keepsArchived || undefined}
			data-motion-page={location.key}
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
							<li
								data-motion-key={`group-${group}`}
								className="col-span-full pt-6 pb-1 text-sm font-medium text-muted-fg first:pt-0 layout-grid:pt-2 layout-grid:pb-0 layout-grid:first:pt-0"
							>
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
							keepsArchived={keepsArchived}
							pendingIntent={
								typeof bulkIntent === "string" && bulkIds.has(doc.id) ? bulkIntent : null
							}
							menuItems={cardMenu?.(doc)}
							topic={topics?.[doc.id]}
							entering={entering.get(doc.id)}
							onEntered={entered}
						/>
					</Fragment>
				)
			})}
		</ul>
	)
}

/**
 * The list's part of the actions' animations (`~/lib/motion`): its cards slide into place after a
 * change, and a card that shows up while the page stays (a reload after a save, a live update, an
 * Undo) comes in: a new article gets the clip, one back by Undo comes back. A different page of the
 * list (another filter, the next page) just shows.
 */
function useListMotion(
	items: LibraryCard[],
	page: string,
	listRef?: RefObject<HTMLUListElement | null>,
) {
	const own = useRef<HTMLUListElement>(null)
	const ref = listRef ?? own
	useLayoutEffect(() => {
		const list = ref.current
		if (!list) return
		// Whatever moved since the action's snapshot slides there.
		settleList(list)
		return registerList(list)
	})
	const [seen, setSeen] = useState(() => ({
		key: page,
		items,
		entering: new Map<string, Entering>() as ReadonlyMap<string, Entering>,
	}))
	if (seen.items !== items || seen.key !== page) {
		// A card that left before its coming in ended does not pick it up again later.
		const ids = new Set(items.map((d) => d.id))
		const entering = new Map([...seen.entering].filter(([id]) => ids.has(id)))
		if (seen.key === page && !reducedMotion()) {
			const before = new Set(seen.items.map((d) => d.id))
			for (const doc of items) {
				const how = before.has(doc.id) ? null : entersAs(doc.id, doc.createdAt)
				if (how) entering.set(doc.id, how)
			}
		}
		setSeen({ key: page, items, entering })
	}
	const entered = useCallback(
		(id: string) =>
			setSeen((s) => {
				if (!s.entering.has(id)) return s
				const entering = new Map(s.entering)
				entering.delete(id)
				return { ...s, entering }
			}),
		[],
	)
	return { ref, entering: seen.entering, entered }
}
