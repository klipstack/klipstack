import { Plus, X } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useLocation } from "react-router"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { saveErrorKey } from "~/lib/save-errors"
import { showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"

/**
 * "Save link" button that opens a small modal with a URL field, posting to the library action.
 * Self-contained: the layout renders one in the phone top bar and pages render one on desktop.
 */
export function SaveLinkDialog() {
	const { t } = useTranslation("library")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const formRef = useRef<HTMLFormElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const fetcher = useFetcher<WebResult<{ saved: true }> & { url?: string }>()
	const location = useLocation()
	const saving = fetcher.state !== "idle"
	const error = fetcher.data?.ok === false ? saveErrorKey(fetcher.data.error) : null

	const close = useCallback(() => {
		dialogRef.current?.close()
		formRef.current?.reset()
	}, [])
	// Leaving the page closes it. Runs on every navigation on purpose.
	useEffect(close, [location.key, close])
	// Saved: the dialog goes and the page stays, with the article in it once its data reloads. An
	// error keeps the dialog open, with the message under the field.
	const onAnswer = useEffectEvent((answer: typeof fetcher.data) => {
		if (!answer?.ok) return
		close()
		showToast({ message: t("add.saved") })
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])

	const open = useCallback((url?: string) => {
		const d = dialogRef.current
		if (!d) return
		d.showModal()
		const input = d.querySelector("input")
		if (input && url !== undefined) input.value = url
		input?.focus()
	}, [])

	// Pasting a link anywhere on the page (not into a field) opens the dialog with it. Only the
	// visible instance reacts: the layout renders one in the phone bar and pages one on desktop.
	useEffect(() => {
		const onPaste = (e: ClipboardEvent) => {
			const target = e.target as HTMLElement | null
			if (target?.closest("input, textarea, [contenteditable]")) return
			if (!buttonRef.current || buttonRef.current.offsetParent === null) return
			const text = e.clipboardData?.getData("text")?.trim() ?? ""
			if (!/^https?:\/\/\S+$/i.test(text)) return
			e.preventDefault()
			open(text)
		}
		document.addEventListener("paste", onPaste)
		return () => document.removeEventListener("paste", onPaste)
	}, [open])

	return (
		<>
			<Button
				ref={buttonRef}
				type="button"
				variant="ghost"
				size="icon"
				onClick={() => open()}
				aria-haspopup="dialog"
				aria-label={t("add.button")}
				{...tooltip(t("add.button"))}
				className="size-10 rounded-md text-accent"
			>
				<Plus className="size-5" aria-hidden />
			</Button>
			<dialog
				ref={dialogRef}
				aria-label={t("add.title")}
				className="m-auto w-[min(32rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
				onClick={(e) => {
					if (e.target === dialogRef.current) dialogRef.current?.close()
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") dialogRef.current?.close()
				}}
			>
				<fetcher.Form
					ref={formRef}
					method="post"
					action="/library"
					className="flex flex-col gap-4 p-6"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2 className="text-lg font-semibold">{t("add.title")}</h2>
							<p className="mt-1 text-sm text-muted-fg">{t("add.description")}</p>
						</div>
						<button
							type="button"
							onClick={() => dialogRef.current?.close()}
							className="rounded-md p-1.5 text-muted-fg hover:bg-muted"
							aria-label={t("add.cancel")}
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>
					<Field
						label={t("add.urlLabel")}
						name="url"
						type="url"
						inputMode="url"
						placeholder="https://"
						required
						autoComplete="off"
						defaultValue={fetcher.data?.url}
						error={error ? t(error) : undefined}
					/>
					<div className="flex justify-end gap-2">
						<Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
							{t("add.cancel")}
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? t("add.saving") : t("add.submit")}
						</Button>
					</div>
				</fetcher.Form>
			</dialog>
		</>
	)
}
