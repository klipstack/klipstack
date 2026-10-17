import type { AiAnswerEvent, AiThreadWithMessages, KlipstackClient } from "@klipstack/sdk"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { type AiFailure, failureOf, NOTHING_WRITTEN, questionsLeft, type Written } from "./ai"
import {
	type AiCard,
	type AiPassage,
	type AnswerStore,
	afterRefusal,
	askCard,
	chosen,
	createAnswerStore,
	type DRAFT_CHOICES,
	followingUp,
	isTempThread,
	passageOf,
	refusedNew,
	retryOf,
	tempId,
	tempQuestion,
	withQuestion,
} from "./ai-threads"
import type { ReaderAi } from "./reader-ai"

export type AiAction = "explain" | "define" | "ask"

/**
 * The article's threads in the reader: the ones it loaded with, and the questions asked since, each
 * answer streamed into its card as it is written. One card is open at a time. With no questions
 * left this month, a question is refused here, as the server would. The web's `useAiThreads`.
 */
export function useAiCards(client: KlipstackClient | null, articleId: string, ai: ReaderAi) {
	const [cards, setCards] = useState<AiCard[]>(ai.threads)
	const [seen, setSeen] = useState(ai.threads)
	if (seen !== ai.threads) {
		setSeen(ai.threads)
		setCards(ai.threads)
	}
	const [openId, setOpenId] = useState<string | null>(null)
	const [written] = useState(createAnswerStore)
	const latest = useRef(cards)
	const allowance = useRef(ai.allowance)
	useEffect(() => {
		latest.current = cards
		allowance.current = ai.allowance
	})
	const { setAllowance, failed } = ai

	const update = useCallback((id: string, change: (card: AiCard) => AiCard) => {
		setCards((prev) => prev.map((c) => (c.id === id ? change(c) : c)))
	}, [])

	/**
	 * Streams the answer into card `id`. `start` swaps a new thread's temporary id for its own, and
	 * the temporary question for the saved one.
	 */
	const run = useCallback(
		async (id: string, ask: () => Promise<AsyncIterable<AiAnswerEvent>>) => {
			let current = id
			written.clear(id)
			const none: AiFailure | null = questionsLeft(allowance.current).none
				? { code: "limit_reached" }
				: null
			try {
				if (none) throw none
				for await (const event of await ask()) {
					switch (event.type) {
						case "start": {
							const { thread, question } = event
							setAllowance(event.allowance)
							const was = current
							current = thread.id
							setCards((prev) =>
								prev.map((c) =>
									c.id !== was
										? c
										: { ...c, ...thread, messages: withQuestion(c.messages, question) },
								),
							)
							setOpenId((open) => (open === was ? thread.id : open))
							break
						}
						case "text":
							written.write(current, event.text)
							break
						case "citation":
							written.cite(current, event.citation)
							break
						case "answer":
							update(current, (c) => ({
								...c,
								streaming: undefined,
								messages: [...c.messages, event.message],
							}))
							written.clear(current)
							break
					}
				}
			} catch (error) {
				const failure = error === none && none ? none : failureOf(error)
				failed(failure)
				written.clear(current)
				update(current, (c) => afterRefusal(c, failure))
				return
			}
			// The stream ended without the answer (the connection broke): the server saves it.
			written.clear(current)
			update(current, (c) => (c.streaming ? afterRefusal(c, { code: "network" }) : c))
		},
		[written, update, setAllowance, failed],
	)

	const askPassage = useCallback(
		(id: string, passage: AiPassage, action: AiAction, question?: string) =>
			run(id, () => {
				if (!client) throw new Error("signed out")
				return client.ai.ask(articleId, {
					action,
					exact: passage.exact,
					prefix: passage.prefix || undefined,
					suffix: passage.suffix || undefined,
					start: passage.start,
					end: passage.end,
					question,
				})
			}),
		[client, articleId, run],
	)

	/**
	 * Asking about a passage opens a draft: nothing is sent until the reader chooses Explain or
	 * Define (`choose`) or sends a question. With no questions left, the card says so.
	 */
	const start = useCallback((passage: AiPassage) => {
		const id = tempId("t")
		const card = askCard(id, passage, questionsLeft(allowance.current).none)
		setCards((prev) => [...prev.filter((c) => !c.draft), card])
		setOpenId(id)
	}, [])

	/** A draft becomes an Explain or a Define of its passage, sent at once. */
	const choose = useCallback(
		(id: string, action: (typeof DRAFT_CHOICES)[number]) => {
			const card = latest.current.find((c) => c.id === id)
			if (!card?.draft) return
			update(id, (c) => chosen(c, action))
			void askPassage(id, passageOf(card), action)
		},
		[askPassage, update],
	)

	const send = useCallback(
		(id: string, text: string) => {
			const card = latest.current.find((c) => c.id === id)
			if (!card || !text.trim() || !client) return
			if (card.draft || (isTempThread(id) && card.failure)) {
				// A first question: an Ask's, or one refused before it began.
				update(id, (c) => ({
					...c,
					draft: undefined,
					failure: undefined,
					messages: [tempQuestion(text)],
					streaming: true,
				}))
				if (card.action === "chat") void run(id, () => client.ai.chat(articleId, text))
				else void askPassage(id, passageOf(card), card.action as AiAction, text)
				return
			}
			update(id, (c) => ({
				...c,
				failure: undefined,
				messages: followingUp(c.messages, text),
				streaming: true,
			}))
			void run(id, () => client.ai.followUp(id, text))
		},
		[client, articleId, run, askPassage, update],
	)

	const retry = useCallback(
		(id: string) => {
			const card = latest.current.find((c) => c.id === id)
			if (!card || !client) return
			const again = retryOf(card)
			// Refused before it began: a new thread asks again from the start, a follow-up is sent again.
			if (again.kind === "first" || again.kind === "follow-up") return send(id, again.question)
			if (again.kind === "passage") {
				update(id, (c) => ({
					...c,
					failure: undefined,
					messages: [tempQuestion("")],
					streaming: true,
				}))
				void askPassage(id, passageOf(card), card.action as AiAction)
				return
			}
			// The old answer stays until the server takes the retry (`start`): a refusal keeps it.
			update(id, (c) => ({ ...c, failure: undefined, streaming: true }))
			void run(id, () => client.ai.retry(id))
		},
		[client, run, send, askPassage, update],
	)

	/** A question about the whole article: the first starts its chat, later ones follow up. */
	const chat = useCallback(
		(text: string, versionId: string) => {
			if (!text.trim() || !client) return
			const current = latest.current.find((c) => c.action === "chat")
			if (current) return send(current.id, text)
			const id = tempId("t")
			setCards((prev) => [
				...prev,
				{
					id,
					action: "chat",
					start: 0,
					end: 0,
					exact: "",
					versionId,
					highlightId: null,
					orphaned: false,
					createdAt: new Date().toISOString(),
					messages: [tempQuestion(text)],
					streaming: true,
				},
			])
			void run(id, () => client.ai.chat(articleId, text))
		},
		[client, articleId, run, send],
	)

	/**
	 * Takes a card away; a saved thread is deleted, and `onDeleted` offers the undo with what brings
	 * it back. A delete refused puts the card back, and says so (`onFailed`).
	 */
	const remove = useCallback(
		(id: string, onDeleted?: (restore: () => Promise<void>) => void, onFailed?: () => void) => {
			const card = latest.current.find((c) => c.id === id)
			setCards((prev) => prev.filter((c) => c.id !== id))
			setOpenId((open) => (open === id ? null : open))
			if (!card || isTempThread(id) || !client) return
			client.ai.delete(id).then(
				() =>
					onDeleted?.(async () => {
						const { thread } = await client.ai.restore(id)
						setCards((prev) =>
							prev.some((c) => c.id === id) ? prev : [...prev, thread as AiThreadWithMessages],
						)
					}),
				() => {
					setCards((prev) => (prev.some((c) => c.id === id) ? prev : [...prev, card]))
					onFailed?.()
				},
			)
		},
		[client],
	)

	/** Closes the open card. An Ask never sent, or refused before it began, goes with it. */
	const close = useCallback(() => {
		setOpenId(null)
		setCards((prev) => prev.filter((c) => !c.draft && (c.action === "chat" || !refusedNew(c))))
	}, [])

	const open = useCallback((id: string | null) => {
		setOpenId(id)
		setCards((prev) =>
			prev.filter((c) => c.id === id || (!c.draft && (c.action === "chat" || !refusedNew(c)))),
		)
	}, [])

	return { cards, openId, open, close, start, send, choose, retry, remove, chat, written }
}

export type AiCards = ReturnType<typeof useAiCards>

/** What has been written of a thread's answer so far; re-renders as it grows. */
export function useWritten(store: AnswerStore, id: string): Written {
	return useSyncExternalStore(
		store.subscribe,
		() => store.get(id) ?? NOTHING_WRITTEN,
		() => NOTHING_WRITTEN,
	)
}
