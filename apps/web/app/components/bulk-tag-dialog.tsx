import { cleanTagName, TAG_NAME_MAX } from "@klipstack/api-contract/names"
import { Plus, Tag, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useTagList } from "~/hooks/use-tag-list"
import { cn } from "~/lib/utils"
import type { LibraryCard } from "~/services/documents.server"
import { byName, fold, OPTIONS_MAX } from "./tag-dialog"

/**
 * Adds tags to many articles at once: the names are gathered first and sent together with **Add**.
 * It only adds; the one-article dialog also removes. Each of the user's tags says how many of the
 * articles have it already, and one they all have is not offered. Mount it to open it.
 */
export function BulkTagDialog({
	cards,
	onAdd,
	onClose,
}: {
	cards: LibraryCard[]
	onAdd: (names: string[]) => void
	onClose: () => void
}) {
	const { t } = useTranslation("library")
	const dialogRef = useRef<HTMLDialogElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)
	const listId = useId()
	const [names, setNames] = useState<string[]>([])
	const [typed, setTyped] = useState("")
	const [cursor, setCursor] = useState<number | null>(null)
	const [invalid, setInvalid] = useState(false)
	const known = useTagList(null)

	useEffect(() => {
		const dialog = dialogRef.current
		if (dialog && !dialog.open) dialog.showModal()
		inputRef.current?.focus()
	}, [])

	const total = cards.length
	const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
	const holders = (name: string) => cards.filter((c) => c.tags.some((x) => same(x, name))).length
	const picked = (name: string) => names.some((n) => same(n, name))
	const storedName = (name: string) => known.find((k) => same(k.name, name))?.name ?? name
	const clean = cleanTagName(typed)
	const needle = fold(typed.trim())
	const matches = known
		.filter((k) => !picked(k.name) && holders(k.name) < total && fold(k.name).includes(needle))
		.sort(
			(a, b) =>
				Number(fold(b.name).startsWith(needle)) - Number(fold(a.name).startsWith(needle)) ||
				b.articles - a.articles ||
				byName(a.name, b.name),
		)
		.slice(0, OPTIONS_MAX)
	const creates = clean !== null && !picked(clean) && !known.some((k) => same(k.name, clean))
	const options: Array<{ name: string; create: boolean }> = [
		...matches.map((m) => ({ name: m.name, create: false })),
		...(creates ? [{ name: clean, create: true }] : []),
	]
	const active = cursor !== null && cursor < options.length ? cursor : null

	/** Adds the name to those to send; `rest` is what stays in the field. */
	const pick = (raw: string, rest = "") => {
		const name = cleanTagName(raw)
		if (!name) {
			if (raw.trim()) setInvalid(true)
			return
		}
		setTyped(rest)
		setCursor(null)
		if (!picked(name)) setNames([...names, storedName(name)])
	}
	const apply = () => {
		if (names.length === 0) return
		onAdd(names)
		dialogRef.current?.close()
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
			// An empty field sends what was gathered.
			if (active !== null) pick(options[active]!.name)
			else if (typed.trim()) pick(typed)
			else apply()
		} else if (e.key === "Backspace" && typed === "" && names.length > 0) {
			e.preventDefault()
			setNames(names.slice(0, -1))
		}
	}

	return (
		<dialog
			ref={dialogRef}
			aria-label={t("bulkTags.title", { count: total })}
			data-testid="bulk-tag-dialog"
			className="m-auto w-[min(28rem,92vw)] rounded-2xl border border-border bg-card p-0 text-fg shadow-2xl backdrop:bg-black/40"
			onClose={onClose}
			onClick={(e) => {
				if (e.target === dialogRef.current) dialogRef.current?.close()
			}}
			onKeyDown={(e) => {
				// The page behind listens for keys on the document: not from here.
				e.stopPropagation()
				if (e.key === "Escape") dialogRef.current?.close()
			}}
		>
			<div className="flex flex-col gap-4 p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold text-balance">
							{t("bulkTags.title", { count: total })}
						</h2>
						<p className="mt-1 text-sm text-muted-fg">{t("bulkTags.hint")}</p>
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
				{names.length > 0 ? (
					<ul aria-label={t("bulkTags.picked")} className="flex flex-wrap gap-1.5">
						{names.map((name) => (
							<li
								key={name.toLowerCase()}
								className="flex max-w-full items-center gap-0.5 rounded-full border border-border bg-muted py-0.5 pr-1 pl-2.5 text-sm text-fg"
							>
								<span className="truncate">{name}</span>
								<button
									type="button"
									onClick={() => {
										setNames(names.filter((n) => n !== name))
										inputRef.current?.focus()
									}}
									aria-label={t("tags.remove", { name })}
									className="rounded-full p-0.5 hover:bg-fg/10"
								>
									<X className="size-3.5" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				) : null}
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
						aria-invalid={invalid || undefined}
						autoComplete="off"
						autoCapitalize="off"
						enterKeyHint="done"
						maxLength={TAG_NAME_MAX}
						placeholder={t("tags.placeholder")}
						value={typed}
						onChange={(e) => {
							const value = e.target.value
							const comma = value.indexOf(",")
							setCursor(null)
							setInvalid(false)
							// A comma ends a name, as in the one-article dialog.
							if (comma === -1) setTyped(value)
							else if (value.slice(0, comma).trim())
								pick(value.slice(0, comma), value.slice(comma + 1).trimStart())
							else setTyped(value.replaceAll(",", ""))
						}}
						onKeyDown={onKeyDown}
						className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
					/>
					{invalid ? (
						<p role="alert" className="mt-1.5 text-sm text-danger">
							{t("tags.errors.invalid_name")}
						</p>
					) : null}
					<div
						id={listId}
						role="listbox"
						aria-label={t("tags.suggestions")}
						className={cn("mt-2 max-h-56 overflow-y-auto", options.length === 0 && "hidden")}
					>
						{options.map((option, i) => {
							const has = option.create ? 0 : holders(option.name)
							return (
								<div key={`${option.create ? "new" : "tag"}-${option.name}`}>
									<button
										type="button"
										id={`${listId}-${i}`}
										role="option"
										aria-selected={i === active}
										tabIndex={-1}
										// The field keeps the focus: picking is a mousedown, never a focus change.
										onMouseDown={(e) => {
											e.preventDefault()
											pick(option.name)
										}}
										onMouseEnter={() => setCursor(i)}
										className={cn(
											"flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
											i === active && "bg-fg/10",
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
										{has > 0 ? (
											<span className="shrink-0 text-xs text-muted-fg">
												{t("bulkTags.some", { count: has, total })}
											</span>
										) : null}
									</button>
								</div>
							)
						})}
					</div>
				</div>
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={() => dialogRef.current?.close()}
						className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted"
					>
						{t("bulkTags.cancel")}
					</button>
					<button
						type="button"
						onClick={apply}
						disabled={names.length === 0}
						className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:opacity-50"
					>
						{t("bulkTags.add")}
					</button>
				</div>
			</div>
		</dialog>
	)
}
