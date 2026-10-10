import { cleanTagName, TAG_NAME_MAX, TAGS_PER_ARTICLE_MAX } from "@klipstack/api-contract/names"
import { Plus, Tag, X } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"
import { useMutationQueue } from "~/hooks/use-mutation-queue"
import { useTagList } from "~/hooks/use-tag-list"
import { tagSearchPath } from "~/lib/search-page"
import { cn } from "~/lib/utils"
import type { WebResult } from "~/lib/web-result"

type Saved = WebResult<{ tags: string[] }>

/** What the dialog says for each refusal (`tags.errors.*`). */
const ERRORS = {
	invalid_request: "invalid_name",
	too_many_article_tags: "too_many_on_article",
	too_many_tags: "too_many_tags",
	not_found: "not_found",
} as const
type ErrorCode = (typeof ERRORS)[keyof typeof ERRORS]

/** Rows the list shows at most. */
export const OPTIONS_MAX = 8

/** Case and accents do not matter when looking for a tag by what is typed. */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

export const byName = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())

/**
 * An article's tags as small chips. `max` shows that many and counts the rest. With `links`, each
 * is a link to the tag's search; without, they are plain text, and a click on a card goes where
 * the card goes.
 */
export function TagChips({
	tags,
	max,
	links = false,
	className,
	testId,
}: {
	tags: string[]
	max?: number
	links?: boolean
	className?: string
	testId?: string
}) {
	const { t } = useTranslation("library")
	const location = useLocation()
	if (tags.length === 0) return null
	const shown = max === undefined ? tags : tags.slice(0, max)
	const from = location.pathname + location.search
	const chip =
		"block max-w-40 truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-fg"
	return (
		<ul
			data-testid={testId}
			aria-label={t("tags.list")}
			className={cn("flex flex-wrap items-center gap-1", className)}
		>
			{shown.map((name) => (
				<li key={name} className="min-w-0">
					{links ? (
						<Link
							to={tagSearchPath(name)}
							state={{ from }}
							aria-label={t("tags.open", { name })}
							className={cn(chip, "relative z-10 hover:bg-fg/10 hover:text-fg")}
						>
							{name}
						</Link>
					) : (
						<span className={chip}>{name}</span>
					)}
				</li>
			))}
			{shown.length < tags.length ? (
				<li className="text-xs text-muted-fg">
					{t("tags.more", { count: tags.length - shown.length })}
				</li>
			) : null}
		</ul>
	)
}

/**
 * The tag picker: a modal with the article's tags and a field that finds the user's tags or makes
 * a new one. Every add and remove is saved at once. Mount it to open it; `onClose` unmounts it.
 */
export function TagDialog({
	documentId,
	title,
	tags,
	onClose,
}: {
	documentId: string
	title: string
	tags: string[]
	onClose: () => void
}) {
	const { t } = useTranslation("library")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const listId = useId()
	const [confirmed, setConfirmed] = useState(tags)
	const [typed, setTyped] = useState("")
	const [cursor, setCursor] = useState<number | null>(null)
	const [error, setError] = useState<ErrorCode | null>(null)
	const [answer, setAnswer] = useState<Saved | undefined>(undefined)
	// One change at a time, in order: two quick adds both land. The server's answer is the truth:
	// its list replaces the guess.
	const save = useMutationQueue<{ intent: "add" | "remove"; name: string }, Saved>({
		action: `/documents/${documentId}/tags`,
		body: (change) => change,
		onSettled: (_change, saved) => {
			if (!saved) return
			setAnswer(saved)
			if (saved.ok) setConfirmed(saved.tags)
			else setError(ERRORS[saved.error.code as keyof typeof ERRORS] ?? "invalid_name")
		},
	})

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
		inputRef.current?.focus()
	}, [])

	// Closed while a change is on its way: stay mounted until it lands. A fetcher that unmounts
	// takes its revalidation with it, and the page would go on showing the old tags.
	const [closed, setClosed] = useState(false)
	const settled = save.pending.length === 0
	useEffect(() => {
		if (closed && settled) onClose()
	}, [closed, settled, onClose])

	// Asked again after each answer: a tag made here is one to offer from then on.
	const known = useTagList(answer)
	const storedName = (name: string) =>
		known.find((k) => k.name.toLowerCase() === name.toLowerCase())?.name ?? name

	// While changes are on their way, the chips show them already.
	const current = useMemo(
		() =>
			save.pending.reduce((list, { intent, name }) => {
				const without = list.filter((n) => n.toLowerCase() !== name.toLowerCase())
				return intent === "add" ? [...without, name].sort(byName) : without
			}, confirmed),
		[confirmed, save.pending],
	)

	const full = current.length >= TAGS_PER_ARTICLE_MAX
	const clean = cleanTagName(typed)
	const has = (name: string) => current.some((n) => n.toLowerCase() === name.toLowerCase())
	const needle = fold(typed.trim())
	const matches = known
		.filter((k) => !has(k.name) && fold(k.name).includes(needle))
		.sort(
			(a, b) =>
				Number(fold(b.name).startsWith(needle)) - Number(fold(a.name).startsWith(needle)) ||
				b.articles - a.articles ||
				byName(a.name, b.name),
		)
		.slice(0, OPTIONS_MAX)
	const creates =
		clean !== null &&
		!has(clean) &&
		!known.some((k) => k.name.toLowerCase() === clean.toLowerCase())
	const options: Array<{ name: string; create: boolean }> = [
		...matches.map((m) => ({ name: m.name, create: false })),
		...(creates ? [{ name: clean, create: true }] : []),
	]
	const active = cursor !== null && cursor < options.length ? cursor : null

	const submit = (intent: "add" | "remove", name: string) => {
		setError(null)
		save.submit({ intent, name })
	}
	/** Adds the tag with that name; `rest` is what stays in the field. */
	const add = (raw: string, rest = "") => {
		const name = cleanTagName(raw)
		if (!name) {
			if (raw.trim()) setError("invalid_name")
			return
		}
		setTyped(rest)
		setCursor(null)
		if (has(name) || full) return
		submit("add", storedName(name))
	}

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.nativeEvent.isComposing) return
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (options.length === 0) return
			e.preventDefault()
			const step = e.key === "ArrowDown" ? 1 : -1
			setCursor(
				active === null
					? step === 1
						? 0
						: options.length - 1
					: (active + step + options.length) % options.length,
			)
		} else if (e.key === "Enter") {
			e.preventDefault()
			add(active === null ? typed : options[active]!.name)
		} else if (e.key === "Backspace" && typed === "" && current.length > 0) {
			e.preventDefault()
			submit("remove", current[current.length - 1]!)
		}
	}

	return (
		<dialog
			ref={dialogRef}
			aria-label={t("tags.title")}
			data-testid="tag-dialog"
			className="m-auto w-[min(28rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClose={() => setClosed(true)}
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				// The page behind listens for keys on the document (⌘K, Escape in the reader): not from here.
				e.stopPropagation()
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			<div className="flex flex-col gap-4 p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold">{t("tags.title")}</h2>
						<p className="mt-1 truncate text-sm text-muted-fg">{title}</p>
					</div>
					<button
						type="button"
						onClick={() => dialogRef.current?.close()}
						className="rounded-md p-1.5 text-muted-fg hover:bg-muted"
						aria-label={t("tags.close")}
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>
				{current.length > 0 ? (
					<ul
						aria-label={t("tags.list")}
						data-testid="tag-dialog-tags"
						className="flex flex-wrap gap-1.5"
					>
						{current.map((name) => (
							<li
								key={name.toLowerCase()}
								className="flex max-w-full items-center gap-0.5 rounded-full border border-border py-0.5 pr-1 pl-2.5 text-sm"
							>
								<span className="truncate">{name}</span>
								<button
									type="button"
									onClick={() => {
										submit("remove", name)
										inputRef.current?.focus()
									}}
									aria-label={t("tags.remove", { name })}
									className="rounded-full p-0.5 text-muted-fg hover:bg-fg/10 hover:text-fg"
								>
									<X className="size-3.5" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-fg">{t("tags.none")}</p>
				)}
				<div>
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-label={t("tags.inputLabel")}
						aria-expanded={options.length > 0}
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={active === null ? undefined : `${listId}-${active}`}
						aria-invalid={error ? true : undefined}
						autoComplete="off"
						autoCapitalize="off"
						enterKeyHint="done"
						maxLength={TAG_NAME_MAX}
						disabled={full}
						placeholder={t("tags.placeholder")}
						value={typed}
						onChange={(e) => {
							const value = e.target.value
							const comma = value.indexOf(",")
							setCursor(null)
							setError(null)
							// A comma ends a name. Read here, not in keydown: a paste has commas too, and a
							// phone keyboard names no key. One tag at a time: the rest of "a, b" stays typed.
							if (comma === -1) setTyped(value)
							else if (value.slice(0, comma).trim())
								add(value.slice(0, comma), value.slice(comma + 1).trimStart())
							else setTyped(value.replaceAll(",", ""))
						}}
						onKeyDown={onKeyDown}
						className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 md:text-sm"
					/>
					{error ? (
						<p role="alert" className="mt-1.5 text-sm text-danger">
							{t(`tags.errors.${error}`)}
						</p>
					) : full ? (
						<p className="mt-1.5 text-sm text-muted-fg">
							{t("tags.limit", { count: TAGS_PER_ARTICLE_MAX })}
						</p>
					) : null}
					<div
						id={listId}
						role="listbox"
						aria-label={t("tags.suggestions")}
						data-testid="tag-options"
						className={cn("mt-2 max-h-56 overflow-y-auto", options.length === 0 && "hidden")}
					>
						{options.map((option, i) => (
							<div key={`${option.create ? "new" : "tag"}-${option.name}`}>
								<button
									type="button"
									id={`${listId}-${i}`}
									role="option"
									aria-selected={i === active}
									data-testid="tag-option"
									tabIndex={-1}
									// The field keeps the focus: picking is a mousedown, never a focus change.
									onMouseDown={(e) => {
										e.preventDefault()
										add(option.name)
									}}
									onMouseEnter={() => setCursor(i)}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
										i === active && "bg-selected text-selected-fg",
									)}
								>
									{option.create ? (
										<Plus className="size-4 shrink-0 text-muted-fg" aria-hidden />
									) : (
										<Tag className="size-4 shrink-0 text-muted-fg" aria-hidden />
									)}
									<span className="min-w-0 flex-1 truncate">
										{option.create ? t("tags.create", { name: option.name }) : option.name}
									</span>
								</button>
							</div>
						))}
					</div>
				</div>
			</div>
		</dialog>
	)
}
