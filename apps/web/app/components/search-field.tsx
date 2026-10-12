import { Search, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { Form, Link, useLocation, useNavigate } from "react-router"
import { SearchQueryInput } from "~/components/search-query-input"
import { Input } from "~/components/ui/input"
import { isSearchShortcut } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"

interface Props {
	/** GET target; the query is submitted as `q`. */
	action: string
	/** Current query (from the loader); shows the inline clear button when set. */
	value: string
	/** Where the clear button navigates (the unfiltered view). */
	clearTo: string
	placeholder: string
	label: string
	clearLabel: string
	className?: string
	/** Overrides the field's width classes (the phone bar makes it fill the row). */
	inputClassName?: string
	autoFocus?: boolean
	/** Other query params the search keeps (a filter, a view). */
	keep?: Record<string, string>
	/** Where Escape on an empty field goes, instead of clearing the search. */
	escapeTo?: string
	/** "/" focuses the field. */
	slashFocus?: boolean
	/**
	 * The search page's query language: operators are coloured and completed. The field then fills
	 * its form, whatever `inputClassName` says.
	 */
	operators?: boolean
	/** The query, as the reader submits it. */
	onSearch?: (query: string) => void
}

/** Compact search box with the search icon and clear button inside the field. */
export function SearchField({
	action,
	value,
	clearTo,
	placeholder,
	label,
	clearLabel,
	className,
	inputClassName,
	autoFocus,
	keep,
	escapeTo,
	slashFocus,
	operators,
	onSearch,
}: Props) {
	const navigate = useNavigate()
	// The search page remembers where it was opened from, search after search.
	const { state } = useLocation()
	const inputRef = useRef<HTMLInputElement>(null)
	// The caret goes after the text: a query that awaits its words ("in:archive ") is typed onto.
	const focusAtEnd = () => {
		const el = inputRef.current
		// Two fields can be mounted (the phone bar's and the page's): the one on screen.
		if (!el || el.offsetParent === null) return
		el.focus()
		el.setSelectionRange(el.value.length, el.value.length)
	}
	useEffect(() => {
		if (autoFocus) focusAtEnd()
	}, [autoFocus])
	useEffect(() => {
		if (!slashFocus) return
		const onKey = (e: KeyboardEvent) => {
			if (!isSearchShortcut(e)) return
			e.preventDefault()
			focusAtEnd()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [slashFocus])
	const field = {
		ref: inputRef,
		name: "q",
		placeholder,
		"aria-label": label,
		autoFocus,
		onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
			// Escape on an empty field leaves the search, like the clear button. With text in it,
			// the browser clears the text first (type=search), so a second Escape leaves.
			if (e.key !== "Escape" || e.currentTarget.value !== "") return
			e.preventDefault()
			if (escapeTo) void navigate(escapeTo)
			else if (value) void navigate(clearTo)
			else e.currentTarget.blur()
		},
	}
	return (
		<Form
			method="get"
			action={action}
			state={state}
			// The results take the keys (j/k), and a phone puts its keyboard away.
			onSubmit={(event) => {
				onSearch?.(String(new FormData(event.currentTarget).get("q") ?? ""))
				inputRef.current?.blur()
			}}
			role="search"
			className={cn("relative", className)}
		>
			{Object.entries(keep ?? {}).map(([name, v]) => (
				<input key={name} type="hidden" name={name} value={v} />
			))}
			<Search
				className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-fg"
				aria-hidden
			/>
			{operators ? (
				<SearchQueryInput
					{...field}
					initialValue={value}
					hasClear={Boolean(value)}
					className={cn("h-10 pl-8", value && "pr-8")}
				/>
			) : (
				<Input
					{...field}
					type="search"
					defaultValue={value}
					autoComplete="off"
					className={cn(
						"h-10 w-44 pl-8 transition-[width] focus:w-64 sm:w-56 sm:focus:w-80",
						value && "pr-8",
						inputClassName,
					)}
				/>
			)}
			{value ? (
				<Link
					to={clearTo}
					state={state}
					aria-label={clearLabel}
					{...tooltip(clearLabel)}
					className="absolute top-1/2 right-1.5 z-10 -translate-y-1/2 rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
				>
					<X className="size-4" aria-hidden />
				</Link>
			) : null}
		</Form>
	)
}
