import {
	Archive,
	ArchiveRestore,
	CheckCheck,
	CircleCheck,
	EyeOff,
	type LucideIcon,
	Newspaper,
	Star,
	Tag,
	Trash2,
	Undo2,
	X,
} from "lucide-react"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { useEditions } from "~/hooks/use-editions"
import type { ListSelection } from "~/hooks/use-list-cursor"
import { BULK_ACTION, BULK_FETCHER, type BulkAction, bulkActions, MOVES } from "~/lib/bulk-actions"
import { useCommands } from "~/lib/commands"
import { type Leave, playLeave } from "~/lib/motion"
import { type ArticleShortcut, articleShortcut, SHORTCUT_HINTS } from "~/lib/shortcuts"
import { showToast } from "~/lib/toast"
import { cn } from "~/lib/utils"
import type { WebResult } from "~/lib/web-result"
import type { BulkDone } from "~/routes/documents.bulk"
import type { LibraryCard } from "~/services/documents.server"
import { BulkTagDialog } from "./bulk-tag-dialog"
import { tooltip } from "./tooltip-host"

const ICONS: Record<BulkAction, LucideIcon> = {
	star: Star,
	unstar: Star,
	shortlist: Newspaper,
	unshortlist: Newspaper,
	archive: Archive,
	unarchive: ArchiveRestore,
	finish: CircleCheck,
	unread: EyeOff,
	tag: Tag,
	delete: Trash2,
	restore: Undo2,
}

/** The key that does the same while there is a selection. Finishing has none: `u` is unread. */
const KEYS: Partial<Record<BulkAction, string>> = {
	star: SHORTCUT_HINTS.star,
	unstar: SHORTCUT_HINTS.star,
	shortlist: SHORTCUT_HINTS.shortlist,
	unshortlist: SHORTCUT_HINTS.shortlist,
	archive: SHORTCUT_HINTS.archive,
	unarchive: SHORTCUT_HINTS.archive,
	unread: SHORTCUT_HINTS.unread,
	tag: SHORTCUT_HINTS.tags,
	delete: SHORTCUT_HINTS.delete,
}

/** How the checked cards leave the list, for the actions that move them (`~/lib/motion`). */
const LEAVES: Partial<Record<BulkAction, Leave>> = {
	archive: "archive",
	finish: "archive",
	unarchive: "lift",
	delete: "lift",
	restore: "lift",
}

/** The refusals a tag change can meet, and what the toast says for each. */
const TAG_ERRORS: Record<
	string,
	"tags.errors.invalid_name" | "tags.errors.too_many_tags" | "bulkTags.errors.too_many_on_article"
> = {
	invalid_request: "tags.errors.invalid_name",
	too_many_tags: "tags.errors.too_many_tags",
	too_many_article_tags: "bulkTags.errors.too_many_on_article",
}

/**
 * Multi-select's actions. While the list is selecting, a bar floats at the bottom of the page's
 * column with the count and what the checked articles allow (`bulkActions`); the same actions answer
 * their keys and are in the command palette. Always mounted: the bulk fetcher, which the list reads
 * for its optimistic cards, answers here with the toast and its undo.
 */
export function SelectionBar({
	items,
	selection,
}: {
	/** The cards on the page; the checked ones are acted on. */
	items: LibraryCard[]
	selection: ListSelection
}) {
	const { t, i18n } = useTranslation("library")
	const bulk = useFetcher<WebResult<BulkDone>>({ key: BULK_FETCHER })
	const [tagging, setTagging] = useState(false)
	const cards = items.filter((d) => selection.checked.has(d.id))
	const n = cards.length
	const choice = bulkActions(cards, { editions: useEditions() })
	const shown = selection.selecting
	const allChecked = selection.scope.every((id) => selection.checked.has(id))

	const run = (action: BulkAction, names: string[] = []) => {
		const ids = cards.map((c) => c.id)
		const form = new FormData()
		form.set("intent", action)
		form.set("ids", ids.join(","))
		for (const name of names) form.append("name", name)
		const leave = LEAVES[action]
		if (leave)
			playLeave(
				action === "finish" ? cards.filter((c) => !c.archivedAt).map((c) => c.id) : ids,
				leave,
				{ label: t("card.archiveStamp"), locale: i18n.language },
			)
		void bulk.submit(form, { method: "post", action: BULK_ACTION })
		// Moved elsewhere: out of the selection. A refused restore stays (see the answer below).
		if (MOVES.has(action) && action !== "restore")
			selection.uncheck(
				action === "finish" ? cards.filter((c) => !c.archivedAt).map((c) => c.id) : ids,
			)
	}
	const act = (action: BulkAction) => {
		if (action === "tag") setTagging(true)
		else run(action)
	}

	// The answer: a toast with its undo.
	const uncheck = useRef(selection.uncheck)
	useInsertionEffect(() => {
		uncheck.current = selection.uncheck
	})
	useEffect(() => {
		const data = bulk.data
		if (!data) return
		if (!data.ok) {
			const tagError = TAG_ERRORS[data.error.code]
			showToast({ message: tagError ? t(tagError) : t("bulk.failed"), warn: true })
			return
		}
		const count = data.changed.length
		const conflicts = data.alreadySaved?.length ?? 0
		if (data.intent === "restore") uncheck.current(data.changed)
		const message =
			data.intent === "tag" && count === 0
				? t("bulk.tagNone")
				: [
						count > 0 || conflicts === 0 ? t(`bulk.${data.intent as BulkAction}`, { count }) : null,
						conflicts > 0 ? t("bulk.conflicts", { count: conflicts }) : null,
					]
						.filter(Boolean)
						.join(" · ")
		showToast({
			message,
			warn: conflicts > 0,
			undo: data.undo
				? {
						action: BULK_ACTION,
						intent: data.undo.intent,
						fields: data.undo.fields,
						label: t("toast.undo"),
					}
				: undefined,
		})
	}, [bulk.data, t])

	// Toasts stack above the bar while it is up (app.css).
	useEffect(() => {
		if (!shown) return
		document.documentElement.dataset.selectionBar = ""
		return () => {
			delete document.documentElement.dataset.selectionBar
		}
	}, [shown])

	// With a selection, the article keys act on it. Trashed articles answer no keys, as their cards.
	const onKey = (shortcut: ArticleShortcut): boolean => {
		if (n === 0 || choice.kind !== "live") return false
		const has = (a: BulkAction) => choice.actions.includes(a)
		const pick: Partial<Record<ArticleShortcut, BulkAction | null>> = {
			star: has("star") ? "star" : has("unstar") ? "unstar" : null,
			shortlist: has("shortlist") ? "shortlist" : has("unshortlist") ? "unshortlist" : null,
			archive: has("archive") ? "archive" : has("unarchive") ? "unarchive" : null,
			unread: has("tag") ? "unread" : null,
			tags: has("tag") ? "tag" : null,
			delete: "delete",
		}
		const action = pick[shortcut]
		if (!action) return false
		act(action)
		return true
	}
	const onKeyRef = useRef(onKey)
	useInsertionEffect(() => {
		onKeyRef.current = onKey
	})
	useEffect(() => {
		const listener = (e: KeyboardEvent) => {
			const shortcut = articleShortcut(e)
			if (shortcut && onKeyRef.current(shortcut)) e.preventDefault()
		}
		document.addEventListener("keydown", listener)
		return () => document.removeEventListener("keydown", listener)
	}, [])

	useCommands(() =>
		n > 0
			? {
					heading: t("select.count", { count: n }),
					commands: [
						...choice.actions.map((action) => ({
							id: `bulk-${action}`,
							label: t(`select.actions.${action}`),
							icon: ICONS[action],
							shortcut: KEYS[action],
							danger: action === "delete",
							run: () => act(action),
						})),
						...(allChecked
							? []
							: [
									{
										id: "bulk-select-all",
										label: t("select.all", { count: selection.scope.length }),
										icon: CheckCheck,
										run: selection.selectAll,
									},
								]),
						{ id: "bulk-clear", label: t("select.clear"), icon: X, run: selection.clear },
					],
				}
			: null,
	)

	const liveIds = cards.filter((c) => !c.deletedAt).map((c) => c.id)
	const trashedIds = cards.filter((c) => c.deletedAt).map((c) => c.id)
	return (
		<>
			{shown ? (
				// Sticky in the page's column: centred over the list, and at its end it rests below the
				// last card instead of covering it.
				<div className="pointer-events-none sticky bottom-0 z-30 flex justify-center pt-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
					<div
						role="toolbar"
						aria-label={t("select.toolbar")}
						data-testid="selection-bar"
						className={cn(
							"pointer-events-auto flex max-w-full items-center gap-0.5 rounded-2xl bg-fg p-1.5 text-sm text-bg shadow-lg max-sm:w-full",
							choice.kind === "mixed" && "flex-wrap justify-center",
						)}
					>
						<button
							type="button"
							onClick={selection.clear}
							aria-label={t("select.clear")}
							{...tooltip(t("select.clear"), "Esc")}
							className="shrink-0 rounded-lg p-2 text-bg/70 hover:bg-bg/10 hover:text-bg focus-visible:outline-link-inverse"
						>
							<X className="size-4" aria-hidden />
						</button>
						<span
							aria-live="polite"
							className="shrink-0 px-1.5 font-semibold whitespace-nowrap tabular-nums"
						>
							{n === 0 ? (
								<span className="font-normal text-bg/70">{t("select.none")}</span>
							) : (
								<>
									<span aria-hidden className="sm:hidden">
										{n}
									</span>
									<span className="max-sm:sr-only">{t("select.count", { count: n })}</span>
								</>
							)}
						</span>
						{!allChecked && selection.scope.length > 0 ? (
							<button
								type="button"
								onClick={selection.selectAll}
								aria-label={t("select.all", { count: selection.scope.length })}
								className="shrink-0 rounded-lg px-2 py-1.5 whitespace-nowrap text-link-inverse hover:bg-bg/10 focus-visible:outline-link-inverse"
							>
								<span className="max-sm:hidden">
									{t("select.all", { count: selection.scope.length })}
								</span>
								<span className="sm:hidden">{t("select.allShort")}</span>
							</button>
						) : null}
						{choice.kind === "mixed" ? (
							<>
								<span className="px-1.5 text-bg/70">{t("select.mixed")}</span>
								<button
									type="button"
									onClick={() => selection.uncheck(trashedIds)}
									className="rounded-lg px-2 py-1.5 text-link-inverse hover:bg-bg/10 focus-visible:outline-link-inverse"
								>
									{t("select.keepLive", { count: liveIds.length })}
								</button>
								<button
									type="button"
									onClick={() => selection.uncheck(liveIds)}
									className="rounded-lg px-2 py-1.5 text-link-inverse hover:bg-bg/10 focus-visible:outline-link-inverse"
								>
									{t("select.keepTrashed", { count: trashedIds.length })}
								</button>
							</>
						) : choice.actions.length > 0 ? (
							<>
								<span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-bg/20 max-sm:hidden" />
								<span aria-hidden className="flex-1 sm:hidden" />
								{choice.actions.map((action) => {
									const Icon = ICONS[action]
									const label = t(`select.actions.${action}`)
									return (
										<button
											key={action}
											type="button"
											onClick={() => act(action)}
											aria-label={label}
											{...tooltip(label, KEYS[action])}
											className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 whitespace-nowrap hover:bg-bg/10 focus-visible:outline-link-inverse max-sm:p-2.5"
										>
											<Icon
												className={cn(
													"size-4",
													action === "unstar" && "fill-favorite-inverse text-favorite-inverse",
													action === "unshortlist" && "text-link-inverse",
												)}
												aria-hidden
											/>
											<span className="max-sm:hidden">{label}</span>
										</button>
									)
								})}
							</>
						) : null}
					</div>
				</div>
			) : null}
			{tagging ? (
				<BulkTagDialog
					cards={cards}
					onAdd={(names) => run("tag", names)}
					onClose={() => setTagging(false)}
				/>
			) : null}
		</>
	)
}
