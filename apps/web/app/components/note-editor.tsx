import { Extension, Node } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import {
	type Editor,
	EditorContent,
	NodeViewWrapper,
	ReactNodeViewRenderer,
	useEditor,
} from "@tiptap/react"
import Suggestion from "@tiptap/suggestion"
import { useEffect, useInsertionEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router"
import type { LinkStatus, LinkTargets } from "~/lib/note-links"
import { insertTitle, parse } from "~/lib/note-links"
import { cn } from "~/lib/utils"
import { type LinkOption, NoteLinkMenu } from "./note-link-menu"

/** What a note's own buttons can ask the editor to do, once its chunk is in. */
export interface NoteEditorApi {
	/** Open the article menu at the caret, as typing the trigger would. */
	linkArticle: () => void
}

export interface NoteEditorProps {
	value: string
	onChange: (text: string) => void
	onBlur?: () => void
	/** ⌘/Ctrl+Enter. */
	onSubmit?: () => void
	/** Escape, only while the link menu is closed. */
	onEscape?: () => void
	placeholder?: string
	autoFocus?: boolean
	maxLength?: number
	/** The article being read: it never offers itself in the menu. */
	documentId?: string
	linkTargets?: LinkTargets
	id?: string
	"aria-label"?: string
	className?: string
	/** Handed the editor once it is ready, and null when it goes away. */
	onApi?: (api: NoteEditorApi | null) => void
}

/** How long typing settles before the menu asks the server. */
const SEARCH_DEBOUNCE = 150

/**
 * What opens the article menu. `[[` is the Obsidian habit; `@` is one keyboard layer away on a
 * phone, where `[` is two. The **Link article** button types the first one for you.
 */
const TRIGGERS = [
	{ char: "[[", key: new PluginKey("docLinkSuggestion") },
	{ char: "@", key: new PluginKey("docLinkSuggestionAt") },
]
const BUTTON_TRIGGER = TRIGGERS[0]!.char

// ---- the note's text, to and from a ProseMirror document ----

function toContent(text: string, linkTargets: LinkTargets) {
	return {
		type: "doc",
		content: parse(text).map((line) => ({
			type: "paragraph",
			content: line.map((segment) =>
				segment.kind === "text"
					? { type: "text", text: segment.text }
					: {
							type: "docLink",
							attrs: {
								id: segment.id,
								title: segment.title,
								status: linkTargets[segment.id] ?? "missing",
							},
						},
			),
		})),
	}
}

function toText(doc: ProseMirrorNode): string {
	const lines: string[] = []
	doc.forEach((paragraph) => {
		let line = ""
		paragraph.forEach((child) => {
			line +=
				child.type.name === "docLink"
					? `[${child.attrs.title}](/read/${child.attrs.id})`
					: (child.text ?? "")
		})
		lines.push(line)
	})
	return lines.join("\n")
}

// ---- the link ----

function DocLinkView({ node }: { node: ProseMirrorNode }) {
	const status = node.attrs.status as LinkStatus
	return (
		<NodeViewWrapper
			as="span"
			data-testid="doc-chip"
			data-doc-link={node.attrs.id}
			data-status={status}
			// Inline, like the read-only chip: a long title wraps instead of being cut short. It is
			// still one atom — a click selects the whole of it, Backspace removes the whole of it.
			className={cn(
				"text-link underline decoration-link/40 underline-offset-2",
				status === "trash" && "text-muted-fg line-through decoration-muted-fg/40",
				status === "missing" && "text-muted-fg decoration-muted-fg/40",
			)}
		>
			{node.attrs.title}
		</NodeViewWrapper>
	)
}

const DocLink = Node.create({
	name: "docLink",
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	addAttributes() {
		return {
			id: { default: "" },
			title: { default: "" },
			// Only for how the chip looks; the note's text carries the id and the title alone.
			status: { default: "ok" as LinkStatus },
		}
	},
	parseHTML() {
		return [{ tag: "span[data-doc-link]" }]
	},
	renderHTML({ node }) {
		return ["span", { "data-doc-link": node.attrs.id }, node.attrs.title]
	},
	addNodeView() {
		return ReactNodeViewRenderer(DocLinkView)
	},
})

/**
 * Drops any edit that would push the note past the length the server accepts. The server counts
 * code points (an emoji is one), so a note it accepted always stays editable here.
 */
const MaxLength = Extension.create<{ max: number }>({
	name: "noteMaxLength",
	addOptions() {
		return { max: Number.POSITIVE_INFINITY }
	},
	addProseMirrorPlugins() {
		const { max } = this.options
		return [
			new Plugin({
				filterTransaction: (tr) => !tr.docChanged || [...toText(tr.doc)].length <= max,
			}),
		]
	},
})

// ---- the `[[` menu ----

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchController: AbortController | undefined

/**
 * The menu's rows. Only the newest query ever resolves: an earlier one is dropped rather than
 * allowed to overwrite the rows with stale results.
 */
function searchArticles(query: string, exclude: string | undefined): Promise<LinkOption[]> {
	clearTimeout(searchTimer)
	searchController?.abort()
	return new Promise((resolve) => {
		searchTimer = setTimeout(async () => {
			const controller = new AbortController()
			searchController = controller
			const url = `/api/search?q=${encodeURIComponent(query)}${exclude ? `&exclude=${exclude}` : ""}`
			try {
				const res = await fetch(url, { signal: controller.signal })
				const body = (await res.json()) as { items?: LinkOption[] }
				resolve(body.items ?? [])
			} catch {
				if (!controller.signal.aborted) resolve([])
			}
		}, SEARCH_DEBOUNCE)
	})
}

interface MenuState {
	/** Which trigger opened it: the other one's exit must not close it. */
	source: string
	/** False while a search is in flight: an empty menu is not yet an empty result. */
	loaded: boolean
	/** The caret. Null until the plugin's decoration is in the DOM; the menu waits for it. */
	rect: DOMRect | null
	items: LinkOption[]
	query: string
	selected: number
	command: (props: { id: string; title: string }) => void
}

/**
 * What the plugins below need from the component that owns an editor, as of its latest commit. The
 * extensions are built once for the whole app; their handlers look up their editor's owner here.
 */
interface Host {
	menu: MenuState | null
	setMenu: React.Dispatch<React.SetStateAction<MenuState | null>>
	documentId: string | undefined
	onSubmit: (() => void) | undefined
	onEscape: (() => void) | undefined
}
const hosts = new WeakMap<Editor, Host>()

function pickRow(state: MenuState | null, index: number) {
	const item = state?.items[index]
	if (!state || !item) return
	state.command({ id: item.id, title: insertTitle(item.title) })
}

const DocLinkSuggestion = Extension.create({
	name: "docLinkSuggestion",
	addProseMirrorPlugins() {
		const editor = this.editor
		const setMenu: Host["setMenu"] = (next) => hosts.get(editor)?.setMenu(next)
		return TRIGGERS.map(({ char, key }) =>
			Suggestion({
				editor,
				pluginKey: key,
				char,
				allowSpaces: true,
				startOfLine: false,
				// A trigger straight after a word still counts; on a phone that saves a space.
				allowedPrefixes: null,
				items: ({ query }) => searchArticles(query, hosts.get(editor)?.documentId),
				command: ({ editor, range, props }) => {
					editor
						.chain()
						.focus()
						.insertContentAt(range, [
							{ type: "docLink", attrs: { ...props, status: "ok" } },
							{ type: "text", text: " " },
						])
						.run()
				},
				render: () => ({
					onStart: (props) => {
						// The decoration can still be missing here, and with it the caret's rect — an
						// insert from the Link article button is the usual way in. Open anyway: the
						// update that follows carries the rect, and dropping the menu here would
						// ignore every update after it.
						setMenu({
							source: char,
							loaded: !props.loading,
							rect: props.clientRect?.() ?? null,
							items: props.items,
							query: props.query,
							selected: 0,
							command: props.command,
						})
					},
					onUpdate: (props) => {
						const rect = props.clientRect?.()
						setMenu((m) =>
							m?.source === char
								? {
										...m,
										loaded: !props.loading,
										rect: rect ?? m.rect,
										items: props.items,
										query: props.query,
										selected: 0,
										command: props.command,
									}
								: m,
						)
					},
					onKeyDown: ({ event }) => {
						const state = hosts.get(editor)?.menu
						if (state?.source !== char) return false
						if (event.key === "Escape") {
							setMenu(null)
							return true
						}
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							const step = event.key === "ArrowDown" ? 1 : -1
							setMenu((m) =>
								m?.items.length
									? { ...m, selected: (m.selected + step + m.items.length) % m.items.length }
									: m,
							)
							return true
						}
						if (event.key === "Enter") {
							// Nothing matched: leave the typed text alone.
							if (!state.items.length) return true
							pickRow(state, state.selected)
							return true
						}
						return false
					},
					// The other trigger's plugin exits too; only its own owner closes the menu.
					onExit: () => setMenu((m) => (m?.source === char ? null : m)),
				}),
			}),
		)
	},
})

const NoteEditorKeys = Extension.create({
	name: "noteEditorKeys",
	addKeyboardShortcuts() {
		return {
			Enter: () => this.editor.commands.splitBlock(),
			"Shift-Enter": () => this.editor.commands.splitBlock(),
			"Mod-Enter": () => {
				hosts.get(this.editor)?.onSubmit?.()
				return true
			},
			Escape: () => {
				// While the menu is open, Escape belongs to the menu.
				if (hosts.get(this.editor)?.menu) return false
				hosts.get(this.editor)?.onEscape?.()
				return true
			},
		}
	},
})

/**
 * The one editor behind both notes: plain lines of text, plus chips linking to other articles.
 * `[[` opens the article menu at the caret. The text is Markdown; nothing here stores `[[`.
 */
export default function NoteEditor({
	value,
	onChange,
	onBlur,
	onSubmit,
	onEscape,
	placeholder,
	autoFocus,
	maxLength = Number.POSITIVE_INFINITY,
	documentId,
	linkTargets,
	id,
	"aria-label": ariaLabel,
	className,
	onApi,
}: NoteEditorProps) {
	const navigate = useNavigate()
	const [menu, setMenu] = useState<MenuState | null>(null)
	// The editor is created once; its handlers read the current values through refs.
	const latest = useRef({ onChange, navigate })
	const onApiRef = useRef(onApi)
	useInsertionEffect(() => {
		latest.current = { onChange, navigate }
		onApiRef.current = onApi
	})
	// The note is read once: the editor owns the document from then on.
	const [initial] = useState(() => toContent(value, linkTargets ?? {}))

	const editor = useEditor({
		immediatelyRender: false,
		// Focus is taken below, without Tiptap's scrolling.
		autofocus: false,
		extensions: [
			Document,
			Paragraph,
			Text,
			DocLink,
			UndoRedo,
			Placeholder.configure({ placeholder: placeholder ?? "" }),
			MaxLength.configure({ max: maxLength }),
			NoteEditorKeys,
			DocLinkSuggestion,
		],
		content: initial,
		editorProps: {
			attributes: {
				...(id ? { id } : {}),
				...(ariaLabel ? { "aria-label": ariaLabel } : {}),
				role: "textbox",
				"aria-multiline": "true",
				"data-testid": "note-editor",
				// The caller's box goes on the editable element itself, not on a wrapper around it: a
				// click anywhere inside the border must take the caret, the way a textarea does.
				class: cn(
					"whitespace-pre-wrap break-words outline-none",
					// Placeholder, shown on the first line while the note is empty.
					"[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-[color:var(--note-placeholder,var(--k-muted-fg))] [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
					// The placeholder floats at no height so the caret stays on its first line; an unseen
					// copy, raised a line, keeps the room a placeholder of several lines takes.
					"[&_p.is-editor-empty:first-child]:after:invisible [&_p.is-editor-empty:first-child]:after:-mt-[1lh] [&_p.is-editor-empty:first-child]:after:block [&_p.is-editor-empty:first-child]:after:content-[attr(data-placeholder)]",
					className,
				),
			},
			// A plain click on a chip only selects it; the editor is where the user is typing.
			handleClickOn: (_view, _pos, node, _nodePos, event) => {
				if (node.type.name !== "docLink") return false
				if (!event.metaKey && !event.ctrlKey) return false
				event.preventDefault()
				void latest.current.navigate(`/read/${node.attrs.id}`)
				return true
			},
		},
		onUpdate: ({ editor }: { editor: Editor }) => latest.current.onChange(toText(editor.state.doc)),
		onBlur: () => onBlur?.(),
	})
	// The plugins act on this render's menu and callbacks.
	useInsertionEffect(() => {
		if (editor) hosts.set(editor, { menu, setMenu, documentId, onSubmit, onEscape })
	})

	// One note can have two editors at once (the reader's sidebar and the end of the article): what
	// the other one wrote replaces this one's text, so the two never hold different drafts. The
	// editor being typed in is left alone: it holds the text, and may be ahead of what it reported
	// (a phone keyboard, a composed accent). Not an undo step here. The caret goes to the start:
	// left after a `[[` the other one typed, it would open this one's menu too.
	const targets = useRef(linkTargets)
	useInsertionEffect(() => {
		targets.current = linkTargets
	})
	useEffect(() => {
		if (!editor || editor.isDestroyed || editor.isFocused) return
		if (toText(editor.state.doc) === value) return
		editor
			.chain()
			.setMeta("addToHistory", false)
			.setContent(toContent(value, targets.current ?? {}), { emitUpdate: false })
			.setTextSelection(1)
			.run()
	}, [editor, value])

	// The note's own buttons can reach the editor once its chunk has loaded. Typing the trigger is
	// exactly what the button does: the suggestion plugin reads the text before the caret, and does
	// not care who put it there.
	useEffect(() => {
		if (!editor) return
		onApiRef.current?.({
			linkArticle: () => editor.chain().focus().insertContent(BUTTON_TRIGGER).run(),
		})
		return () => onApiRef.current?.(null)
	}, [editor])

	// Take the keyboard on open (a new highlight note), caret at the end. The page stays put: on
	// phones Tiptap's own focus lets the browser scroll, and the reader has already placed the
	// highlight above the sheet.
	useEffect(() => {
		if (!autoFocus || !editor) return
		editor.view.dom.focus({ preventScroll: true })
		editor.commands.focus("end", { scrollIntoView: false })
	}, [autoFocus, editor])

	// The caret never leaves the editor, so the editor is what names the highlighted menu row.
	useEffect(() => {
		const dom = editor?.view.dom
		if (!dom) return
		if (menu) dom.setAttribute("aria-activedescendant", `note-link-option-${menu.selected}`)
		else dom.removeAttribute("aria-activedescendant")
	}, [editor, menu])

	return (
		<>
			<EditorContent editor={editor} />
			{menu?.rect && (menu.loaded || menu.items.length > 0)
				? createPortal(
						<NoteLinkMenu
							rect={menu.rect}
							items={menu.items}
							selected={menu.selected}
							recent={menu.query.length === 0}
							onPick={(i) => pickRow(menu, i)}
							onHover={(i) => setMenu((m) => (m ? { ...m, selected: i } : m))}
						/>,
						document.body,
					)
				: null}
		</>
	)
}
