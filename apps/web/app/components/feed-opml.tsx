import { Download, Rss, Upload } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import {
	MenuButton,
	MenuLink,
	MenuSeparator,
	MoreMenu,
	type MoreMenuHandle,
} from "~/components/more-menu"
import { Button } from "~/components/ui/button"
import { showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"

export type ImportOpmlActionData = WebResult<{
	imported: { added: number; existing: number; skipped: number; overLimit: number }
}>

/** The toast's text for a refused import (`feed:opml.errors.*`). */
const errorKey = (code: string) =>
	code === "no_feeds" || code === "rate_limited"
		? (`opml.errors.${code}` as const)
		: ("opml.errors.not_opml" as const)

/** Under the server's form limit (1 MB), with room for the multipart envelope. */
const MAX_FILE_BYTES = 1_000_000

/**
 * Picks an OPML file and posts it as `import` to the feed page's action; the outcome shows as a
 * toast. `input` must stay mounted while the picker is open, so it renders outside any menu.
 */
function useOpmlImport() {
	const { t } = useTranslation("feed")
	const inputRef = useRef<HTMLInputElement>(null)
	const fetcher = useFetcher<ImportOpmlActionData>()
	const result = fetcher.data

	useEffect(() => {
		if (!result) return
		if (!result.ok) {
			showToast({ message: t(errorKey(result.error.code)), warn: true })
			return
		}
		const { added, existing, skipped, overLimit } = result.imported
		const parts = [added > 0 ? t("opml.imported", { count: added }) : t("opml.importedNone")]
		if (existing > 0) parts.push(t("opml.existing", { count: existing }))
		if (skipped > 0) parts.push(t("opml.skipped", { count: skipped }))
		if (overLimit > 0) parts.push(t("opml.overLimit", { count: overLimit }))
		showToast({ message: parts.join(" "), warn: skipped > 0 || overLimit > 0 })
	}, [result, t])

	const input = (
		// No `accept`: phones grey out `.opml` files, whose type they do not know.
		<input
			ref={inputRef}
			type="file"
			hidden
			aria-label={t("opml.import")}
			data-testid="opml-file"
			onChange={(e) => {
				const file = e.target.files?.[0]
				e.target.value = ""
				if (!file) return
				if (file.size > MAX_FILE_BYTES) {
					showToast({ message: t("opml.errors.too_large"), warn: true })
					return
				}
				const form = new FormData()
				form.set("intent", "import")
				form.set("file", file)
				void fetcher.submit(form, {
					method: "post",
					action: "/feed",
					encType: "multipart/form-data",
				})
			}}
		/>
	)
	return { input, pick: () => inputRef.current?.click(), busy: fetcher.state !== "idle" }
}

/** The feed page's "…": review subscriptions, or import and export them. */
export function FeedMenu({
	ref,
	onFollowing,
}: {
	ref?: React.Ref<MoreMenuHandle>
	onFollowing: () => void
}) {
	const { t } = useTranslation("feed")
	const { input, pick } = useOpmlImport()
	return (
		<>
			{input}
			<MoreMenu ref={ref} label={t("menu")} className="p-2">
				<MenuButton icon={<Rss className="size-4" aria-hidden />} onClick={onFollowing}>
					{t("following.title")}
				</MenuButton>
				<MenuSeparator />
				<MenuButton icon={<Upload className="size-4" aria-hidden />} onClick={pick}>
					{t("opml.import")}
				</MenuButton>
				<MenuLink icon={<Download className="size-4" aria-hidden />} href="/feed/opml" download>
					{t("opml.export")}
				</MenuLink>
			</MoreMenu>
		</>
	)
}

/** For the empty page: someone coming from another reader starts here. */
export function ImportOpmlButton() {
	const { t } = useTranslation("feed")
	const { input, pick, busy } = useOpmlImport()
	return (
		<>
			{input}
			<Button variant="ghost" size="sm" onClick={pick} disabled={busy}>
				<Upload className="size-4" aria-hidden />
				{busy ? t("opml.importing") : t("opml.import")}
			</Button>
		</>
	)
}
