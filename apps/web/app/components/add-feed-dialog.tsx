import { Plus, Rss, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { Button } from "~/components/ui/button"
import { Field } from "~/components/ui/field"
import { showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"

export type SubscribeActionData = WebResult<{ subscribed: { title: string; existing: boolean } }>

type Choice = { url: string; title: string | null }

/** The dialog's text for a refused follow (`feed:add.errors.*`). */
function errorKey(code: string) {
	switch (code) {
		case "not_feed":
		case "fetch_failed":
		case "rate_limited":
		case "limit_reached":
			return `add.errors.${code}` as const
		default:
			return "add.errors.invalid_url" as const
	}
}

/**
 * "Add feed" button and dialog: paste a blog or feed address, pick one when the site offers
 * several. Posts `subscribe` to the feed page's action.
 */
export function AddFeedDialog({ className }: { className?: string }) {
	const { t } = useTranslation("feed")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const formRef = useRef<HTMLFormElement>(null)
	const fetcher = useFetcher<SubscribeActionData>()
	const busy = fetcher.state !== "idle"
	const data = fetcher.data
	// A site with several feeds: the refusal lists them, to follow one.
	const choices =
		data?.ok === false && data.error.code === "choose_feed"
			? ((data.error.details?.choices ?? []) as Choice[])
			: null
	const error = data?.ok === false && !choices ? errorKey(data.error.code) : null

	useEffect(() => {
		if (!data?.ok) return
		dialogRef.current?.close()
		formRef.current?.reset()
		const { title, existing } = data.subscribed
		showToast({ message: t(existing ? "alreadyFollowing" : "added", { title }) })
	}, [data, t])

	const close = () => dialogRef.current?.close()
	const choose = (url: string) =>
		fetcher.submit({ intent: "subscribe", url }, { method: "post", action: "/feed" })

	return (
		<>
			<Button
				type="button"
				size="sm"
				onClick={() => {
					dialogRef.current?.showModal()
					dialogRef.current?.querySelector("input")?.focus()
				}}
				aria-haspopup="dialog"
				className={className}
			>
				<Plus className="size-4" aria-hidden />
				{t("add.button")}
			</Button>
			<dialog
				ref={dialogRef}
				aria-label={t("add.title")}
				className="m-auto w-[min(32rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
				onClick={(e) => {
					if (e.target === dialogRef.current) close()
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") close()
				}}
			>
				<fetcher.Form
					ref={formRef}
					method="post"
					action="/feed"
					className="flex flex-col gap-4 p-6"
				>
					<input type="hidden" name="intent" value="subscribe" />
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2 className="text-lg font-semibold">{t("add.title")}</h2>
							<p className="mt-1 text-sm text-muted-fg">{t("add.description")}</p>
						</div>
						<button
							type="button"
							onClick={close}
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
						error={error ? t(error) : undefined}
					/>
					{choices ? (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-muted-fg">{t("add.choose")}</p>
							<ul className="flex flex-col gap-1">
								{choices.map((choice) => (
									<li key={choice.url}>
										<button
											type="button"
											disabled={busy}
											onClick={() => choose(choice.url)}
											className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
										>
											<Rss className="size-4 shrink-0 text-muted-fg" aria-hidden />
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">
													{choice.title ?? choice.url}
												</span>
												{choice.title ? (
													<span className="block truncate text-xs text-muted-fg">{choice.url}</span>
												) : null}
											</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					) : null}
					<div className="flex justify-end gap-2">
						<Button type="button" variant="secondary" onClick={close}>
							{t("add.cancel")}
						</Button>
						<Button type="submit" disabled={busy}>
							{busy ? t("add.adding") : t("add.submit")}
						</Button>
					</div>
				</fetcher.Form>
			</dialog>
		</>
	)
}
