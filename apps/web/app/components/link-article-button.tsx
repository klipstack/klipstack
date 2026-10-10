import { FileSymlink } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "~/lib/utils"
import type { NoteEditorApi } from "./note-editor"
import { tooltip } from "./tooltip-host"

/**
 * Opens the article menu without reaching for `[` on a phone keyboard. Nothing shows until the
 * editor's chunk is in: the fallback textarea has no menu to open.
 */
export function LinkArticleButton({
	api,
	compact,
	className,
}: {
	api: NoteEditorApi | null
	/** Icon only, for the highlight editor's row, where there is no width for three labels. */
	compact?: boolean
	className?: string
}) {
	const { t } = useTranslation("reader")
	if (!api) return null
	const label = t("noteLinks.link")
	return (
		<button
			type="button"
			data-testid="link-article"
			aria-label={compact ? label : undefined}
			{...(compact ? tooltip(label) : {})}
			// The caret stays where it is: the menu opens where the user was typing.
			onMouseDown={(e) => e.preventDefault()}
			onClick={api.linkArticle}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-lg font-medium text-muted-fg hover:bg-muted hover:text-fg",
				compact ? "p-1.5" : "px-2 py-1.5 text-xs",
				className,
			)}
		>
			<FileSymlink className={compact ? "size-4" : "size-3.5"} aria-hidden />
			{compact ? null : label}
		</button>
	)
}
