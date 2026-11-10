import { Pencil } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { useFetcherAnswer } from "~/hooks/use-fetcher-answer"
import { tooltip } from "./tooltip-host"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

/**
 * Where the rename is. `saving` is this edit's own request: an answer that comes while the title
 * is shown, or while a later edit is open, belongs to an edit given up and changes nothing.
 */
type Status = "viewing" | "editing" | "saving" | "failed"

/** The reader's H1 with an inline rename (posts intent=rename to the document state action). */
export function EditableTitle({ title, action }: { title: string | null; action: string }) {
	const { t } = useTranslation("reader")
	const fetcher = useFetcher<{ ok: boolean }>()
	const [status, setStatus] = useState<Status>("viewing")
	const inputRef = useRef<HTMLInputElement>(null)
	const editing = status !== "viewing"

	useFetcherAnswer(fetcher, (answer) => {
		setStatus((s) => (s !== "saving" ? s : answer.ok ? "viewing" : "failed"))
	})
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
					onClick={() => setStatus("editing")}
					aria-label={t("title.edit")}
					{...tooltip(t("title.edit"))}
					className="mt-1 shrink-0 rounded-md p-1.5 text-muted-fg hover:bg-hover hover:text-fg md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
				>
					<Pencil className="size-4" aria-hidden />
				</button>
			</div>
		)

	return (
		<fetcher.Form
			method="post"
			action={action}
			className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap"
			onSubmit={() => setStatus("saving")}
			onKeyDown={(e) => {
				if (e.key === "Escape") setStatus("viewing")
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
				className="text-lg font-semibold sm:flex-1"
			/>
			<div className="flex shrink-0 gap-1">
				<Button type="submit" disabled={status === "saving"}>
					{t("title.save")}
				</Button>
				<Button type="button" variant="ghost" onClick={() => setStatus("viewing")}>
					{t("title.cancel")}
				</Button>
			</div>
			{status === "failed" ? (
				<p role="alert" className="w-full text-sm text-danger">
					{t("title.failed")}
				</p>
			) : null}
		</fetcher.Form>
	)
}
