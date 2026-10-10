import { resources } from "@klipstack/i18n"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useRevalidator } from "react-router"
import { Button } from "~/components/ui/button"
import { isKeyOf } from "~/lib/i18n-keys"
import { cn } from "~/lib/utils"

/** The same text on the server and in any browser: UTC, in the page's language. */
export function useUtcTime() {
	const { i18n, t } = useTranslation("admin")
	return (iso: string | null | undefined) => {
		if (!iso) return null
		const text = new Intl.DateTimeFormat(i18n.language, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "UTC",
		}).format(new Date(iso))
		return `${text} ${t("common.utc")}`
	}
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
	return (
		<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
			<h1 className="text-2xl font-semibold">{title}</h1>
			<div className="flex flex-wrap items-center gap-3">{children}</div>
		</div>
	)
}

/** Lists refresh on demand (and after a change); nothing polls them. */
export function RefreshButton() {
	const { t } = useTranslation("admin")
	const revalidator = useRevalidator()
	const busy = revalidator.state !== "idle"
	return (
		<Button variant="secondary" size="sm" disabled={busy} onClick={() => revalidator.revalidate()}>
			{busy ? t("common.refreshing") : t("common.refresh")}
		</Button>
	)
}

const REFRESH_MS = 30_000
const STALE_MS = 75_000

/**
 * Overview and System reload every 30 seconds while the tab is visible. `stale` says the data on
 * screen is older than two missed refreshes (a hidden tab, a failing network).
 */
export function useAutoRefresh(observedAt: string) {
	const revalidator = useRevalidator()
	// The observation found stale, if any: a newer one is fresh again without being told so.
	const [staleAt, setStaleAt] = useState<string | null>(null)
	useEffect(() => {
		const tick = () => {
			setStaleAt(Date.now() - new Date(observedAt).getTime() > STALE_MS ? observedAt : null)
			if (document.visibilityState === "visible" && revalidator.state === "idle")
				void revalidator.revalidate()
		}
		const timer = window.setInterval(tick, REFRESH_MS)
		const onVisible = () => {
			if (document.visibilityState === "visible") tick()
		}
		document.addEventListener("visibilitychange", onVisible)
		return () => {
			window.clearInterval(timer)
			document.removeEventListener("visibilitychange", onVisible)
		}
	}, [observedAt, revalidator])
	return { stale: staleAt === observedAt, refreshing: revalidator.state !== "idle" }
}

export function ObservedLine({ observedAt, stale }: { observedAt: string; stale: boolean }) {
	const { t } = useTranslation("admin")
	const time = useUtcTime()
	return (
		<p className="text-sm text-muted-fg" aria-live="polite">
			{t("common.observedAt", { time: time(observedAt) })}
			{stale ? <span className="ml-2 text-danger">{t("common.stale")}</span> : null}
		</p>
	)
}

/** Shown in place of a number that could not be read. Never a zero. */
export function Unavailable() {
	const { t } = useTranslation("admin")
	return (
		<span className="text-danger" title={t("common.unavailableDetail")} data-testid="unavailable">
			{t("common.unavailable")}
		</span>
	)
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="rounded-xl border border-border bg-card p-4">
			<h2 className="mb-3 text-sm font-semibold text-muted-fg">{title}</h2>
			{children}
		</section>
	)
}

export function Badge({
	tone = "neutral",
	children,
}: {
	tone?: "neutral" | "good" | "bad" | "warn"
	children: React.ReactNode
}) {
	return (
		<span
			className={cn(
				"inline-block rounded-full px-2 py-0.5 text-xs font-medium",
				tone === "good" && "bg-accent/15 text-fg",
				tone === "bad" && "bg-danger/15 text-danger",
				tone === "warn" && "bg-muted text-fg",
				tone === "neutral" && "bg-muted text-muted-fg",
			)}
		>
			{children}
		</span>
	)
}

/** A table that scrolls sideways on a phone instead of breaking the page. */
export function Table({
	caption,
	head,
	children,
}: {
	caption: string
	head: string[]
	children: React.ReactNode
}) {
	return (
		<div className="overflow-x-auto rounded-xl border border-border">
			<table className="w-full min-w-[40rem] border-collapse text-left text-sm">
				<caption className="sr-only">{caption}</caption>
				<thead className="bg-muted text-xs text-muted-fg">
					<tr>
						{head.map((label) => (
							<th key={label} scope="col" className="px-3 py-2 font-medium">
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="[&>tr]:border-border [&>tr]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">
					{children}
				</tbody>
			</table>
		</div>
	)
}

export function Empty({ children }: { children: React.ReactNode }) {
	return <p className="rounded-xl border border-border p-6 text-sm text-muted-fg">{children}</p>
}

/** IDs are long: monospace, and allowed to break. */
export function Mono({ children }: { children: React.ReactNode }) {
	return <code className="break-all font-mono text-xs">{children}</code>
}

export function Pager({
	path,
	nextCursor,
	params,
}: {
	path: string
	nextCursor: string | null
	params?: Record<string, string | null | undefined>
}) {
	const { t } = useTranslation("admin")
	const query = (cursor?: string) => {
		const search = new URLSearchParams()
		for (const [key, value] of Object.entries(params ?? {})) if (value) search.set(key, value)
		if (cursor) search.set("cursor", cursor)
		const text = search.toString()
		return text ? `${path}?${text}` : path
	}
	return (
		<nav className="mt-4 flex gap-4 text-sm" aria-label="pagination">
			<Link to={query()} prefetch="none" className="text-link hover:underline">
				{t("common.first")}
			</Link>
			{nextCursor ? (
				<Link to={query(nextCursor)} prefetch="none" className="text-link hover:underline">
					{t("common.next")}
				</Link>
			) : null}
		</nav>
	)
}

/** Invite codes are the one secret admin pages show: copying them is the feature. */
export function CopyCode({ code }: { code: string }) {
	const { t } = useTranslation("admin")
	const [copied, setCopied] = useState(false)
	useEffect(() => {
		if (!copied) return
		const timer = window.setTimeout(() => setCopied(false), 2000)
		return () => window.clearTimeout(timer)
	}, [copied])
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}
		>
			{copied ? t("invites.copied") : t("invites.copy")}
		</Button>
	)
}

/** One change per confirmation: the first click asks, the second one submits. */
export function ConfirmSubmit({
	label,
	question,
	busy,
	variant = "secondary",
}: {
	label: string
	question: string
	busy: boolean
	variant?: "secondary" | "danger"
}) {
	const { t } = useTranslation("admin")
	const [asking, setAsking] = useState(false)
	// A submission answers the question: the next change asks again.
	if (busy && asking) setAsking(false)
	if (!asking)
		return (
			<Button variant={variant} size="sm" disabled={busy} onClick={() => setAsking(true)}>
				{label}
			</Button>
		)
	return (
		<span className="flex flex-wrap items-center gap-2">
			<span className="text-xs text-muted-fg">{question}</span>
			<Button type="submit" variant={variant} size="sm">
				{t("common.confirm")}
			</Button>
			<Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
				{t("common.cancel")}
			</Button>
		</span>
	)
}

/** The message for an action's `{ ok: false, error }` answer. Codes without a string are generic. */
export function ActionError({ code }: { code: string | null | undefined }) {
	const { t } = useTranslation("admin")
	if (!code) return null
	const name = code === "invalid_request" ? "invalid" : code
	return (
		<p className="text-sm text-danger" role="alert">
			{isKeyOf(resources.en.admin.errors, name) ? t(`errors.${name}`) : t("errors.unexpected")}
		</p>
	)
}
