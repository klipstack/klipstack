import { Component, lazy, type ReactNode, Suspense } from "react"
import { cn } from "~/lib/utils"
import { EditionText } from "./edition-page"
import type { EditionTextEditorProps } from "./edition-text-editor"

const EditionTextEditor = lazy(() => import("./edition-text-editor"))

/** The editor has no item anchors: a link opens its article. */
const NO_ANCHORS: Record<string, string> = {}

/**
 * An edition's intro or note, links shown as links. While the editor's chunk loads, the text reads
 * as the page will show it; if the chunk cannot be fetched at all (offline, never cached), a
 * textarea takes over, with the links as Markdown. Nothing is ever lost.
 */
export function EditionTextField(props: EditionTextEditorProps) {
	return (
		<TextareaOnError {...props}>
			<Suspense fallback={<StaticText {...props} />}>
				<EditionTextEditor {...props} />
			</Suspense>
		</TextareaOnError>
	)
}

function StaticText({ value, placeholder, className }: EditionTextEditorProps) {
	return (
		<div className={className}>
			{value ? (
				<EditionText text={value} anchors={NO_ANCHORS} newTab />
			) : (
				<span className="text-muted-fg">{placeholder}</span>
			)}
		</div>
	)
}

/** The text as it always was: raw, links as Markdown, still saved and still typed. */
function Textarea({
	value,
	onChange,
	onBlur,
	placeholder,
	maxLength,
	id,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	className,
}: EditionTextEditorProps) {
	return (
		<textarea
			id={id}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			value={value}
			maxLength={maxLength}
			onChange={(e) => onChange(e.target.value)}
			onBlur={onBlur}
			placeholder={placeholder}
			className={cn("block w-full resize-y [field-sizing:content]", className)}
		/>
	)
}

/** A chunk that will not load is not an error the user should see. */
class TextareaOnError extends Component<
	EditionTextEditorProps & { children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	render() {
		const { children, ...props } = this.props
		return this.state.failed ? <Textarea {...props} /> : children
	}
}
