import { Component, lazy, type ReactNode, Suspense } from "react"
import { cn } from "~/lib/utils"
import type { NoteEditorProps } from "./note-editor"
import { NoteText } from "./note-text"

const NoteEditor = lazy(() => import("./note-editor"))

/** Load the editor's chunk ahead of the first `[[`, so opening a note never waits for the network. */
export function prefetchNoteEditor(): void {
	void import("./note-editor").catch(() => {})
}

/**
 * The note editor, with the ground it stands on. While its chunk loads the note reads as static
 * text; if the chunk cannot be fetched at all (offline, never cached) the old textarea takes over
 * and the note keeps its links as Markdown. Nothing is ever lost.
 */
export function NoteField(props: NoteEditorProps) {
	return (
		<TextareaOnError {...props}>
			<Suspense fallback={<StaticNote {...props} />}>
				<NoteEditor {...props} />
			</Suspense>
		</TextareaOnError>
	)
}

function StaticNote({ value, placeholder, linkTargets, className }: NoteEditorProps) {
	return (
		<div className={className}>
			{value ? (
				<NoteText text={value} linkTargets={linkTargets} />
			) : (
				<span className="text-[color:var(--note-placeholder,var(--k-muted-fg))]">
					{placeholder}
				</span>
			)}
		</div>
	)
}

/** The note as it always was: raw text, raw Markdown, still saved and still typed. */
function NoteTextarea({
	value,
	onChange,
	onBlur,
	onSubmit,
	onEscape,
	placeholder,
	autoFocus,
	maxLength,
	id,
	"aria-label": ariaLabel,
	className,
}: NoteEditorProps) {
	return (
		<textarea
			id={id}
			aria-label={ariaLabel}
			value={value}
			maxLength={maxLength}
			// oxlint-disable-next-line jsx-a11y/no-autofocus -- the note editor opens ready to type
			autoFocus={autoFocus}
			onChange={(e) => onChange(e.target.value)}
			onBlur={onBlur}
			onKeyDown={(e) => {
				if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
					e.preventDefault()
					onSubmit?.()
				} else if (e.key === "Escape") {
					e.preventDefault()
					e.stopPropagation()
					onEscape?.()
				}
			}}
			placeholder={placeholder}
			className={cn(
				"block w-full resize-none bg-transparent [field-sizing:content] placeholder:text-[color:var(--note-placeholder,var(--k-muted-fg))]",
				className,
			)}
		/>
	)
}

/** A chunk that will not load is not an error the user should see. */
class TextareaOnError extends Component<
	NoteEditorProps & { children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	render() {
		const { children, ...props } = this.props
		return this.state.failed ? <NoteTextarea {...props} /> : children
	}
}
