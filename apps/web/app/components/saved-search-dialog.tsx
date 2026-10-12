import { SAVED_SEARCH_NAME_MAX } from "@klipstack/api-contract/names"
import { defaultSavedSearchName } from "@klipstack/api-contract/search-query"
import { Pencil, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { type FetcherWithComponents, useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { showToast } from "~/lib/toast"
import type { action } from "~/routes/saved-searches"
import { MenuAction, MenuButton } from "./more-menu"

export interface SavedSearchItem {
	id: string
	name: string
	query: string
	/** Topics it names that the reader no longer has: it finds nothing in them. */
	endedTopics?: string[]
}

/** The dialog's text for a refusal (`savedSearches.errors.*`). */
function errorKey(error: { code: string; details?: Record<string, unknown> }) {
	switch (error.code) {
		case "name_taken":
			return "name_taken" as const
		case "too_many_saved_searches":
			return "too_many" as const
		case "invalid_request": {
			// Which field broke its limit.
			const issues = (error.details?.issues ?? []) as Array<{ path?: unknown[] }>
			return issues[0]?.path?.[0] === "query"
				? ("invalid_query" as const)
				: ("invalid_name" as const)
		}
		default:
			return "generic" as const
	}
}

/**
 * The name of a saved search, in a small modal: a new one for `query`, or another name for `saved`.
 * Mounted only while open. The search page and the sidebar both open it.
 */
export function SavedSearchDialog({
	saved,
	query = "",
	onClose,
}: {
	/** The one to rename. Without it, `query` is saved under the name typed. */
	saved?: SavedSearchItem
	query?: string
	onClose: () => void
}) {
	const { t } = useTranslation()
	const dialogRef = useRef<HTMLDialogElement>(null)
	const fetcher = useFetcher<typeof action>()
	const [name, setName] = useState(() => saved?.name ?? defaultSavedSearchName(query))
	const [error, setError] = useState<ReturnType<typeof errorKey> | null>(null)

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
		const input = dialog?.querySelector<HTMLInputElement>("input[name=name]")
		input?.focus()
		input?.select()
	}, [])

	// Each answer counts once. A refusal stays under the field until the name changes.
	const [seen, setSeen] = useState(fetcher.data)
	if (fetcher.data !== seen) {
		setSeen(fetcher.data)
		if (fetcher.data && !fetcher.data.ok) setError(errorKey(fetcher.data.error))
	}

	// Gone once the answer is in and the page has read its data again: a fetcher that unmounts
	// takes its revalidation with it, and the sidebar would go on showing the old rows.
	const [closed, setClosed] = useState(false)
	const settled = fetcher.state === "idle"
	const done = settled && fetcher.data?.ok === true
	useEffect(() => {
		if ((closed && settled) || done) onClose()
	}, [closed, settled, done, onClose])

	const title = saved ? t("savedSearches.renameTitle") : t("savedSearches.saveTitle")
	const clean = name.replace(/\s+/g, " ").trim()
	const ready = clean !== "" && clean !== saved?.name

	return (
		<dialog
			ref={dialogRef}
			aria-label={title}
			data-testid="saved-search-dialog"
			className="m-auto w-[min(28rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClose={() => setClosed(true)}
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				// The page behind listens for keys on the document (⌘K, the list's keys): not from here.
				e.stopPropagation()
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			<fetcher.Form
				method="post"
				action="/saved-searches"
				className="flex flex-col gap-4 p-6"
				onSubmit={(e) => {
					if (!ready) e.preventDefault()
				}}
			>
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold">{title}</h2>
						<p className="mt-1 truncate font-mono text-[0.8125rem] text-muted-fg">
							{saved?.query ?? query}
						</p>
					</div>
					<button
						type="button"
						onClick={() => dialogRef.current?.close()}
						className="rounded-md p-1.5 text-muted-fg hover:bg-muted"
						aria-label={t("actions.close")}
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>
				<input type="hidden" name="intent" value={saved ? "rename" : "create"} />
				{saved ? (
					<input type="hidden" name="id" value={saved.id} />
				) : (
					<input type="hidden" name="query" value={query} />
				)}
				<Field
					label={t("savedSearches.nameLabel")}
					name="name"
					value={name}
					onChange={(e) => {
						setName(e.target.value)
						setError(null)
					}}
					maxLength={SAVED_SEARCH_NAME_MAX}
					required
					autoComplete="off"
					error={error ? t(`savedSearches.errors.${error}`) : undefined}
				/>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
						{t("actions.cancel")}
					</Button>
					<Button type="submit" disabled={!ready || !settled}>
						{saved ? t("savedSearches.rename") : t("actions.save")}
					</Button>
				</div>
			</fetcher.Form>
		</dialog>
	)
}

/**
 * Rename and Delete, for the menu of a saved search: its sidebar row, and the Saved button of the
 * search page. Delete asks nothing: the toast puts the search back.
 */
export function SavedSearchMenuItems({
	saved,
	fetcher,
	onRename,
}: {
	saved: SavedSearchItem
	/** The caller's: it hides the row while the delete is on its way. */
	fetcher: FetcherWithComponents<unknown>
	onRename: () => void
}) {
	const { t } = useTranslation()
	return (
		<>
			<MenuButton icon={<Pencil className="size-4" aria-hidden />} onClick={onRename}>
				{t("savedSearches.rename")}
			</MenuButton>
			<MenuAction
				fetcher={fetcher}
				action="/saved-searches"
				intent="delete"
				fields={{ id: saved.id }}
				icon={<Trash2 className="size-4" aria-hidden />}
				danger
				onSubmit={() =>
					showToast({
						message: t("savedSearches.deleted", { name: saved.name }),
						undo: {
							action: "/saved-searches",
							intent: "create",
							label: t("savedSearches.undo"),
							fields: { name: saved.name, query: saved.query },
						},
					})
				}
			>
				{t("actions.delete")}
			</MenuAction>
		</>
	)
}
