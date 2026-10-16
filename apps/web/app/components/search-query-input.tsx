import { parseSearchQuery, QUERY_MAX } from "@klipstack/api-contract/search-query"
import {
	type RemoteValues,
	type SuggestionItem,
	suggest,
	valueItems,
} from "@klipstack/api-contract/search-suggest"
import type { i18n as I18n } from "i18next"
import { type Ref, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useRouteLoaderData } from "react-router"
import { Input } from "~/components/ui/input"
import { isNsKey, type NsKey, useKeyTranslation } from "~/lib/i18n-keys"
import { cn } from "~/lib/utils"
import type { loader as layoutLoader } from "~/routes/app-layout"

type InputProps = Omit<
	React.ComponentProps<"input">,
	"value" | "defaultValue" | "onChange" | "type" | "maxLength" | "ref"
>

interface Props extends InputProps {
	ref?: Ref<HTMLInputElement>
	/** The query the field starts with. Remount (a `key`) to show another. */
	initialValue: string
	/** Room on the right for the clear button. */
	hasClear: boolean
}

/** The local day, for the date values on offer. */
function localToday(): string {
	const now = new Date()
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The query cut where its tokens are, gaps included, so that the painted text is the typed text.
 * The token the caret is at the end of is still being typed: "is:un" is not a mistake yet.
 */
function segments(text: string, caret: number | null) {
	const parts: Array<{ text: string; kind: "text" | "operator" | "ignored" }> = []
	// Words and the gaps around them are one run of text: fewer boxes, fewer rounded widths.
	const plain = (piece: string) => {
		const last = parts.at(-1)
		if (last?.kind === "text") last.text += piece
		else if (piece) parts.push({ text: piece, kind: "text" })
	}
	let at = 0
	for (const token of parseSearchQuery(text).tokens) {
		plain(text.slice(at, token.start))
		const typing = token.kind === "ignored" && token.end === caret
		if (token.kind === "text" || typing) plain(token.raw)
		else parts.push({ text: token.raw, kind: token.kind })
		at = token.end
	}
	plain(text.slice(at))
	return parts
}

/**
 * The search page's field: a real search input that colours the operators it understands,
 * underlines the ones it does not, and offers to complete keys and values.
 *
 * The input's own text is transparent; a layer behind it paints the same text. The two must sit
 * exactly on each other, or the caret drifts from the letters: same font, size and box, and the
 * painted spans only change colour, background and underline.
 */
export function SearchQueryInput({
	ref,
	initialValue,
	hasClear,
	className,
	onKeyDown,
	...props
}: Props) {
	const { t, i18n } = useTranslation("library")
	const tk = useKeyTranslation()
	const listId = useId()
	const inputRef = useRef<HTMLInputElement | null>(null)
	const paintRef = useRef<HTMLSpanElement>(null)
	const [text, setText] = useState(initialValue.slice(0, QUERY_MAX))
	// Where the caret is; null while text is selected, or the field is not focused.
	const [caret, setCaret] = useState<number | null>(null)
	const [dismissed, setDismissed] = useState(false)
	const [active, setActive] = useState(-1)
	const [remote, setRemote] = useState<{ key: RemoteValues["key"]; values: string[] } | null>(null)
	// After a completion the caret goes behind what was inserted, once React has written the value.
	const caretAfter = useRef<number | null>(null)

	// `topic:` is offered to readers who have topics, as the sidebar's link is.
	const topics = !!useRouteLoaderData<typeof layoutLoader>("routes/app-layout")?.topics
	const offered = useMemo(
		() => (caret === null ? null : suggest(text, caret, localToday(), { topics })),
		[text, caret, topics],
	)
	const wanted = offered?.remote
	const items: SuggestionItem[] = wanted
		? // The last rows stay while the next ones load.
			remote?.key === wanted.key
			? valueItems(wanted, remote.values)
			: []
		: (offered?.items ?? [])
	const open = !dismissed && items.length > 0

	const wantedKey = wanted?.key
	const wantedPrefix = wanted?.prefix
	useEffect(() => {
		if (!wantedKey || wantedPrefix === undefined) return
		const controller = new AbortController()
		const timer = window.setTimeout(() => {
			fetch(`/api/search/values?key=${wantedKey}&q=${encodeURIComponent(wantedPrefix)}`, {
				signal: controller.signal,
			})
				.then((res) => (res.ok ? (res.json() as Promise<{ values: string[] }>) : { values: [] }))
				.then(({ values }) => setRemote({ key: wantedKey, values }))
				.catch(() => {})
		}, 150)
		return () => {
			window.clearTimeout(timer)
			controller.abort()
		}
	}, [wantedKey, wantedPrefix])

	/** The painted text follows the input's own scrolling (a query longer than the field). */
	const follow = () => {
		const input = inputRef.current
		if (input && paintRef.current)
			paintRef.current.style.transform = `translateX(${-input.scrollLeft}px)`
	}
	// Safari does not always say when an input scrolls: look again after whatever may have moved it.
	const track = () => {
		const input = inputRef.current
		if (!input) return
		setCaret(
			document.activeElement === input && input.selectionStart === input.selectionEnd
				? input.selectionStart
				: null,
		)
		follow()
		requestAnimationFrame(follow)
	}
	useLayoutEffect(() => {
		const input = inputRef.current
		if (input && caretAfter.current !== null) {
			input.setSelectionRange(caretAfter.current, caretAfter.current)
			setCaret(caretAfter.current)
			caretAfter.current = null
		}
		follow()
	}, [text])

	const accept = (item: SuggestionItem) => {
		if (!offered) return
		// A value brings its space: not a second one when the next word already has it.
		const rest = text.slice(offered.end)
		const insert =
			item.insert.endsWith(" ") && rest.startsWith(" ") ? item.insert.trimEnd() : item.insert
		const next = (text.slice(0, offered.start) + insert + rest).slice(0, QUERY_MAX)
		caretAfter.current = Math.min(offered.start + item.insert.length, next.length)
		setText(next)
		setActive(-1)
		setDismissed(false)
	}

	return (
		<div className="relative w-full rounded-lg bg-card">
			<div
				aria-hidden
				data-testid="search-field-paint"
				className={cn(
					// The input's content box: its text is clipped there, and so is the painted one.
					"pointer-events-none absolute inset-y-0 left-[calc(2rem+1px)] flex items-center overflow-hidden text-sm whitespace-pre text-fg max-md:text-base",
					hasClear ? "right-[calc(2rem+1px)]" : "right-[calc(0.75rem+1px)]",
				)}
			>
				<span ref={paintRef} className="inline-block">
					{segments(text, caret).map((part, i) => (
						<span
							// oxlint-disable-next-line react/no-array-index-key -- the pieces of one string, in order
							key={i}
							data-kind={part.kind === "text" ? undefined : part.kind}
							className={
								part.kind === "operator"
									? "rounded-sm bg-accent/10 text-accent"
									: part.kind === "ignored"
										? "underline decoration-danger decoration-wavy underline-offset-2"
										: undefined
							}
						>
							{part.text}
						</span>
					))}
				</span>
			</div>
			<Input
				{...props}
				ref={(el) => {
					inputRef.current = el
					if (typeof ref === "function") ref(el)
					else if (ref) ref.current = el
				}}
				type="search"
				value={text}
				maxLength={QUERY_MAX}
				autoComplete="off"
				autoCapitalize="none"
				autoCorrect="off"
				spellCheck={false}
				aria-autocomplete="list"
				aria-controls={open ? listId : undefined}
				aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
				onChange={(e) => {
					setText(e.currentTarget.value)
					setActive(-1)
					setDismissed(false)
					track()
				}}
				onSelect={track}
				onKeyUp={track}
				onClick={track}
				onFocus={track}
				onScroll={follow}
				onBlur={() => setCaret(null)}
				onKeyDown={(e) => {
					if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
						e.preventDefault()
						const step = e.key === "ArrowDown" ? 1 : -1
						setActive((i) =>
							i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length,
						)
						return
					}
					// Enter searches, unless the arrows went into the list. Tab completes either way.
					const chosen = items[active] ?? (e.key === "Tab" ? items[0] : undefined)
					if (open && chosen && !e.shiftKey && (e.key === "Enter" || e.key === "Tab")) {
						e.preventDefault()
						accept(chosen)
						return
					}
					// Escape closes the list first, and leaves the text alone.
					if (open && e.key === "Escape") {
						e.preventDefault()
						setDismissed(true)
						return
					}
					onKeyDown?.(e)
				}}
				className={cn(
					"relative bg-transparent text-transparent caret-fg selection:bg-accent/25 selection:text-transparent",
					className,
				)}
			/>
			{open ? (
				<div
					id={listId}
					role="listbox"
					aria-label={t("search.suggest.label")}
					data-testid="search-suggestions"
					className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
				>
					{items.map((item, i) => {
						const hint = hintKey(i18n, item.hint)
						return (
							<div key={item.insert}>
								<button
									type="button"
									tabIndex={-1}
									id={`${listId}-${i}`}
									role="option"
									aria-selected={i === active}
									data-testid="search-suggestion"
									// The field keeps the caret: picking is a mousedown, never a focus change. Hovering
									// is not choosing: Enter still searches with the mouse resting here.
									onMouseDown={(e) => {
										e.preventDefault()
										accept(item)
									}}
									className="flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-sm hover:bg-hover aria-selected:bg-fg/10"
								>
									<span className="shrink-0 text-accent">{item.insert.trimEnd()}</span>
									{hint ? <span className="min-w-0 truncate text-muted-fg">{tk(hint)}</span> : null}
								</button>
							</div>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

/** The library-namespace key of a suggestion's hint, when the hint names one. */
function hintKey(i18n: I18n, hint: string | undefined): NsKey | null {
	const key = hint ? `library:${hint}` : null
	return key && isNsKey(i18n, key) ? key : null
}
