import { ARTICLE_TITLE_MAX } from "@klipstack/api-contract/names"
import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"

/**
 * An article's title, in a small modal: the card menu's Rename, as the reader's editable title.
 * Mounted only while open; posts `intent=rename` to the article's state action.
 */
export function RenameArticleDialog({
	documentId,
	title,
	onClose,
}: {
	documentId: string
	title: string
	onClose: () => void
}) {
	const { t } = useTranslation("library")
	const { t: tc } = useTranslation()
	const dialogRef = useRef<HTMLDialogElement>(null)
	const fetcher = useFetcher<{ ok: boolean; error?: { message: string } }>()
	const [value, setValue] = useState(title)

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
		const input = dialog?.querySelector<HTMLInputElement>("input[name=title]")
		input?.focus()
		input?.select()
	}, [])

	// Gone once the answer is in and the list has read its data again (as `SavedSearchDialog`).
	const [closed, setClosed] = useState(false)
	const settled = fetcher.state === "idle"
	const done = settled && fetcher.data?.ok === true
	useEffect(() => {
		if ((closed && settled) || done) onClose()
	}, [closed, settled, done, onClose])

	const clean = value.replace(/\s+/g, " ").trim()
	const ready = clean !== "" && clean !== title
	const refused = settled && fetcher.data && !fetcher.data.ok ? fetcher.data.error?.message : null

	return (
		<dialog
			ref={dialogRef}
			aria-label={t("card.renameTitle")}
			className="m-auto w-[min(28rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClose={() => setClosed(true)}
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				// The list behind listens for keys on the document: not from here.
				e.stopPropagation()
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			<fetcher.Form
				method="post"
				action={`/documents/${documentId}/state`}
				className="flex flex-col gap-4 p-6"
				onSubmit={(e) => {
					if (!ready) e.preventDefault()
				}}
			>
				<div className="flex items-start justify-between gap-4">
					<h2 className="text-lg font-semibold">{t("card.renameTitle")}</h2>
					<button
						type="button"
						onClick={() => dialogRef.current?.close()}
						className="rounded-md p-1.5 text-muted-fg hover:bg-hover"
						aria-label={tc("actions.close")}
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>
				<input type="hidden" name="intent" value="rename" />
				<Field
					label={t("card.renameLabel")}
					name="title"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					maxLength={ARTICLE_TITLE_MAX}
					required
					autoComplete="off"
					error={refused ?? undefined}
				/>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
						{tc("actions.cancel")}
					</Button>
					<Button type="submit" disabled={!ready || !settled}>
						{t("card.renameSave")}
					</Button>
				</div>
			</fetcher.Form>
		</dialog>
	)
}
