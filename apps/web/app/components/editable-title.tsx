import { Pencil } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { tooltip } from "./tooltip-host"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

/** The reader's H1 with an inline rename (posts intent=rename to the document state action). */
export function EditableTitle({ title, action }: { title: string | null; action: string }) {
	const { t } = useTranslation("reader")
	const fetcher = useFetcher<{ ok: boolean }>()
	const [editing, setEditing] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const busy = fetcher.state !== "idle"
	const wasBusy = useRef(false)

	// Close once a submission has come back ok (not merely because an old success is still in data).
	useEffect(() => {
		if (wasBusy.current && !busy && fetcher.data?.ok) setEditing(false)
		wasBusy.current = busy
	}, [busy, fetcher.data])
	useEffect(() => {
		if (editing) inputRef.current?.select()
	}, [editing])

	const submitted = fetcher.formData?.get("title")
	const shown = typeof submitted === "string" && submitted.trim() ? submitted.trim() : title

	if (!editing)
		return (
			<div className="group flex items-start gap-2">
				<h1 className="reader-title text-balance font-semibold leading-tight">{shown}</h1>
				<button
					type="button"
					onClick={() => setEditing(true)}
					aria-label={t("title.edit")}
					{...tooltip(t("title.edit"))}
					className="mt-1 shrink-0 rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
				>
					<Pencil className="size-4" aria-hidden />
				</button>
			</div>
		)

	return (
		<fetcher.Form
			method="post"
			action={action}
			className="flex flex-col gap-2 sm:flex-row sm:items-center"
			onKeyDown={(e) => {
				if (e.key === "Escape") setEditing(false)
			}}
		>
			<input type="hidden" name="intent" value="rename" />
			<Input
				ref={inputRef}
				name="title"
				defaultValue={title ?? ""}
				required
				maxLength={300}
				aria-label={t("title.label")}
				className="text-lg font-semibold"
			/>
			<div className="flex shrink-0 gap-1">
				<Button type="submit" disabled={busy}>
					{t("title.save")}
				</Button>
				<Button type="button" variant="ghost" onClick={() => setEditing(false)}>
					{t("title.cancel")}
				</Button>
			</div>
		</fetcher.Form>
	)
}
