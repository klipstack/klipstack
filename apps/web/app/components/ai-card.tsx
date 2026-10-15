import type { AiCitation } from "@klipstack/db"
import {
	ArrowUp,
	BookOpen,
	ChevronUp,
	Copy,
	Lightbulb,
	Loader2,
	MessageCircleQuestion,
	MessagesSquare,
	RotateCcw,
	Trash2,
} from "lucide-react"
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AiResetsOnContext, useQuestionsLeft } from "~/hooks/use-ai-allowance"
import { type AnswerStore, type AiCard as Card, useWritten } from "~/hooks/use-ai-threads"
import type { AiFailure } from "~/lib/ai-stream.client"
import { cn } from "~/lib/utils"
import { AiAnswer, plainAnswer } from "./ai-answer"
import { tooltip } from "./tooltip-host"

export type AiCardPlacement =
	| { kind: "margin" }
	| { kind: "floating"; rect: DOMRect }
	| { kind: "sheet" }

export const AI_ACTION_ICONS = {
	explain: Lightbulb,
	define: BookOpen,
	ask: MessageCircleQuestion,
	chat: MessagesSquare,
} as const

const FLOATING_WIDTH = 360

interface Props {
	card: Card
	/** Where the answer being written is, word by word. */
	written: AnswerStore
	open: boolean
	placement: AiCardPlacement
	/** Citations can be followed: the answer read the version on screen. */
	canCite: boolean
	hovered?: boolean
	onOpen: () => void
	onClose: () => void
	onSend: (question: string) => void
	onRetry: () => void
	onDelete: () => void
	onCopy: (text: string) => void
	onCite: (citation: AiCitation) => void
	onHover?: (hovered: boolean) => void
}

/**
 * A question about a passage and its answers. Collapsed in the margin it shows the action, the
 * passage and the answer's first line; open, the whole thread, the answer streaming in, its
 * citations as chips, and a field for a follow-up.
 */
export function AiCard(props: Props) {
	const { card, open, hovered, onOpen, onHover } = props
	const { t } = useTranslation("reader")
	const Icon = AI_ACTION_ICONS[card.action]
	const streamed = useWritten(props.written, card.id)
	const answer = card.streaming
		? streamed.text
		: card.messages.findLast((m) => m.role === "assistant")?.text

	if (!open)
		return (
			<button
				type="button"
				onClick={onOpen}
				onMouseEnter={() => onHover?.(true)}
				onMouseLeave={() => onHover?.(false)}
				className={cn(
					"block w-full rounded-r-lg border-l-2 border-accent/60 px-3 py-1 text-left text-sm leading-snug text-muted-fg transition-colors hover:bg-muted/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					hovered && "bg-muted/60 text-fg",
				)}
			>
				<span className="flex items-center gap-1 text-xs font-medium text-accent">
					<Icon className="size-3" aria-hidden />
					{t(`ai.actions.${card.action}`)}
				</span>
				<span className="line-clamp-3">{answer ? plainAnswer(answer) : `“${card.exact}”`}</span>
			</button>
		)
	return <OpenCard {...props} />
}

function OpenCard({
	card,
	written,
	placement,
	canCite,
	onClose,
	onSend,
	onRetry,
	onDelete,
	onCopy,
	onCite,
	onHover,
}: Props) {
	const { t } = useTranslation("reader")
	const ref = useRef<HTMLDivElement>(null)
	const turnsRef = useRef<HTMLDivElement>(null)
	// A new question scrolls to the bottom; the answer then keeps it there while it is written,
	// unless the reader has scrolled up to read.
	const pinned = useRef(true)
	const streamed = useWritten(written, card.id)
	const turns = card.messages.length
	const length = streamed.text.length
	const shownTurns = useRef(turns)
	useLayoutEffect(() => {
		const el = turnsRef.current
		if (!el) return
		if (turns > shownTurns.current) pinned.current = true
		shownTurns.current = turns
		if (pinned.current) el.scrollTop = el.scrollHeight
	}, [turns, length])
	const Icon = AI_ACTION_ICONS[card.action]
	const busy = !!card.streaming
	const last = card.messages.at(-1)
	const lastAnswer = card.messages.findLast((m) => m.role === "assistant" && m.status === "done")
	// None left this month: no Retry, no follow-up, and `QuestionsLeft` says why.
	const { none } = useQuestionsLeft()

	// Escape closes it, and so does a press outside it.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) onClose()
		}
		const onDown = (e: PointerEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose()
		}
		document.addEventListener("keydown", onKey)
		document.addEventListener("pointerdown", onDown)
		return () => {
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("pointerdown", onDown)
		}
	}, [onClose])

	let style: React.CSSProperties | undefined
	if (placement.kind === "floating") {
		const { rect } = placement
		style = {
			position: "absolute",
			top: rect.bottom + window.scrollY + 8,
			left: Math.min(Math.max(8, rect.left), window.innerWidth - FLOATING_WIDTH - 8),
			width: FLOATING_WIDTH,
		}
	}

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label={t(`ai.actions.${card.action}`)}
			data-placement={placement.kind}
			data-testid="ai-card"
			style={style}
			onMouseEnter={() => onHover?.(true)}
			onMouseLeave={() => onHover?.(false)}
			className={cn(
				"bg-card font-sans text-sm leading-snug",
				placement.kind === "sheet"
					? "safe-bottom fixed inset-x-0 bottom-0 z-40 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
					: "rounded-xl border border-border p-3 shadow-lg",
				// Floating with the text, it scrolls under the top bar and the outline, as cards in the
				// margin do (MarginNotes).
				placement.kind === "floating" ? "z-10" : placement.kind === "margin" && "z-30",
				placement.kind === "margin" && "-mt-2.5",
			)}
		>
			<div className="flex items-center gap-1.5">
				<Icon className="size-3.5 text-accent" aria-hidden />
				<span className="text-xs font-medium text-accent">{t(`ai.actions.${card.action}`)}</span>
				<button
					type="button"
					onClick={onClose}
					aria-label={t("ai.collapse")}
					{...tooltip(t("ai.collapse"))}
					className="-mr-1 ml-auto rounded-md p-1 text-muted-fg hover:bg-muted hover:text-fg"
				>
					<ChevronUp className="size-3.5" aria-hidden />
				</button>
			</div>
			<p className="mt-1 line-clamp-2 text-xs text-muted-fg italic">“{card.exact}”</p>
			<div
				ref={turnsRef}
				onScroll={(e) => {
					const el = e.currentTarget
					pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
				}}
				className="mt-2 flex max-h-[60vh] flex-col gap-3 overflow-y-auto"
				aria-live="polite"
			>
				{card.messages.map((message) =>
					message.role === "user" ? (
						message.text ? (
							<p key={message.id} className="font-medium text-fg">
								{message.text}
							</p>
						) : null
					) : (
						<div key={message.id}>
							{message.status === "failed" ? (
								<p className="text-danger">{t("ai.failed")}</p>
							) : message.status === "refused" ? (
								<p className="text-muted-fg">{t("ai.refused")}</p>
							) : (
								<AiAnswer
									text={message.text}
									citations={message.citations}
									onCite={canCite ? onCite : undefined}
									citeLabel={(n) => t("ai.citation", { n })}
								/>
							)}
						</div>
					),
				)}
				{card.streaming ? (
					streamed.text ? (
						<AiAnswer
							text={streamed.text}
							citations={streamed.citations}
							onCite={canCite ? onCite : undefined}
							citeLabel={(n) => t("ai.citation", { n })}
						/>
					) : (
						<p className="flex items-center gap-1.5 text-muted-fg">
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
							{t("ai.thinking")}
						</p>
					)
				) : null}
				{card.failure ? <Failure {...card.failure} /> : null}
			</div>
			{card.draft ? (
				<>
					<QuestionField
						initial={card.draft.question}
						placeholder={t("ai.askPlaceholder")}
						onSend={onSend}
						onEscape={onClose}
					/>
					<QuestionsLeft />
				</>
			) : (
				<>
					{busy ? null : (
						<div className="mt-2 flex items-center gap-0.5">
							{/* After an answer, or a question left without one (the answer was lost). */}
							{(last || card.failure) && !none ? (
								<button
									type="button"
									onClick={onRetry}
									aria-label={t("ai.retry")}
									{...tooltip(t("ai.retry"))}
									className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
								>
									<RotateCcw className="size-3.5" aria-hidden />
								</button>
							) : null}
							{lastAnswer ? (
								<button
									type="button"
									onClick={() => onCopy(plainAnswer(lastAnswer.text))}
									aria-label={t("ai.copy")}
									{...tooltip(t("ai.copy"))}
									className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-fg"
								>
									<Copy className="size-3.5" aria-hidden />
								</button>
							) : null}
							<button
								type="button"
								onClick={onDelete}
								aria-label={t("ai.delete")}
								{...tooltip(t("ai.delete"))}
								className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-danger"
							>
								<Trash2 className="size-3.5" aria-hidden />
							</button>
						</div>
					)}
					{card.orphaned || busy || last?.role === "user" || none ? null : (
						<QuestionField
							placeholder={t("ai.followUpPlaceholder")}
							onSend={onSend}
							onEscape={onClose}
							autoFocus={false}
						/>
					)}
					{card.orphaned || busy ? null : (
						<QuestionsLeft failed={card.failure?.code === "limit_reached"} />
					)}
				</>
			)}
		</div>
	)
}

/** The cap's message, with the day it starts over (`AiResetsOnContext`). */
function useLimitMessage(): string | null {
	const { t } = useTranslation("reader")
	const resetsOn = useContext(AiResetsOnContext)
	return resetsOn ? t("ai.errors.limit_reached_on", { date: resetsOn }) : null
}

export function Failure({ code }: Pick<AiFailure, "code">) {
	const { t } = useTranslation("reader")
	const limit = useLimitMessage()
	if (code === "limit_reached" && limit)
		return (
			<p role="alert" className="text-danger">
				{limit}
			</p>
		)
	const known = [
		"limit_reached",
		"rate_limited",
		"network",
		"no_match",
		"not_ready",
		"forbidden",
		"too_large",
		"already_pending",
	]
	return (
		<p role="alert" className="text-danger">
			{t(`ai.errors.${known.includes(code) ? code : "other"}` as "ai.errors.other")}
		</p>
	)
}

/**
 * Where the next question would go: the questions left when few are, or, when none are, why there
 * is no field (`failed`: a refusal already says so).
 */
export function QuestionsLeft({ failed }: { failed?: boolean }) {
	const { t } = useTranslation("reader")
	const { left, few, none } = useQuestionsLeft()
	// Not an error: the last one was used. A refusal (`failed`) already says it, in red.
	const limit = useLimitMessage()
	if (none) return failed || !limit ? null : <p className="mt-2 text-xs text-muted-fg">{limit}</p>
	if (!few) return null
	return (
		<p className="mt-2 text-xs text-muted-fg" data-testid="questions-left">
			{t("ai.left", { count: left })}
		</p>
	)
}

/** A one-line question that grows as it is typed. Enter sends; Shift+Enter is a new line. */
export function QuestionField({
	initial = "",
	placeholder,
	onSend,
	onEscape,
	autoFocus = true,
}: {
	initial?: string
	placeholder: string
	onSend: (question: string) => void
	onEscape: () => void
	autoFocus?: boolean
}) {
	const { t } = useTranslation("reader")
	const [value, setValue] = useState(initial)
	const ref = useRef<HTMLTextAreaElement>(null)
	useEffect(() => {
		const field = ref.current
		if (!field || !autoFocus) return
		// No scroll: a margin card is still at the article's top until it is laid out. The caret
		// goes in first, as moving it in a focused field scrolls to it.
		field.setSelectionRange(field.value.length, field.value.length)
		field.focus({ preventScroll: true })
	}, [autoFocus])
	const send = () => {
		if (!value.trim()) return
		onSend(value.trim())
		setValue("")
	}
	return (
		<div className="mt-2 flex items-end gap-1 rounded-lg border border-border bg-bg px-2 py-1 focus-within:ring-2 focus-within:ring-ring">
			<textarea
				ref={ref}
				value={value}
				rows={1}
				maxLength={2000}
				aria-label={placeholder}
				placeholder={placeholder}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault()
						send()
					} else if (e.key === "Escape") {
						e.preventDefault()
						onEscape()
					}
				}}
				className="field-sizing-content max-h-32 min-h-6 flex-1 resize-none bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-fg"
			/>
			<button
				type="button"
				onClick={send}
				disabled={!value.trim()}
				aria-label={t("ai.send")}
				className="mb-0.5 rounded-md bg-accent p-1 text-accent-fg disabled:opacity-40"
			>
				<ArrowUp className="size-3.5" aria-hidden />
			</button>
		</div>
	)
}
