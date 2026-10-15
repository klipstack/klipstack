import { Plus, X } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useLocation } from "react-router"
import type { LinkResult } from "~/commands/saving.server"
import { LinkResults, LinksField } from "~/components/links-field"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { prepareMotion } from "~/lib/motion"
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
	const fetcher = useFetcher<
		WebResult<{ saved: true } | { batch: LinkResult[] }> & { url?: string }
	>()
	const location = useLocation()
	const saving = fetcher.state !== "idle"
	const error = fetcher.data?.ok === false ? fetcher.data.error : null
	// Several links, some refused: the dialog stays, with each link's outcome.
	const batch = fetcher.data?.ok && "batch" in fetcher.data ? fetcher.data.batch : null
	const refused = batch?.filter((result) => !result.ok) ?? []

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
		if ("batch" in answer && answer.batch.some((result) => !result.ok)) return
		close()
		// The library's first page, newest first, shows the new card, clipped as it comes in; anywhere
		// else (another page, a filter, another order) the toast is clipped.
		showToast({
			message:
				"batch" in answer ? t("add.savedMany", { count: answer.batch.length }) : t("add.saved"),
			clip: location.pathname !== "/library" || location.search !== "",
		})
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])

	const open = useCallback(() => {
		const d = dialogRef.current
		if (!d) return
		d.showModal()
		d.querySelector("textarea")?.focus()
	}, [])

	return (
		<>
			<Button
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
					onSubmit={() => prepareMotion()}
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
					{batch && refused.length ? <LinkResults results={batch} /> : null}
					<LinksField
						// Again with only the links that were not saved, to fix or drop.
						key={fetcher.data && "batch" in fetcher.data ? "batch" : "links"}
						defaultValue={
							refused.length ? refused.map((result) => result.url).join("\n") : fetcher.data?.url
						}
						error={error}
					/>
					<div className="flex items-center justify-end gap-2">
						<Link
							to="/add"
							className="mr-auto text-sm text-link underline-offset-4 hover:underline"
						>
							{t("add.more")}
						</Link>
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
