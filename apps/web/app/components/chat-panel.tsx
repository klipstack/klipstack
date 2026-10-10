import type { AiCitation } from "@klipstack/db"
import { Copy, Loader2, RotateCcw, Trash2 } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { type AiCard, type AnswerStore, useWritten } from "~/hooks/use-ai-threads"
import { AiAnswer, plainAnswer } from "./ai-answer"
import { Failure, QuestionField } from "./ai-card"
import { tooltip } from "./tooltip-host"

interface Props {
	/** The Chat tab is showing: its field takes the keyboard. */
	active: boolean
	/** The article's chat, when it has one. */
	chat: AiCard | undefined
	written: AnswerStore
	/** Citations can be followed: the chat read the version on screen. */
	canCite: boolean
	onAsk: (question: string) => void
	onRetry: () => void
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

	return (
		<div className="flex min-h-0 flex-1 flex-col font-sans text-sm leading-snug" data-testid="chat">
			<div
				ref={turnsRef}
				onScroll={(e) => {
					const el = e.currentTarget
					pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
				}}
				className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
				aria-live="polite"
			>
				{!chat || chat.messages.length === 0 ? (
					<p className="text-muted-fg">{t("ai.chat.empty")}</p>
				) : null}
				{chat?.messages.map((message) =>
					message.role === "user" ? (
						<p
							key={message.id}
							className="self-end rounded-lg bg-muted px-3 py-2 font-medium text-fg"
						>
							{message.text}
						</p>
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
									citeLabel={cite}
								/>
							)}
						</div>
					),
				)}
				{busy ? (
					streamed.text ? (
						<AiAnswer
							text={streamed.text}
							citations={streamed.citations}
							onCite={canCite ? onCite : undefined}
							citeLabel={cite}
						/>
					) : (
						<p className="flex items-center gap-1.5 text-muted-fg">
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
							{t("ai.thinking")}
						</p>
					)
				) : null}
				{chat?.failure && !busy ? <Failure code={chat.failure.code} /> : null}
			</div>
			<div className="border-t border-border p-3">
				{chat && !busy ? (
					<div className="mb-1 flex items-center gap-0.5">
						{last?.role === "user" || chat.failure || last?.role === "assistant" ? (
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
							onClick={onClear}
							aria-label={t("ai.chat.clear")}
							{...tooltip(t("ai.chat.clear"))}
							className="rounded-md p-1.5 text-muted-fg hover:bg-muted hover:text-danger"
						>
							<Trash2 className="size-3.5" aria-hidden />
						</button>
					</div>
				) : null}
				{/* A question still waiting for its answer takes no new one; a refused one does. */}
				{busy || (last?.role === "user" && !chat?.failure) ? null : (
					<QuestionField
						key={chat?.id ?? "new"}
						placeholder={t("ai.chat.placeholder")}
						onSend={onAsk}
						onEscape={() => {}}
						autoFocus={active}
					/>
				)}
			</div>
		</div>
	)
}
