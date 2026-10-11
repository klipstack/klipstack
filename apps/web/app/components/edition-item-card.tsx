import { NOTE_MAX } from "@klipstack/api-contract/names"
import type { EditionItem, EditionItemHighlight } from "@klipstack/db"
import type { TFunction } from "i18next"
import { ArrowDown, ArrowUp, BookOpen, RefreshCw, TextSearch, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { type FetcherWithComponents, useFetcher, useFetchers } from "react-router"
import { useAutosaveText } from "~/hooks/use-autosave-text"
import type { EditionDone } from "~/lib/edition-action.server"
import { LONG_UNDO_MS, showToast } from "~/lib/toast"
import type { WebResult } from "~/lib/web-result"

type IntentResult = WebResult<{ deleted?: true }>
type Refusal = { code: string; details?: Record<string, unknown> }
import { includedQuotes, type QuoteProblem, quoteProblem, quoteUsage } from "~/lib/editions"
import { cn } from "~/lib/utils"
import { EditionText } from "./edition-page"
import { EditionTextField } from "./edition-text-field"
import { tooltip } from "./tooltip-host"
import { Button } from "./ui/button"

/**
 * Saves a change to the edition: JSON to the autosave route, which outlives the page. Answers what
 * the route answered.
 */
export type EditionSave = (
	body: Record<string, unknown>,
	keepalive: boolean,
) => Promise<WebResult<EditionDone>>

type HighlightChange = { highlightId: string; included?: boolean; note?: string | null }
type ItemPatch = {
	intent?: string
	itemId?: string
	included?: boolean
	includeNote?: boolean
	highlights?: HighlightChange[]
}

/** The editor has no item anchors: a note link opens its article. */
const NO_ANCHORS: Record<string, string> = {}

const post = (editionId: string) =>
	({ method: "post", action: `/editions/${editionId}`, encType: "application/json" }) as const

/**
 * A checkbox a fetcher saves. It shows the choice at once and keeps it until the answer is in, and
 * the page's data with it; then the data decides, so a refusal unticks it. Controlled by the data
 * alone, it would snap back while the submission is still being scheduled.
 */
function useChoice(saved: boolean, fetcher: FetcherWithComponents<IntentResult>) {
	const [choice, setChoice] = useState<{ value: boolean; before: unknown } | null>(null)
	const answered = choice !== null && fetcher.state === "idle" && fetcher.data !== choice.before
	const choose = (value: boolean) => setChoice({ value, before: fetcher.data })
	return [choice && !answered ? choice.value : saved, choose] as const
}

/**
 * One article of the edition: what the public page will show, and what the user chooses to add
 * to it. Choices save at once; typed text saves itself. Unticked, the article is set aside: it
 * keeps its place, folded to one dimmed line, and the page leaves it out.
 */
export function EditionItemCard({
	editionId,
	item,
	first,
	last,
	save,
	reading,
	onRead,
}: {
	editionId: string
	item: EditionItem
	first: boolean
	last: boolean
	save: EditionSave
	/** Its article is open beside the editor. */
	reading: boolean
	/** Opens its article beside the editor, at a highlight if one is given. */
	onRead: (highlightId: string | null) => void
}) {
	const { t } = useTranslation("editions")
	// Moves, refresh and remove. Each choice (the note, a highlight) has a fetcher of its own: a new
	// submission cancels the one in flight, and ticking two highlights quickly must keep both.
	const fetcher = useFetcher<IntentResult>()
	const noteChoice = useFetcher<IntentResult>()
	const inclusion = useFetcher<IntentResult>()
	const [included, chooseIncluded] = useChoice(item.included, inclusion)
	// A refresh replaces the note copies: the text fields start again from the new ones. Each answer
	// counts once, and only the answer to a refresh.
	const [copy, setCopy] = useState(0)
	const [sent, setSent] = useState<string | null>(null)
	const [seen, setSeen] = useState(fetcher.data)
	if (fetcher.data !== seen) {
		setSeen(fetcher.data)
		if (fetcher.data?.ok && sent === "refresh-item") setCopy((n) => n + 1)
	}

	const submit = (body: { intent: string } & Record<string, unknown>) => {
		setSent(body.intent)
		void fetcher.submit({ itemId: item.id, ...body }, post(editionId))
	}

	// What is being saved shows at once, whichever choice sent it: the cap counts it too.
	const pending = useFetchers()
		.map((f) => f.json as ItemPatch | undefined)
		.filter((json): json is ItemPatch => json?.intent === "update-item" && json.itemId === item.id)
	const [includeNote, chooseIncludeNote] = useChoice(
		pending.findLast((patch) => patch.includeNote !== undefined)?.includeNote ?? item.includeNote,
		noteChoice,
	)
	const highlights = item.highlights.map((h) => {
		const change = pending
			.flatMap((patch) => patch.highlights ?? [])
			.findLast((c) => c.highlightId === h.highlightId && c.included !== undefined)
		return change?.included === undefined ? h : { ...h, included: change.included }
	})
	const failed = (f: typeof fetcher) => (f.state === "idle" && f.data?.ok === false ? f.data : null)
	const error = failed(fetcher) ?? failed(noteChoice) ?? failed(inclusion)
	const [removing, setRemoving] = useState(false)
	const busy = fetcher.state !== "idle" || removing

	// Removed, its article leaves the shortlist too; the toast's undo puts both back as they were.
	const remove = async () => {
		setRemoving(true)
		try {
			const done = await save({ intent: "remove-item", itemId: item.id }, false)
			if (!done.ok || !done.undo) throw new Error("not removed")
			showToast({
				message: t(done.unmarked ? "item.removedUnmarked" : "item.removed"),
				undo: {
					action: `/editions/${editionId}`,
					intent: "restore-item",
					fields: { token: done.undo },
					label: t("item.undo"),
				},
				// Its note and choices go with it.
				ms: LONG_UNDO_MS,
			})
		} catch {
			setRemoving(false)
			showToast({ message: t("errors.generic"), warn: true })
		}
	}

	return (
		<li
			data-testid="edition-item"
			// Set aside, it has nothing in the preview for the preview to follow.
			data-edition-card={included ? "" : undefined}
			data-set-aside={included ? undefined : ""}
			className={cn(
				"rounded-xl border border-border p-4",
				included ? "bg-card" : "border-dashed py-2",
				reading && "ring-2 ring-accent/50",
			)}
		>
			{/* On a phone the buttons wrap under the text, rather than squeeze it. */}
			<div className="flex flex-wrap gap-3">
				<input
					type="checkbox"
					checked={included}
					aria-label={t("item.include")}
					{...tooltip(t("item.include"))}
					onChange={(e) => {
						chooseIncluded(e.target.checked)
						void inclusion.submit(
							{ intent: "update-item", itemId: item.id, included: e.target.checked },
							post(editionId),
						)
					}}
					className={cn("size-4 shrink-0 accent-accent", included ? "mt-1" : "mt-2.5")}
				/>
				{included && item.leadImageUrl ? (
					<img
						src={item.leadImageUrl}
						alt=""
						loading="lazy"
						referrerPolicy="no-referrer"
						className="relative size-16 shrink-0 rounded-md bg-muted object-cover before:absolute before:inset-0 before:bg-muted"
					/>
				) : null}
				{included ? (
					<div className="min-w-0 flex-1 basis-48">
						<p className="font-medium leading-snug">{item.title}</p>
						<p className="mt-0.5 truncate text-sm text-muted-fg">
							{[item.siteName, item.author].filter(Boolean).join(" · ") || item.url}
						</p>
						{item.description ? (
							<p className="mt-1 line-clamp-2 text-sm text-muted-fg">{item.description}</p>
						) : null}
					</div>
				) : (
					<div
						className="min-w-0 flex-1 basis-48 self-center opacity-60"
						{...tooltip(t("item.setAsideDetail"))}
					>
						<p className="truncate text-sm font-medium">{item.title}</p>
						<p className="truncate text-xs text-muted-fg">
							{[t("item.setAside"), item.siteName ?? item.url].join(" · ")}
						</p>
					</div>
				)}
				<div className="ml-auto flex shrink-0 items-start gap-1">
					<Button
						variant="ghost"
						size="icon"
						disabled={!item.documentId}
						aria-label={t("item.read")}
						aria-pressed={reading}
						{...tooltip(item.documentId ? t("item.read") : t("item.refreshGone"))}
						onClick={() => onRead(null)}
						className={cn(reading && "bg-muted text-fg")}
					>
						<BookOpen className="size-4" aria-hidden />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={first || busy}
						aria-label={t("item.up")}
						{...tooltip(t("item.up"))}
						onClick={() => submit({ intent: "move-item", direction: "up" })}
					>
						<ArrowUp className="size-4" aria-hidden />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={last || busy}
						aria-label={t("item.down")}
						{...tooltip(t("item.down"))}
						onClick={() => submit({ intent: "move-item", direction: "down" })}
					>
						<ArrowDown className="size-4" aria-hidden />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={!item.documentId || busy}
						aria-label={t("item.refresh")}
						{...tooltip(item.documentId ? t("item.refresh") : t("item.refreshGone"))}
						onClick={() => {
							if (confirm(t("item.refreshConfirm"))) submit({ intent: "refresh-item" })
						}}
					>
						<RefreshCw className="size-4" aria-hidden />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={busy}
						aria-label={t("item.remove")}
						{...tooltip(t("item.remove"))}
						onClick={() => void remove()}
					>
						<Trash2 className="size-4" aria-hidden />
					</Button>
				</div>
			</div>

			{included ? (
				<ItemChoices
					editionId={editionId}
					item={item}
					copy={copy}
					includeNote={includeNote}
					chooseIncludeNote={chooseIncludeNote}
					noteChoice={noteChoice}
					highlights={highlights}
					save={save}
					onShow={item.documentId ? onRead : null}
				/>
			) : null}

			{error ? (
				<p role="alert" className="mt-3 text-sm text-danger">
					{refusalText(t, error.error)}
				</p>
			) : null}
		</li>
	)
}

/** What an included article shows on the page: its note, and the highlights quoted. */
function ItemChoices({
	editionId,
	item,
	copy,
	includeNote,
	chooseIncludeNote,
	noteChoice,
	highlights,
	save,
	onShow,
}: {
	editionId: string
	item: EditionItem
	/** Bumped by a refresh, which replaces the note copies. */
	copy: number
	includeNote: boolean
	chooseIncludeNote: (value: boolean) => void
	noteChoice: FetcherWithComponents<IntentResult>
	highlights: EditionItemHighlight[]
	save: EditionSave
	/** Shows a highlight in the article beside the editor; null when there is no article. */
	onShow: ((highlightId: string) => void) | null
}) {
	const { t } = useTranslation("editions")
	const usage = quoteUsage(includedQuotes(highlights), item.wordCount)
	const over = quoteProblem(includedQuotes(highlights), item.wordCount)
	return (
		<>
			{/* Without a note from the library, one can be written here. */}
			<div className="mt-4 border-t border-border pt-3">
				<label className="flex items-center gap-2 text-sm font-medium">
					<input
						type="checkbox"
						checked={includeNote}
						onChange={(e) => {
							chooseIncludeNote(e.target.checked)
							void noteChoice.submit(
								{ intent: "update-item", itemId: item.id, includeNote: e.target.checked },
								post(editionId),
							)
						}}
						className="size-4 accent-accent"
					/>
					{item.note !== null ? t("item.includeNote") : t("item.addNote")}
				</label>
				{includeNote ? (
					<ItemNote
						key={copy}
						initial={item.note}
						label={t("item.noteLabel")}
						save={async (text, keepalive) => {
							await save({ intent: "update-item", itemId: item.id, note: text }, keepalive)
						}}
					/>
				) : null}
			</div>

			<div className="mt-4 border-t border-border pt-3">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<h3 className="text-sm font-medium">{t("item.highlights")}</h3>
					{highlights.length > 0 ? (
						<p className={cn("text-xs tabular-nums", over ? "text-danger" : "text-muted-fg")}>
							{t("item.wordsQuoted", { words: usage.words, limit: usage.wordLimit })}
						</p>
					) : null}
				</div>
				{highlights.length === 0 ? (
					<p className="mt-1 text-sm text-muted-fg">{t("item.noHighlights")}</p>
				) : (
					<ul className="mt-2 space-y-3">
						{highlights.map((highlight) => (
							<HighlightChoice
								key={`${highlight.highlightId}:${copy}`}
								editionId={editionId}
								itemId={item.id}
								highlight={highlight}
								onShow={onShow}
								blocked={
									highlight.included
										? null
										: quoteProblem([...includedQuotes(highlights), highlight.exact], item.wordCount)
								}
								save={async (text, keepalive) => {
									await save(
										{
											intent: "update-item",
											itemId: item.id,
											highlights: [{ highlightId: highlight.highlightId, note: text }],
										},
										keepalive,
									)
								}}
							/>
						))}
					</ul>
				)}
				{over ? (
					<p role="alert" className="mt-2 text-sm text-danger">
						{t(`item.${over}`)}
					</p>
				) : null}
			</div>
		</>
	)
}

/** A highlight to quote or not. Off by default; one that would break the cap cannot be ticked. */
function HighlightChoice({
	editionId,
	itemId,
	highlight,
	onShow,
	blocked,
	save,
}: {
	editionId: string
	itemId: string
	highlight: EditionItemHighlight
	onShow: ((highlightId: string) => void) | null
	blocked: ReturnType<typeof quoteProblem>
	save: (text: string, keepalive: boolean) => Promise<void>
}) {
	const { t } = useTranslation("editions")
	const fetcher = useFetcher<IntentResult>()
	const [included, choose] = useChoice(highlight.included, fetcher)
	// Refused by the server: the cap as it stood there, after another tab's choices.
	const refused = fetcher.state === "idle" && fetcher.data?.ok === false ? fetcher.data : null
	return (
		<li>
			<div className="flex items-start gap-1">
				<label
					className={cn(
						"flex flex-1 items-start gap-2",
						blocked && "cursor-not-allowed opacity-60",
					)}
					{...(blocked ? tooltip(t(`item.${blocked}`)) : {})}
				>
					<input
						type="checkbox"
						checked={included}
						disabled={Boolean(blocked)}
						onChange={(e) => {
							choose(e.target.checked)
							void fetcher.submit(
								{
									intent: "update-item",
									itemId,
									highlights: [{ highlightId: highlight.highlightId, included: e.target.checked }],
								},
								post(editionId),
							)
						}}
						className="mt-1 size-4 shrink-0 accent-accent"
					/>
					<blockquote className="border-l-2 border-accent/60 pl-3 font-serif text-sm leading-relaxed">
						{highlight.exact}
					</blockquote>
				</label>
				{onShow ? (
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("item.showInArticle")}
						{...tooltip(t("item.showInArticle"))}
						onClick={() => onShow(highlight.highlightId)}
						className="-mt-1.5 shrink-0 text-muted-fg"
					>
						<TextSearch className="size-4" aria-hidden />
					</Button>
				) : null}
			</div>
			{refused ? (
				<p role="alert" className="mt-1 ml-6 text-xs text-danger">
					{refusalText(t, refused.error)}
				</p>
			) : null}
			{included ? (
				<ItemNote
					initial={highlight.note}
					label={t("item.highlightNoteLabel")}
					save={save}
					className="ml-6"
				/>
			) : highlight.note ? (
				<EditionText
					text={highlight.note}
					anchors={NO_ANCHORS}
					newTab
					className="mt-1 ml-9 text-sm text-muted-fg"
				/>
			) : null}
		</li>
	)
}

/** A note copy, editable. It saves itself; the library's note stays as it is. */
function ItemNote({
	initial,
	label,
	save,
	className,
}: {
	initial: string | null
	label: string
	save: (text: string, keepalive: boolean) => Promise<void>
	className?: string
}) {
	const { t } = useTranslation("editions")
	const note = useAutosaveText(initial ?? "", (text, { keepalive }) => save(text, keepalive))
	return (
		<div className={cn("mt-2", className)}>
			<EditionTextField
				aria-label={label}
				value={note.value}
				placeholder={label}
				maxLength={NOTE_MAX}
				onChange={note.change}
				onBlur={note.flush}
				className="min-h-[3.75rem] w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			{note.status === "error" ? (
				<p role="alert" className="mt-1 text-xs text-danger">
					{t("editor.saveError")}
				</p>
			) : null}
		</div>
	)
}

const KNOWN_ERRORS = [
	"already_added",
	"no_url",
	"document_gone",
	"not_found",
	"invalid_title",
	"invalid_intro",
	"invalid_note",
	"limit_reached",
	"edition_removed",
] as const

/**
 * The message for an editor's refusal; the generic one for those the user cannot act on. A field
 * past its limit says which (`details.field`).
 */
export function errorText(t: TFunction<"editions">, error: Refusal): string {
	const code =
		error.code === "invalid_request" ? `invalid_${String(error.details?.field ?? "")}` : error.code
	const known = KNOWN_ERRORS.find((known) => known === code)
	return known ? t(`errors.${known}`) : t("errors.generic")
}

/** `errorText`, or what an item's quotes would break (`quote_cap`). */
function refusalText(t: TFunction<"editions">, error: Refusal): string {
	const problem = error.code === "quote_cap" ? (error.details?.quoteProblem as QuoteProblem) : null
	return problem ? t(`item.${problem}`) : errorText(t, error)
}
