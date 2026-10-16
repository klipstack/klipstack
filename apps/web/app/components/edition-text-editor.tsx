import { Extension } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import Link from "@tiptap/extension-link"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { ExternalLink, Link2, Unlink } from "lucide-react"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { usePaletteHint } from "~/lib/commands"
import { normalizeHref, type RichDoc, toEditionText, toRichDoc } from "~/lib/edition-rich-text"
import { isSubmitShortcut } from "~/lib/shortcuts"
import { cn } from "~/lib/utils"
import { tooltip } from "./tooltip-host"
import { Button } from "./ui/button"

export interface EditionTextEditorProps {
	value: string
	onChange: (text: string) => void
	onBlur?: () => void
	/** ⌘↵ / Ctrl+Enter: done with the field. Without it, the key does what it always does. */
	onSubmit?: () => void
	placeholder?: string
	/** Takes the keyboard once ready, caret at the end. */
	autoFocus?: boolean
	maxLength?: number
	id?: string
	"aria-label"?: string
	"aria-labelledby"?: string
	/** The editable box: border, padding, text size. */
	className?: string
}

const textOf = (doc: ProseMirrorNode) => toEditionText(doc.toJSON() as RichDoc)

/** Drops any edit that would push the text past the length the server accepts. */
const MaxLength = Extension.create<{ max: number }>({
	name: "editionTextMaxLength",
	addOptions() {
		return { max: Number.POSITIVE_INFINITY }
	},
	addProseMirrorPlugins() {
		const { max } = this.options
		return [
			new Plugin({ filterTransaction: (tr) => !tr.docChanged || textOf(tr.doc).length <= max }),
		]
	},
})

/**
 * The intro and the notes of an edition, as the page shows them: links are links. Enter starts a
 * paragraph, Shift+Enter breaks the line. A link is made by pasting an address over the words, by
 * typing an address or `[words](address)`, or with ⌘K; with the caret in one, a bar under the text
 * edits its address. What is stored stays the text the page reads (`edition-rich-text.ts`).
 */
export default function EditionTextEditor({
	value,
	onChange,
	onBlur,
	onSubmit,
	placeholder,
	autoFocus,
	maxLength = Number.POSITIVE_INFINITY,
	id,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	className,
}: EditionTextEditorProps) {
	// The editor is created once; its handlers read the current values through refs.
	const latest = useRef({ onChange, onBlur, onSubmit, addLink: () => {} })
	const [adding, setAdding] = useState(false)
	useInsertionEffect(() => {
		latest.current = { onChange, onBlur, onSubmit, addLink: () => setAdding(true) }
	})
	// The text is read once: the editor owns the document from then on.
	const [initial] = useState(() => toRichDoc(value))

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			Document,
			Paragraph,
			Text,
			HardBreak,
			Link.configure({
				openOnClick: false,
				autolink: true,
				linkOnPaste: true,
				markdownLinks: true,
				defaultProtocol: "https",
				isAllowedUri: (url, { defaultValidate }) =>
					defaultValidate(url) && normalizeHref(url) !== null,
				HTMLAttributes: {
					target: null,
					rel: null,
					class: "text-link underline decoration-link/40 underline-offset-2",
				},
			}),
			UndoRedo,
			Placeholder.configure({ placeholder: placeholder ?? "" }),
			MaxLength.configure({ max: maxLength }),
		],
		content: initial,
		editorProps: {
			attributes: {
				...(id ? { id } : {}),
				...(ariaLabel ? { "aria-label": ariaLabel } : {}),
				...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
				role: "textbox",
				"aria-multiline": "true",
				"data-testid": "edition-text-editor",
				// The caller's box goes on the editable element itself: a click anywhere inside the
				// border takes the caret, the way a textarea does.
				class: cn(
					"whitespace-pre-wrap break-words outline-none [&_p+p]:mt-3",
					// Placeholder, shown on the first line while the text is empty.
					"[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-fg [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
					className,
				),
			},
			// ⌘↵ is done with the field, when the caller says what that does. ⌘K links the selected words, or edits the link under the caret. With neither, it is
			// the command palette's, as everywhere else.
			handleKeyDown: (view, event) => {
				const submit = latest.current.onSubmit
				if (submit && isSubmitShortcut(event)) {
					event.preventDefault()
					submit()
					return true
				}
				if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false
				if (event.key.toLowerCase() !== "k") return false
				const inLink = view.state.selection.$from.marks().some((m) => m.type.name === "link")
				if (view.state.selection.empty && !inLink) return false
				event.preventDefault()
				event.stopPropagation()
				latest.current.addLink()
				return true
			},
			// ⌘-click opens a link, as in other editors; a plain click places the caret.
			handleClick: (view, pos, event) => {
				if (!event.metaKey && !event.ctrlKey) return false
				const mark = view.state.doc
					.resolve(pos)
					.marks()
					.find((m) => m.type.name === "link")
				if (!mark) return false
				window.open(mark.attrs.href as string, "_blank", "noopener")
				return true
			},
		},
		onUpdate: ({ editor }: { editor: Editor }) => latest.current.onChange(textOf(editor.state.doc)),
		onBlur: () => latest.current.onBlur?.(),
	})

	useEffect(() => {
		if (autoFocus && editor) editor.commands.focus("end")
	}, [autoFocus, editor])

	// The bar shows while the field, or the bar itself, has the focus.
	const [focused, setFocused] = useState(false)
	const link = useEditorState({
		editor,
		selector: ({ editor }) =>
			editor
				? {
						href: editor.isActive("link")
							? ((editor.getAttributes("link").href as string | undefined) ?? "")
							: null,
						selected: !editor.state.selection.empty,
					}
				: null,
	})
	// Asked for a link, then the words were unselected: there is nothing to link any more.
	if (adding && link && !link.selected && link.href === null) setAdding(false)
	const showBar = focused && link !== null && (adding || link.href !== null || link.selected)

	return (
		<div
			onFocus={() => setFocused(true)}
			onBlur={(e) => {
				if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
				setFocused(false)
				setAdding(false)
			}}
		>
			<EditorContent editor={editor} />
			{showBar && editor ? (
				<LinkBar
					// A new link under the caret starts the address over.
					key={link.href ?? "new"}
					editor={editor}
					href={link.href}
					adding={adding}
					onAdd={() => setAdding(true)}
					onDone={() => setAdding(false)}
				/>
			) : null}
		</div>
	)
}

/**
 * Under the text, for the link at the caret: its address, to change, open or remove. With words
 * selected and no link yet, the button that links them.
 */
function LinkBar({
	editor,
	href,
	adding,
	onAdd,
	onDone,
}: {
	editor: Editor
	/** The link under the caret; null when there is none. */
	href: string | null
	adding: boolean
	onAdd: () => void
	onDone: () => void
}) {
	const { t } = useTranslation("editions")
	// The same keys as the palette's: ⌘K, or Ctrl K.
	const hint = usePaletteHint()
	const [draft, setDraft] = useState(href ?? "")
	const [invalid, setInvalid] = useState(false)

	if (href === null && !adding)
		return (
			<div className="mt-1.5 flex">
				<Button
					variant="ghost"
					size="sm"
					// Keeps the selection: the editor does not lose the focus to the button.
					onMouseDown={(e) => e.preventDefault()}
					onClick={onAdd}
					{...tooltip(t("textEditor.add"), hint || undefined)}
				>
					<Link2 className="size-4" aria-hidden />
					{t("textEditor.add")}
				</Button>
			</div>
		)

	/** Enter: the address goes on the link, and the caret back in the text. An empty one unlinks. */
	const apply = () => {
		const next = normalizeHref(draft)
		if (next === null && draft.trim()) return setInvalid(true)
		// Now, not on the next frame as Tiptap's `focus()` would: this field is about to go away,
		// and the focus with it.
		editor.view.focus()
		const chain = editor.chain().extendMarkRange("link")
		if (next === null) chain.unsetLink().run()
		else if (next !== href) chain.setLink({ href: next }).run()
		else chain.run()
		onDone()
	}
	/** Leaving the field keeps a changed address that works, and leaves the focus where it went. */
	const keep = () => {
		const next = normalizeHref(draft)
		if (next === null || next === href) return
		editor.chain().extendMarkRange("link").setLink({ href: next }).run()
	}

	return (
		<div className="mt-1.5 flex items-center gap-1 rounded-lg border border-border bg-bg p-1 text-sm">
			<Link2 className="ml-1.5 size-4 shrink-0 text-muted-fg" aria-hidden />
			<input
				type="url"
				value={draft}
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- asked for with ⌘K or the Link button
				autoFocus={adding}
				aria-label={t("textEditor.address")}
				aria-invalid={invalid || undefined}
				placeholder={t("textEditor.placeholder")}
				onChange={(e) => {
					setDraft(e.target.value)
					setInvalid(false)
				}}
				onBlur={keep}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault()
						apply()
					} else if (e.key === "Escape") {
						e.preventDefault()
						e.stopPropagation()
						editor.view.focus()
						onDone()
					}
				}}
				className={cn(
					"h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
					invalid && "text-danger",
				)}
			/>
			{href ? (
				<>
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={t("textEditor.open")}
						{...tooltip(t("textEditor.open"))}
						className="rounded-md p-2 text-muted-fg hover:bg-hover hover:text-fg"
					>
						<ExternalLink className="size-4" aria-hidden />
					</a>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("textEditor.remove")}
						{...tooltip(t("textEditor.remove"))}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => {
							editor.view.focus()
							editor.chain().extendMarkRange("link").unsetLink().run()
							onDone()
						}}
					>
						<Unlink className="size-4" aria-hidden />
					</Button>
				</>
			) : null}
		</div>
	)
}
