import { NOTE_MAX } from "@klipstack/api-contract/names"
import { Headphones, NotebookPen, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher, useFetchers } from "react-router"
import { NoteField } from "~/components/note-field"
import { ArticleNoteLabel, NoteStatus } from "~/components/note-status"
import { PostIt, tiltFor, useGrowingFit } from "~/components/post-it"
import { Button } from "~/components/ui/button"
import { useNoteAutosave } from "~/hooks/use-note-autosave"
import { highlightColor } from "~/lib/highlight-colors"
import { relativeTime } from "~/lib/relative-time"
import { showToast } from "~/lib/toast"
import type { NoteReminder } from "~/services/note-reminders.server"

const ACTION = "/home/notes"

/** Articles on their way out ("Nothing to add" pressed, not yet answered). */
function useLeaving(): Set<string> {
	return new Set(
		useFetchers()
			.filter((f) => f.formAction === ACTION && f.formData?.get("intent") === "skip")
			.map((f) => String(f.formData?.get("id"))),
	)
}

/**
 * A gentle question about articles finished lately without a note (`listNoteReminders`): each
 * with a few of its highlights, to bring it back to mind, and its note written in place, on the
 * post-it the reader's end has. "Nothing to add" leaves one out for good, with undo; "Not now" puts
 * the card off for a week. It asks, never insists: no count of what is missing. It shows when Home
 * asks (`suggested`), then follows the list while the page is open, even once Home would no longer
 * ask: an undone "Nothing to add" comes back.
 */
export function HomeNotes({ items, suggested }: { items: NoteReminder[]; suggested: boolean }) {
	const { t } = useTranslation("library")
	const later = useFetcher()
	const leaving = useLeaving()
	// Every article the card has shown: one whose note is being written stays while Home loads
	// again (the note saved, it is no longer asked about), even when the card would no longer ask.
	const [seen, setSeen] = useState(items)
	const added = items.filter((item) => !seen.some((s) => s.id === item.id))
	if (added.length) setSeen([...seen, ...added])
	const [writing, setWriting] = useState<ReadonlySet<string>>(new Set())
	const [asking, setAsking] = useState(suggested)
	if (suggested && !asking) setAsking(true)
	const asked = new Set(asking ? items.map((item) => item.id) : [])
	const shown = [...seen, ...added].filter(
		(item) => (asked.has(item.id) || writing.has(item.id)) && !leaving.has(item.id),
	)
	// Put off: gone at once, and back if that failed.
	const putOff = later.state !== "idle" || (later.data as { ok?: boolean } | undefined)?.ok
	if (!shown.length || putOff) return null
	return (
		<section
			aria-labelledby="home-notes"
			data-testid="home-notes"
			className="mb-9 rounded-xl border border-border bg-card p-5"
		>
			<h2 id="home-notes" className="font-medium">
				{t("home.notes.title")}
			</h2>
			<p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-fg">
				{t("home.notes.description")}
			</p>
			<ul className="mt-5 grid gap-6">
				{shown.map((item) => (
					<NoteReminderItem
						key={item.id}
						item={item}
						writing={writing.has(item.id)}
						onWrite={() => setWriting((ids) => new Set(ids).add(item.id))}
					/>
				))}
			</ul>
			<later.Form method="post" action={ACTION} className="mt-5">
				<input type="hidden" name="intent" value="snooze" />
				<Button type="submit" variant="ghost">
					{t("home.notes.later")}
				</Button>
			</later.Form>
		</section>
	)
}

function NoteReminderItem({
	item,
	writing,
	onWrite,
}: {
	item: NoteReminder
	writing: boolean
	onWrite: () => void
}) {
	const { t, i18n } = useTranslation(["library", "reader"])
	const skip = useFetcher({ key: `home-note-skip-${item.id}` })
	const note = useNoteAutosave(item.id, null)
	const placeholder = t("reader:end.notePlaceholder")
	const fit = useGrowingFit(note.value || placeholder, item.id)
	const title = item.title || item.siteName || item.sourceUrl
	const when = relativeTime(item.finishedAt, i18n.language)
	return (
		<li data-testid="home-note" className="grid gap-3">
			<div className="min-w-0">
				<Link
					to={`/read/${item.id}`}
					state={{ from: "/home" }}
					className="font-serif text-lg leading-snug font-semibold text-fg hover:underline"
				>
					{title}
				</Link>
				<p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-fg">
					{item.listened ? <Headphones className="size-3.5" aria-hidden /> : null}
					{item.listened ? t("home.notes.listened", { when }) : t("home.notes.finished", { when })}
					{item.siteName && item.siteName !== title ? ` · ${item.siteName}` : null}
				</p>
			</div>
			{item.highlights.length ? (
				<ul className="grid gap-1.5 border-l-2 border-border pl-3 font-serif text-[0.95rem] leading-relaxed">
					{item.highlights.map((h) => (
						<li key={h.id} {...highlightColor(h.color)} className="line-clamp-2">
							<span className="marker">{h.quote}</span>
						</li>
					))}
				</ul>
			) : null}
			{writing ? (
				<div className="grid max-w-md gap-1">
					<div className="flex items-center justify-between gap-2 text-xs">
						<ArticleNoteLabel />
						<NoteStatus status={note.status} onRetry={note.flush} />
					</div>
					<PostIt
						fit={fit}
						tilt={tiltFor(item.id)}
						className="mt-1 mb-2 text-lg leading-snug focus-within:ring-2 focus-within:ring-ring"
					>
						<NoteField
							aria-label={t("reader:highlights.sidebar.note")}
							value={note.value}
							maxLength={NOTE_MAX}
							onChange={note.change}
							onBlur={note.flush}
							documentId={item.id}
							linkTargets={{}}
							placeholder={placeholder}
							autoFocus
							className="block max-h-[50vh] min-h-16 w-full overflow-y-auto"
						/>
					</PostIt>
				</div>
			) : null}
			<div className="-ml-1.5 flex flex-wrap items-center gap-1">
				{writing ? null : (
					<button
						type="button"
						onClick={onWrite}
						className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-fg hover:bg-muted"
					>
						<NotebookPen className="size-4" aria-hidden />
						{t("home.notes.write")}
					</button>
				)}
				{note.value.trim() ? null : (
					<skip.Form
						method="post"
						action={ACTION}
						onSubmit={() =>
							showToast({
								message: t("home.notes.skipped"),
								undo: {
									action: ACTION,
									intent: "unskip",
									fields: { id: item.id },
									label: t("toast.undo"),
								},
							})
						}
					>
						<input type="hidden" name="intent" value="skip" />
						<input type="hidden" name="id" value={item.id} />
						<button
							type="submit"
							className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-fg hover:bg-muted hover:text-fg"
						>
							<X className="size-4" aria-hidden />
							{t("home.notes.skip")}
						</button>
					</skip.Form>
				)}
			</div>
		</li>
	)
}
