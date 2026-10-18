import { LifeBuoy, LoaderCircle, X } from "lucide-react"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { SUPPORT_CONTACT } from "~/lib/company"
import { SUPPYHQ_ORIGIN, supportPanelUrl } from "~/lib/support-widget"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"

/** The page's theme: the account's choice on `<html>`, or the system's. */
function pageTheme(): "light" | "dark" {
	const chosen = document.documentElement.dataset.theme
	if (chosen === "light" || chosen === "dark") return chosen
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

const OPEN_EVENT = "klipstack:support"

/** The sidebar's way to the support panel: nothing reaches SuppyHQ before someone clicks it. */
export function SupportButton({
	collapsed = false,
	onOpen,
}: {
	/** Icon only, as a rail. */
	collapsed?: boolean
	/** The phone drawer closes itself. */
	onOpen?: () => void
}) {
	const { t } = useTranslation()
	const label = t("supportWidget.open")
	return (
		<button
			type="button"
			onClick={() => {
				onOpen?.()
				window.dispatchEvent(new Event(OPEN_EVENT))
			}}
			aria-haspopup="dialog"
			aria-label={label}
			{...tooltip(label, undefined, "right")}
			className={cn(
				"flex items-center gap-2 rounded-lg text-sm text-muted-fg hover:bg-fg/10 hover:text-fg",
				collapsed ? "mx-auto size-9 justify-center" : "w-full px-2 py-2 md:py-1.5",
			)}
		>
			<span className="flex w-6 shrink-0 justify-center">
				<LifeBuoy className="size-4" aria-hidden />
			</span>
			{collapsed ? null : <span>{label}</span>}
		</button>
	)
}

/**
 * SuppyHQ's contact panel, in a frame of the app's own, opened by `SupportButton`. The frame loads
 * on the first opening and stays, hidden, when closed: what someone typed is there when they come
 * back. Until the panel says it has drawn, a spinner holds its place; a panel that never does (an
 * outage, a blocker, a changed address) gives way to the support email.
 */
export function SupportPanel({
	tenant,
	email,
	name,
}: {
	tenant: string
	email: string
	name: string
}) {
	const { t } = useTranslation()
	const frameRef = useRef<HTMLIFrameElement>(null)
	const [src, setSrc] = useState<string | null>(null)
	const [open, setOpen] = useState(false)
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading")
	const [height, setHeight] = useState(420)

	const copy = {
		label: t("supportWidget.label"),
		headline: t("supportWidget.greeting"),
		successTitle: t("supportWidget.acknowledgment"),
		successMessage: t("supportWidget.expectation"),
	}
	const post = (message: object) =>
		frameRef.current?.contentWindow?.postMessage(message, SUPPYHQ_ORIGIN)

	// The first opening loads the panel, with the account, the copy and the theme of that moment.
	const onOpen = useEffectEvent(() => {
		setOpen(true)
		setSrc((current) => current ?? supportPanelUrl(tenant, { email, name }, copy, pageTheme()))
	})
	useEffect(() => {
		window.addEventListener(OPEN_EVENT, onOpen)
		return () => window.removeEventListener(OPEN_EVENT, onOpen)
	}, [])

	// Another account or language starts a fresh panel on the next opening.
	const identity = `${tenant}|${email}|${name}|${Object.values(copy).join("|")}`
	const [loadedFor, setLoadedFor] = useState(identity)
	if (loadedFor !== identity) {
		setLoadedFor(identity)
		setSrc(null)
		setOpen(false)
		setState("loading")
	}

	// The panel's messages: its height once drawn and whenever it changes, and its close button.
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.origin !== SUPPYHQ_ORIGIN || event.source !== frameRef.current?.contentWindow)
				return
			const message = event.data as { type?: string; height?: unknown }
			if (message.type === "suppyhq:resize" && Number.isFinite(message.height)) {
				// Never taller than the window: the panel can't cover the page.
				setHeight(Math.min(Math.max(message.height as number, 0), window.innerHeight - 32))
				// Also after the fallback: a slow panel that arrives takes its place.
				setState("ready")
			} else if (message.type === "suppyhq:close") setOpen(false)
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [])

	useEffect(() => {
		if (!src || state !== "loading") return
		const timeout = setTimeout(() => setState("failed"), 8000)
		return () => clearTimeout(timeout)
	}, [src, state])

	// Each opening of a drawn panel puts the cursor in its message field.
	useEffect(() => {
		if (open && state === "ready") post({ type: "suppyhq:focus" })
	}, [open, state])

	// The panel follows the app's theme, also while open.
	const [theme, setTheme] = useState<"light" | "dark">("light")
	useEffect(() => {
		const sync = () => setTheme(pageTheme())
		sync()
		const scheme = matchMedia("(prefers-color-scheme: dark)")
		scheme.addEventListener("change", sync)
		const observer = new MutationObserver(sync)
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		})
		return () => {
			scheme.removeEventListener("change", sync)
			observer.disconnect()
		}
	}, [])
	useEffect(() => {
		if (state === "ready") post({ type: "suppyhq:theme", theme })
	}, [theme, state])

	useEffect(() => {
		if (!open) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false)
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [open])

	if (!src) return null
	return (
		<div
			role="dialog"
			aria-label={t("supportWidget.open")}
			hidden={!open}
			className="fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),1rem)] z-50 mx-auto max-w-[340px] md:right-auto md:left-4 md:mx-0 md:w-[340px]"
		>
			{state === "ready" ? null : (
				<div className="relative flex min-h-40 flex-col items-center justify-center gap-3 rounded-[18px] border border-border bg-card p-6 text-center text-sm shadow-2xl">
					<button
						type="button"
						onClick={() => setOpen(false)}
						aria-label={t("actions.close")}
						className="absolute top-3 right-3 rounded-full p-1.5 text-muted-fg hover:bg-hover hover:text-fg"
					>
						<X className="size-4" aria-hidden />
					</button>
					{state === "loading" ? (
						<LoaderCircle
							className="size-5 animate-spin text-muted-fg"
							aria-label={t("supportWidget.loading")}
						/>
					) : (
						<p>
							<Trans
								t={t}
								i18nKey="supportWidget.unavailable"
								values={{ email: SUPPORT_CONTACT }}
								components={{
									email: (
										<a
											href={`mailto:${SUPPORT_CONTACT}`}
											className="text-link underline underline-offset-2"
										>
											{SUPPORT_CONTACT}
										</a>
									),
								}}
							/>
						</p>
					)}
				</div>
			)}
			<iframe
				ref={frameRef}
				src={src}
				title={t("supportWidget.open")}
				// Scripts and its form, but no navigating the app's tab; popups for its own link.
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
				referrerPolicy="no-referrer"
				style={{ height, colorScheme: theme }}
				className={cn(
					"block w-full rounded-[18px] border-0 bg-transparent shadow-2xl ring-1 ring-fg/5",
					// Drawn off-screen until ready: the frame loads, but its empty box never shows.
					state === "ready" ? "" : "pointer-events-none fixed -left-[9999px] w-[340px] opacity-0",
				)}
			/>
		</div>
	)
}
