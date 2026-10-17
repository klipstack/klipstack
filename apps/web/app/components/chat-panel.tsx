import type { AiCitation } from "@klipstack/db"
import { Copy, RotateCcw, Trash2 } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useQuestionsLeft } from "~/hooks/use-ai-allowance"
import { type AiCard, type AnswerStore, useWritten } from "~/hooks/use-ai-threads"
import { AiAnswer, plainAnswer } from "./ai-answer"
import { Failure, QuestionField, QuestionsLeft } from "./ai-card"
import { InkThinking } from "./ink-thinking"
import { tooltip } from "./tooltip-host"

interface Props {
	/** The Chat tab is showing: its field takes the keyboard. */
	active: boolean
	/** The article's chat, when it has one. */
	chat: AiCard | undefined
	written: AnswerStore
	/** Citations can be followed: the chat read the version on screen. */
	canCite: boolean
	/** Missing while AI answers are turned off: the chat is read, copied and cleared only. */
	onAsk?: (question: string) => void
	onRetry?: () => void
	onClear: () => void
	onCopy: (text: string) => void
	onCite: (citation: AiCitation) => void
}

/**
 * The article's chat, in the sidebar's Chat tab: questions about the whole article and their cited
 * answers, newest at the bottom, with the field under them.
 */
export function ChatPanel({
	active,
	chat,
	written,
	canCite,
	onAsk,
	onRetry,
	onClear,
	onCopy,
	onCite,
}: Props) {
	const { t } = useTranslation("reader")
	const streamed = useWritten(written, chat?.id ?? "")
	const turnsRef = useRef<HTMLDivElement>(null)
	const turns = chat?.messages.length ?? 0
	const length = streamed.text.length
	// The newest turn in view, as in the cards; the reader scrolling up keeps their place.
	const pinned = useRef(true)
	const shownTurns = useRef(turns)
	useLayoutEffect(() => {
		const el = turnsRef.current
		if (!el) return
		if (turns > shownTurns.current) pinned.current = true
		shownTurns.current = turns
		if (pinned.current) el.scrollTop = el.scrollHeight
	}, [turns, length])
	const busy = !!chat?.streaming
	const last = chat?.messages.at(-1)
	const lastAnswer = chat?.messages.findLast((m) => m.role === "assistant" && m.status === "done")
	const cite = (n: number) => t("ai.citation", { n })
	const { none } = useQuestionsLeft()

	return (
		<div className="flex min-h-0 flex-1 flex-col text-sm leading-snug" data-testid="chat">
			<div
				ref={turnsRef}
				onScroll={(e) => {
					const el = e.currentTarget
					pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
				}}
				className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pt-3 pb-4"
				aria-live="polite"
			>
				{!chat || chat.messages.length === 0 ? (
					<p className="font-serif text-base italic text-muted-fg">{t("ai.chat.empty")}</p>
				) : null}
				{chat?.messages.map((message) =>
					message.role === "user" ? (
						// The reader's question, written as a note is: the post-its' italic serif and ink.
						<p
							key={message.id}
							className="border-l-2 border-(--hl-solid) pl-3 font-serif text-base italic leading-snug text-note-fg"
						>
							{message.text}
						</p>
					) : (
						// The answer, a short passage in the reader's own typeface.
						<div key={message.id} className="reader-type text-[1.0625rem] leading-[1.6]">
							{message.status === "failed" ? (
								<p className="text-danger">{t("ai.failed")}</p>
							) : message.status === "refused" ? (
								<p className="text-muted-fg">{t("ai.refused")}</p>
							) : (
								<AiAnswer
									text={message.text}
									citations={message.citations}
									onCite={canCite ? onCite : undefined}
									citeLabel={cite}
								/>
							)}
						</div>
					),
				)}
				{busy ? (
					streamed.text ? (
						<div className="reader-type text-[1.0625rem] leading-[1.6]">
							<AiAnswer
								text={streamed.text}
								citations={streamed.citations}
								onCite={canCite ? onCite : undefined}
								citeLabel={cite}
							/>
						</div>
					) : (
						<InkThinking label={t("ai.thinking")} className="font-serif text-base italic" />
					)
				) : null}
				{chat?.failure && !busy ? <Failure {...chat.failure} /> : null}
			</div>
			<div className="px-4 pt-1 pb-3">
				{chat && !busy ? (
					<div className="mb-1 flex items-center gap-0.5">
						{onRetry &&
						(last?.role === "user" || chat.failure || last?.role === "assistant") &&
						!none ? (
							<button
								type="button"
								onClick={onRetry}
								aria-label={t("ai.retry")}
								{...tooltip(t("ai.retry"))}
								className="rounded-md p-1.5 text-muted-fg hover:bg-hover hover:text-fg"
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
								className="rounded-md p-1.5 text-muted-fg hover:bg-hover hover:text-fg"
							>
								<Copy className="size-3.5" aria-hidden />
							</button>
						) : null}
						<button
							type="button"
							onClick={onClear}
							aria-label={t("ai.chat.clear")}
							{...tooltip(t("ai.chat.clear"))}
							className="rounded-md p-1.5 text-muted-fg hover:bg-hover hover:text-danger"
						>
							<Trash2 className="size-3.5" aria-hidden />
						</button>
					</div>
				) : null}
				{/* A question still waiting for its answer takes no new one; a refused one does. */}
				{!onAsk ? (
					<p className="text-xs text-muted-fg">{t("ai.turnedOff")}</p>
				) : busy || (last?.role === "user" && !chat?.failure) || none ? null : (
					<QuestionField
						key={chat?.id ?? "new"}
						placeholder={t("ai.chat.placeholder")}
						onSend={onAsk}
						onEscape={() => {}}
						autoFocus={active}
					/>
				)}
				{busy || !onAsk ? null : <QuestionsLeft failed={chat?.failure?.code === "limit_reached"} />}
			</div>
		</div>
	)
}
