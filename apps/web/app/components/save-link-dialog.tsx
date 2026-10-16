import { Bookmark, Plus, X } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react"
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
export function SaveLinkButton() {
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
			className="size-10 rounded-md text-accent"
		>
			<Plus className="size-5" aria-hidden />
		</Button>
	)
}

type Tab = "links" | "assistant"

export function SaveLinkDialog() {
	const { t } = useTranslation("library")
	const layout = useRouteLoaderData<typeof layoutLoader>("routes/app-layout")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const formRef = useRef<HTMLFormElement>(null)
	const [tab, setTab] = useState<Tab>("links")
	// What the field starts with, and a key to start it again with each opening.
	const [prefill, setPrefill] = useState({ url: "", key: 0 })
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
	const id = useId()

	const close = useCallback(() => {
		dialogRef.current?.close()
		formRef.current?.reset()
	}, [])
	const open = useCallback((url: string) => {
		const d = dialogRef.current
		if (!d) return
		setTab("links")
		setPrefill((before) => ({ url, key: before.key + 1 }))
		if (!d.open) d.showModal()
	}, [])
	// Each opening draws the field again, with what it starts with: then it takes the focus.
	useEffect(() => {
		if (prefill.key && dialogRef.current?.open) dialogRef.current.querySelector("textarea")?.focus()
	}, [prefill.key])

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

	const tabs: { name: Tab; label: string }[] = [
		{ name: "links", label: t("add.tabs.links") },
		{ name: "assistant", label: t("add.tabs.assistant") },
	]

	return (
		<dialog
			ref={dialogRef}
			aria-label={t("add.title")}
			className="m-auto w-[min(34rem,94vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			<div className="flex flex-col gap-5 p-5 sm:p-6">
				<div className="flex items-center justify-between gap-4">
					<div
						role="tablist"
						aria-label={t("add.tabs.label")}
						className="flex rounded-full bg-muted p-1 text-sm"
					>
						{tabs.map(({ name, label }) => (
							<button
								key={name}
								type="button"
								role="tab"
								id={`${id}-${name}`}
								aria-selected={tab === name}
								aria-controls={`${id}-${name}-panel`}
								onClick={() => setTab(name)}
								className={cn(
									"rounded-full px-3 py-1.5 font-medium whitespace-nowrap",
									tab === name ? "bg-card text-fg shadow-xs" : "text-muted-fg hover:text-fg",
								)}
							>
								{label}
							</button>
						))}
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

				{/* Both stay drawn, so what was typed survives a look at the other. */}
				<div
					role="tabpanel"
					id={`${id}-links-panel`}
					aria-labelledby={`${id}-links`}
					hidden={tab !== "links"}
					className="flex flex-col gap-5"
				>
					<fetcher.Form
						ref={formRef}
						method="post"
						action="/library"
						onSubmit={() => prepareMotion()}
						className="flex flex-col gap-4"
					>
						<div>
							<h2 className="font-serif text-xl">{t("add.title")}</h2>
							<p className="mt-1 text-sm text-muted-fg">{t("add.description")}</p>
						</div>
						{batch && refused.length ? <LinkResults results={batch} /> : null}
						<LinksField
							// Again with only the links that were not saved, to fix or drop.
							key={fetcher.data && "batch" in fetcher.data ? `batch-${prefill.key}` : prefill.key}
							defaultValue={
								refused.length
									? refused.map((result) => result.url).join("\n")
									: (fetcher.data?.url ?? prefill.url)
							}
							error={error}
						/>
						<div className="flex justify-end">
							<Button type="submit" disabled={saving}>
								{saving ? t("add.saving") : t("add.submit")}
							</Button>
						</div>
					</fetcher.Form>
					<Anywhere appUrl={layout?.appUrl ?? ""} />
				</div>

				<div
					role="tabpanel"
					id={`${id}-assistant-panel`}
					aria-labelledby={`${id}-assistant`}
					hidden={tab !== "assistant"}
				>
					<Assistant
						mcpUrl={layout?.mcpUrl ?? ""}
						emailVerified={Boolean(layout?.user.emailVerified)}
					/>
				</div>
			</div>
		</dialog>
	)
}

/** The bookmarklet, to save from any page, and where else articles come in. */
function Anywhere({ appUrl }: { appUrl: string }) {
	const { t } = useTranslation("library")
	const bookmarklet = `javascript:(function(){location.href=${JSON.stringify(`${appUrl}/add?url=`)}+encodeURIComponent(location.href)})()`
	return (
		<div className="border-t border-border pt-4 text-sm">
			{/* A touch screen has no bookmarks bar to drag it to. */}
			<section aria-labelledby="save-anywhere" className="mb-4 [@media(pointer:coarse)]:hidden">
				<h3
					id="save-anywhere"
					className="text-xs font-medium tracking-wide text-muted-fg uppercase"
				>
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
					className="mt-3 inline-flex cursor-grab items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 font-medium text-fg"
				>
					<Bookmark className="size-4" aria-hidden />
					{t("add.anywhere.label")}
				</a>
			</section>
			<p className="text-muted-fg">
				<Trans
					t={t}
					i18nKey="add.feed"
					components={{ feed: <Link to="/feed" className="text-link hover:underline" /> }}
				/>{" "}
				<Trans
					t={t}
					i18nKey="add.settings"
					components={{
						settings: <Link to="/settings/capture" className="text-link hover:underline" />,
					}}
				/>
			</p>
		</div>
	)
}

/**
 * An AI assistant that saves to and searches the library (the MCP server, not named so): its
 * address to paste into a chat app's connectors, and instructions for an agent on the computer.
 */
function Assistant({ mcpUrl, emailVerified }: { mcpUrl: string; emailVerified: boolean }) {
	const { t } = useTranslation("library")
	return (
		<div className="flex flex-col gap-4 text-sm leading-relaxed">
			<div>
				<h2 className="font-serif text-xl">{t("add.assistant.title")}</h2>
				<p className="mt-1 text-muted-fg">{t("add.assistant.description")}</p>
			</div>
			{emailVerified ? null : (
				<p className="rounded-lg bg-muted px-3 py-2">
					<Trans
						t={t}
						i18nKey="add.assistant.verify"
						components={{
							account: <Link to="/settings/account" className="text-link hover:underline" />,
						}}
					/>
				</p>
			)}
			<div className="rounded-xl border border-border p-4">
				<h3 className="font-medium">{t("add.assistant.chat.title")}</h3>
				<p className="mt-1 text-muted-fg">{t("add.assistant.chat.steps")}</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 [overflow-wrap:anywhere]">
						{mcpUrl}
					</code>
					<CopyButton text={mcpUrl} label={t("add.assistant.chat.copy")} />
				</div>
			</div>
			<div className="rounded-xl border border-border p-4">
				<h3 className="font-medium">{t("add.assistant.agent.title")}</h3>
				<p className="mt-1 text-muted-fg">{t("add.assistant.agent.description")}</p>
				<CopyButton
					text={t("add.assistant.agent.prompt", { url: mcpUrl })}
					label={t("add.assistant.agent.copy")}
					className="mt-3"
				/>
			</div>
			<Link to="/settings/connected-apps" className="text-link hover:underline">
				{t("add.assistant.manage")}
			</Link>
		</div>
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
			{copied ? t("add.copied") : label}
		</Button>
	)
}
