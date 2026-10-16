import { Bookmark, ChevronRight, Plus, X } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useFetcher, useLocation, useNavigate, useRouteLoaderData } from "react-router"
import type { LinkResult } from "~/commands/saving.server"
import { LinkResults, LinksField } from "~/components/links-field"
import { tooltip } from "~/components/tooltip-host"
import { Button } from "~/components/ui/button"
import { prepareMotion } from "~/lib/motion"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { WebResult } from "~/lib/web-result"
import type { loader as layoutLoader } from "~/routes/app-layout"

/**
 * Every way into the library, in one dialog: links pasted (several at once), the bookmarklet, and
 * an AI assistant connected to the library. The app's frame holds the one dialog; buttons and the
 * command menu open it, and so does `?save` on any of its pages (`/add`, the bookmarklet's and the
 * phone's share address, sends there).
 */

const OPEN_EVENT = "klipstack:save-link"
let mounted = 0

/** Opens the dialog, with `url` in the field. False where the page has no dialog to open. */
export function openSaveLink(url = ""): boolean {
	if (!mounted) return false
	window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: url }))
	return true
}

/** The address that opens the dialog from outside the app's pages: the library, with it open. */
export function saveLinkPath(url = "") {
	return `/library?save=${encodeURIComponent(url)}`
}

/** The "Save link" button pages and the phone's top bar show. */
export function SaveLinkButton({ className }: { className?: string }) {
	const { t } = useTranslation("library")
	const navigate = useNavigate()
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			onClick={() => openSaveLink() || navigate(saveLinkPath())}
			aria-haspopup="dialog"
			aria-label={t("add.button")}
			{...tooltip(t("add.button"))}
			className={cn("size-10 rounded-md text-accent", className)}
		>
			<Plus className="size-5" aria-hidden />
		</Button>
	)
}

/**
 * What is in the field and not saved yet, kept for the browser tab: closing the dialog, another
 * page or a reload keeps it; saving clears it.
 */
const DRAFT_KEY = "klipstack:save-link-draft"
const draft = {
	get: () => {
		try {
			return sessionStorage.getItem(DRAFT_KEY) ?? ""
		} catch {
			return ""
		}
	},
	set: (value: string) => {
		try {
			if (value.trim()) sessionStorage.setItem(DRAFT_KEY, value)
			else sessionStorage.removeItem(DRAFT_KEY)
		} catch {
			// Private modes without storage: the draft lasts as long as the page.
		}
	},
}

/** `url` on a line of its own after what is there, unless it is there already. */
function withLink(text: string, url: string) {
	if (!url) return text
	const lines = text.split("\n").map((line) => line.trim())
	if (lines.includes(url)) return text
	return text.trim() ? `${text.trimEnd()}\n${url}` : url
}

export function SaveLinkDialog() {
	const { t } = useTranslation("library")
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const formRef = useRef<HTMLFormElement>(null)
	const fetcher = useFetcher<
		WebResult<{ saved: true } | { batch: LinkResult[] }> & { url?: string }
	>()
	const location = useLocation()
	const navigate = useNavigate()
	const saving = fetcher.state !== "idle"
	const error = fetcher.data?.ok === false ? fetcher.data.error : null
	// Several links, some refused: the dialog stays, with each link's outcome.
	const batch = fetcher.data?.ok && "batch" in fetcher.data ? fetcher.data.batch : null
	const refused = batch?.filter((result) => !result.ok) ?? []

	// Closing keeps what was typed (the draft); only a save empties the field.
	const close = useCallback(() => dialogRef.current?.close(), [])
	const open = useCallback((url: string) => {
		const d = dialogRef.current
		if (!d) return
		if (!d.open) d.showModal()
		// Here and now, in the tap that opened it: a phone raises its keyboard only then.
		const field = d.querySelector("textarea")
		if (!field) return
		field.value = withLink(field.value || draft.get(), url)
		draft.set(field.value)
		field.focus()
	}, [])

	useEffect(() => {
		mounted++
		const onOpen = (event: Event) => open((event as CustomEvent<string>).detail)
		window.addEventListener(OPEN_EVENT, onOpen)
		return () => {
			mounted--
			window.removeEventListener(OPEN_EVENT, onOpen)
		}
	}, [open])

	// `?save` (and `?save=<link>`) opens it, once: the address goes back to the page's own.
	const opened = useRef(false)
	const onLocation = useEffectEvent(() => {
		const params = new URLSearchParams(location.search)
		const save = params.get("save")
		if (save === null) {
			// The address it was opened from, without `?save`: that is not leaving.
			if (opened.current) opened.current = false
			else close()
			return
		}
		opened.current = true
		params.delete("save")
		const search = params.toString()
		navigate(`${location.pathname}${search ? `?${search}` : ""}${location.hash}`, {
			replace: true,
			preventScrollReset: true,
		})
		open(save)
	})
	// Leaving the page closes it. Runs on every navigation on purpose.
	useEffect(() => onLocation(), [location.key])

	// Saved: the dialog goes and the page stays, with the article in it once its data reloads. An
	// error keeps the dialog open, with the message under the field.
	const onAnswer = useEffectEvent((answer: typeof fetcher.data) => {
		if (!answer?.ok) return
		// Several links, some refused: those are what is left to save.
		const left = "batch" in answer ? answer.batch.filter((result) => !result.ok) : []
		if (left.length) {
			draft.set(left.map((result) => result.url).join("\n"))
			return
		}
		close()
		draft.set("")
		if (formRef.current) formRef.current.reset()
		const field = dialogRef.current?.querySelector("textarea")
		if (field) field.value = ""
		// The library's first page, newest first, shows the new card, clipped as it comes in; anywhere
		// else (another page, a filter, another order) the toast is clipped.
		showToast({
			message:
				"batch" in answer ? t("add.savedMany", { count: answer.batch.length }) : t("add.saved"),
			clip: location.pathname !== "/library" || location.search !== "",
		})
	})
	useEffect(() => onAnswer(fetcher.data), [fetcher.data])

	return (
		<dialog
			ref={dialogRef}
			aria-label={t("add.title")}
			className="mx-auto mt-[8vh] mb-auto w-[min(34rem,94vw)] sm:mt-[12vh] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			<div className="flex flex-col gap-5 p-5 sm:p-6">
				<fetcher.Form
					ref={formRef}
					method="post"
					action="/library"
					onSubmit={() => prepareMotion()}
					onInput={(e) => {
						if (e.target instanceof HTMLTextAreaElement) draft.set(e.target.value)
					}}
					className="flex flex-col gap-4"
				>
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2 className="font-serif text-xl">{t("add.title")}</h2>
							<p className="mt-1 text-sm text-muted-fg">{t("add.description")}</p>
						</div>
						<button
							type="button"
							onClick={() => dialogRef.current?.close()}
							className="-mt-1 -mr-1 rounded-md p-1.5 text-muted-fg hover:bg-muted"
							aria-label={t("add.cancel")}
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>
					{batch && refused.length ? <LinkResults results={batch} /> : null}
					<LinksField
						// Again with only the links that were not saved, to fix or drop.
						key={batch ? `batch:${refused.map((result) => result.url).join(" ")}` : "links"}
						defaultValue={
							refused.length ? refused.map((result) => result.url).join("\n") : fetcher.data?.url
						}
						error={error}
					/>
					<div className="flex justify-end">
						<Button type="submit" disabled={saving}>
							{saving ? t("add.saving") : t("add.submit")}
						</Button>
					</div>
				</fetcher.Form>
				<Anywhere
					appUrl={layout?.appUrl ?? ""}
					mcpUrl={layout?.mcpUrl ?? ""}
					emailVerified={Boolean(layout?.user.emailVerified)}
				/>
			</div>
		</dialog>
	)
}

/**
 * The other ways in, each a line or two: the bookmarklet, an AI assistant connected to the library
 * (the MCP server, not named so), and blogs to follow.
 */
function Anywhere({
	appUrl,
	mcpUrl,
	emailVerified,
}: {
	appUrl: string
	mcpUrl: string
	emailVerified: boolean
}) {
	const { t } = useTranslation("library")
	const bookmarklet = `javascript:(function(){location.href=${JSON.stringify(`${appUrl}/add?url=`)}+encodeURIComponent(location.href)})()`
	const heading = "text-xs font-medium tracking-wide text-muted-fg uppercase"
	return (
		// Folded by default: worth a look at first, in the way after that.
		<details className="group/more details-slide border-t border-border pt-3 text-sm">
			<summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 font-medium text-muted-fg select-none hover:text-fg [&::-webkit-details-marker]:hidden">
				<ChevronRight
					className="size-4 motion-safe:transition-transform group-open/more:rotate-90"
					aria-hidden
				/>
				{t("add.others")}
			</summary>
			<div className="flex flex-col gap-4 pt-3">
				{/* A touch screen has no bookmarks bar to drag it to. */}
				<section aria-labelledby="save-anywhere" className="[@media(pointer:coarse)]:hidden">
					<h3 id="save-anywhere" className={heading}>
						{t("add.anywhere.title")}
					</h3>
					<p className="mt-1 text-muted-fg">{t("add.anywhere.description")}</p>
					<a
						// By hand: React blocks a `javascript:` href, which is what a bookmarklet is. It is for
						// dragging to the bookmarks bar, not for clicking here.
						href="/add"
						ref={(link) => {
							link?.setAttribute("href", bookmarklet)
							if (link) link.onclick = (event) => event.preventDefault()
						}}
						draggable
						className="mt-2 inline-flex cursor-grab items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 font-medium text-fg"
					>
						<Bookmark className="size-4" aria-hidden />
						{t("add.anywhere.label")}
					</a>
				</section>
				<section aria-labelledby="save-assistant">
					<h3 id="save-assistant" className={heading}>
						{t("add.assistant.title")}
					</h3>
					<p className="mt-1 text-muted-fg">
						{emailVerified ? (
							t("add.assistant.description")
						) : (
							<Trans
								t={t}
								i18nKey="add.assistant.verify"
								components={{
									account: <Link to="/settings/account" className="text-link hover:underline" />,
								}}
							/>
						)}
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
						<CopyButton
							text={t("add.assistant.prompt", { url: mcpUrl })}
							label={t("add.assistant.copy")}
						/>
						<Link to="/settings/connected-apps" className="text-link hover:underline">
							{t("add.assistant.manage")}
						</Link>
					</div>
				</section>
				<p className="text-muted-fg">
					<Trans
						t={t}
						i18nKey="add.feed"
						components={{ feed: <Link to="/feed" className="text-link hover:underline" /> }}
					/>
				</p>
			</div>
		</details>
	)
}

function CopyButton({
	text,
	label,
	className,
}: {
	text: string
	label: string
	className?: string
}) {
	const { t } = useTranslation("library")
	const [copied, setCopied] = useState(false)
	return (
		<Button
			type="button"
			variant="secondary"
			size="sm"
			className={className}
			onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
		>
			{copied ? t("add.assistant.copied") : label}
		</Button>
	)
}
