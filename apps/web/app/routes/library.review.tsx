import { Archive, Check, Inbox, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, redirect, useFetcher } from "react-router"
import { snoozeReviewSuggestion } from "~/commands/review.server"
import { MenuButton, MoreMenu } from "~/components/more-menu"
import { Button, buttonVariants } from "~/components/ui/button"
import { BULK_ACTION } from "~/lib/bulk-actions"
import type { PageBarHandle } from "~/lib/page-bar"
import { pageTitle } from "~/lib/page-title"
import { relativeTime } from "~/lib/relative-time"
import { readForm } from "~/lib/request-body.server"
import { REVIEW } from "~/lib/review"
import { requireUser } from "~/lib/session.server"
import { sourceLabel } from "~/lib/site-label"
import { showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"
import { type ReviewItem, listReview } from "~/services/review.server"
import type { Route } from "./+types/library.review"
import type { BulkDone } from "./documents.bulk"

export function meta({ matches }: Route.MetaArgs) {
	return [{ title: pageTitle(matches, "library:review.title") }]
}

export const handle: PageBarHandle = { pageBar: { titleKey: "library:review.title" } }

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = requireUser(context, request)
	return listReview(user.id)
}

/**
 * POST /library/review: `intent=open` (Home's card) puts the card off and opens the review;
 * `intent=snooze` ("Not now") only puts it off. Keeping, archiving and deleting post to
 * /documents/bulk, like every other article change.
 */
export async function action({ context, request }: Route.ActionArgs) {
	const user = requireUser(context, request)
	const intent = (await readForm(request)).get("intent")
	await snoozeReviewSuggestion(user.id)
	if (intent === "open") throw redirect("/library/review")
	return { ok: true as const }
}

type ReviewIntent = "keep" | "archive" | "delete"

/** A change on its way: its articles leave the list at once, and come back if it fails. */
interface Change {
	key: string
	intent: ReviewIntent
	ids: string[]
}

let seq = 0

/**
 * Old saves never opened, the oldest first: keep them or let them go, one at a time or all those
 * shown. Archiving comes first; deleting is in each article's menu. Every change has its undo.
 */
export default function Review({ loaderData: { items, more } }: Route.ComponentProps) {
	const { t } = useTranslation("library")
	const [changes, setChanges] = useState<Change[]>([])
	const leaving = new Set(changes.flatMap((c) => c.ids))
	const shown = items.filter((d) => !leaving.has(d.id))
	const change = (intent: ReviewIntent, ids: string[]) =>
		setChanges((all) => [...all, { key: `review-${++seq}`, intent, ids }])
	/** One article leaves: the focus moves to the one taking its place, not to the page. */
	const changeOne = (intent: ReviewIntent, id: string, from: HTMLElement) => {
		const row = from.closest("li")
		const next = (row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null
		next?.querySelector("button")?.focus()
		change(intent, [id])
	}
	const done = useCallback(
		(key: string) => setChanges((all) => all.filter((c) => c.key !== key)),
		[],
	)

	return (
		<main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-3 pb-12 md:px-8 md:pt-4">
			<h1 className="hidden text-2xl font-semibold md:block">{t("review.title")}</h1>
			<p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-fg md:mt-3">
				{t("review.description")}
			</p>
			{changes.map((c) => (
				<SendChange key={c.key} change={c} onDone={done} />
			))}
			{shown.length === 0 ? (
				changes.length === 0 ? (
					<div className="mt-12 flex flex-col items-center gap-3 text-center md:mt-16">
						<Inbox className="size-10 text-muted-fg" aria-hidden />
						<h2 className="text-lg font-medium">{t("review.empty.title")}</h2>
						<p className="max-w-sm text-sm text-muted-fg">{t("review.empty.description")}</p>
						<Link to="/home" className={buttonVariants({ variant: "secondary" })}>
							{t("review.empty.action")}
						</Link>
					</div>
				) : null
			) : (
				<>
					{shown.length > 1 ? (
						<div className="mt-6 flex flex-wrap items-center gap-2">
							<Button
								onClick={() =>
									change(
										"archive",
										shown.map((d) => d.id),
									)
								}
							>
								<Archive className="size-4" aria-hidden />
								{t("review.archiveAll", { count: shown.length })}
							</Button>
							<Button
								variant="secondary"
								onClick={() =>
									change(
										"keep",
										shown.map((d) => d.id),
									)
								}
							>
								<Check className="size-4" aria-hidden />
								{t("review.keepAll", { count: shown.length })}
							</Button>
						</div>
					) : null}
					<ul
						className="mt-6 divide-y divide-border border-y border-border"
						data-testid="review-list"
					>
						{shown.map((doc) => (
							<ReviewRow
								key={doc.id}
								doc={doc}
								onChange={(intent, from) => changeOne(intent, doc.id, from)}
							/>
						))}
					</ul>
					{more ? (
						<p className="mt-4 text-sm text-muted-fg">
							{t("review.oldestFirst", { count: REVIEW.pageSize })}
						</p>
					) : null}
				</>
			)}
		</main>
	)
}

function ReviewRow({
	doc,
	onChange,
}: {
	doc: ReviewItem
	onChange: (intent: ReviewIntent, from: HTMLElement) => void
}) {
	const { t, i18n } = useTranslation("library")
	const title = doc.title || t("review.untitled")
	const ref = useRef<HTMLLIElement>(null)
	const act = (intent: ReviewIntent) => {
		if (ref.current) onChange(intent, ref.current)
	}
	return (
		<li
			ref={ref}
			className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start"
			data-testid="review-item"
		>
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs text-muted-fg">
					{[
						sourceLabel(doc),
						t("review.saved", { when: relativeTime(doc.createdAt, i18n.language) }),
						doc.type === "article" && doc.readingMinutes
							? t("review.minutes", { count: doc.readingMinutes })
							: null,
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
				<Link
					to={`/read/${doc.id}`}
					state={{ from: "/library/review" }}
					className="mt-1 block font-medium hover:underline"
				>
					{title}
				</Link>
				{doc.description ? (
					<p className="mt-1 line-clamp-2 text-sm text-muted-fg">{doc.description}</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button size="sm" onClick={() => act("archive")}>
					<Archive className="size-4" aria-hidden />
					{t("review.archive")}
				</Button>
				<Button size="sm" variant="secondary" onClick={() => act("keep")}>
					<Check className="size-4" aria-hidden />
					{t("review.keep")}
				</Button>
				<MoreMenu label={t("review.more", { title })} className="p-2">
					<MenuButton
						danger
						icon={<Trash2 className="size-4" aria-hidden />}
						onClick={() => act("delete")}
					>
						{t("review.delete")}
					</MenuButton>
				</MoreMenu>
			</div>
		</li>
	)
}

/**
 * Sends one change and answers it with a toast and its undo. It stays mounted until the answer
 * comes, though its articles have left the list: with the answer, the list reloads without them.
 */
function SendChange({ change, onDone }: { change: Change; onDone: (key: string) => void }) {
	const { t } = useTranslation("library")
	const fetcher = useFetcher<WebResult<BulkDone>>({ key: change.key })
	const sent = useRef(false)
	useEffect(() => {
		if (sent.current) return
		sent.current = true
		void fetcher.submit(
			{ intent: change.intent, ids: change.ids.join(",") },
			{ method: "post", action: BULK_ACTION },
		)
	}, [fetcher, change])
	const { data, state } = fetcher
	useEffect(() => {
		if (!data || state !== "idle") return
		onDone(change.key)
		if (!data.ok) {
			showToast({ message: t("review.failed"), warn: true })
			return
		}
		const count = data.changed.length
		if (count === 0) return
		const one = change.ids.length === 1
		const message =
			change.intent === "keep"
				? one
					? t("review.kept")
					: t("review.keptMany", { count })
				: change.intent === "archive"
					? one
						? t("toast.archived")
						: t("bulk.archive", { count })
					: one
						? t("toast.deleted")
						: t("bulk.delete", { count })
		showToast({
			message,
			undo: data.undo
				? {
						action: BULK_ACTION,
						intent: data.undo.intent,
						fields: data.undo.fields,
						label: t("toast.undo"),
					}
				: undefined,
		})
	}, [data, state, change, onDone, t])
	return null
}
