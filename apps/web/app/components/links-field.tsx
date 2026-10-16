import { SAVE_LINKS_MAX } from "@klipstack/api-contract/names"
import { Check, CircleAlert } from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { LinkResult } from "~/commands/saving.server"
import { useSubmitHint } from "~/lib/commands"
import { saveErrorKey } from "~/lib/save-errors"
import { isSubmitShortcut } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"

/**
 * The Save link field, in the dialog and on the Add page: one link, or several, one per line, up
 * to `SAVE_LINKS_MAX`. Two lines tall, it grows with what is pasted (CSS `field-sizing`, where the
 * browser has it) up to eight; Enter starts a line, ⌘↵ / Ctrl+Enter saves, as the Save button.
 */
export function LinksField({
	defaultValue,
	error,
	autoFocus,
}: {
	defaultValue?: string
	/** A refusal's code and details, as the action answered. */
	error?: { code: string; details?: Record<string, unknown> } | null
	autoFocus?: boolean
}) {
	const { t } = useTranslation("library")
	const id = useId()
	const submitHint = useSubmitHint()
	const errorText = error ? t(saveErrorKey(error), { max: SAVE_LINKS_MAX }) : null
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium">
				{t("add.urlLabel")}
			</label>
			<textarea
				id={id}
				name="url"
				rows={2}
				required
				autoComplete="off"
				autoCapitalize="off"
				spellCheck={false}
				inputMode="url"
				placeholder="https://"
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- the page and the dialog are for this field
				autoFocus={autoFocus}
				defaultValue={defaultValue}
				aria-invalid={Boolean(errorText) || undefined}
				aria-describedby={`${id}-${errorText ? "error" : "hint"}`}
				onKeyDown={(e) => {
					if (!isSubmitShortcut(e.nativeEvent)) return
					e.preventDefault()
					const form = e.currentTarget.form
					// While saving, as the Save button: once is enough.
					if (form?.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled) return
					form?.requestSubmit()
				}}
				className="max-h-[calc(8lh+1rem)] min-h-[calc(2lh+1rem)] w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-fg shadow-xs [field-sizing:content] placeholder:text-muted-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-invalid:border-danger"
			/>
			{errorText ? (
				<p id={`${id}-error`} className="text-sm text-danger">
					{errorText}
				</p>
			) : (
				<p id={`${id}-hint`} className="text-xs text-muted-fg">
					{t("add.several", { max: SAVE_LINKS_MAX })}
					{/* The platform's own shortcut, and none on a touch screen. */}
					{submitHint ? (
						<span className="[@media(pointer:coarse)]:hidden">
							{" "}
							{t("add.shortcut", { keys: submitHint })}
						</span>
					) : null}
				</p>
			)}
		</div>
	)
}

/** Each link's outcome after saving several: saved, already there, or why not. */
export function LinkResults({ results, className }: { results: LinkResult[]; className?: string }) {
	const { t } = useTranslation("library")
	return (
		<ul aria-label={t("add.results")} className={cn("flex flex-col gap-2 text-sm", className)}>
			{results.map((result) => (
				<li key={result.url} className="flex items-start gap-2">
					{result.ok ? (
						<Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
					) : (
						<CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate text-fg" title={result.url}>
							{result.url}
						</p>
						<p className="text-xs text-muted-fg">
							{result.ok ? (
								<>
									{result.created ? t("add.saved") : t("add.already")}{" "}
									<Link to={`/read/${result.articleId}`} className="text-link hover:underline">
										{t("add.open")}
									</Link>
								</>
							) : (
								t(saveErrorKey(result), { max: SAVE_LINKS_MAX })
							)}
						</p>
					</div>
				</li>
			))}
		</ul>
	)
}
