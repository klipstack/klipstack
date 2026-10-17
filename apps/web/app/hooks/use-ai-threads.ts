import type { AiCitation, AiThreadAction } from "@klipstack/db"
import { useCallback, useInsertionEffect, useRef, useState, useSyncExternalStore } from "react"
import { type AiFailure, changeThread, streamAnswer } from "~/lib/ai-stream.client"
import type { AiMessageView, AiStreamEvent, AiThreadWithMessages } from "~/lib/ai-threads"
import type { AiAllowanceState } from "./use-ai-allowance"

/** A passage to ask about: where it is in the article's current version. */
export interface AiPassage {
	exact: string
	prefix: string
	suffix: string
	start: number
	end: number
	versionId: string
	highlightId?: string
}

/** A thread on screen: what the server keeps, plus what is happening to it now. */
export interface AiCard extends AiThreadWithMessages {
	/** An Ask not sent yet: its question field. */
	draft?: { question: string }
	/** An answer is being written: its words are in the `AnswerStore`, so they don't re-render the reader. */
	streaming?: boolean
	/** Why the last question was not answered (a refusal before it began, or the network). */
	failure?: AiFailure
}

let seq = 0
const tempId = (kind: string) => `tmp-ai-${kind}-${++seq}`
export const isTempThread = (id: string) => id.startsWith("tmp-ai-")

const now = () => new Date().toISOString()
const question = (text: string): AiMessageView => ({
	id: tempId("q"),
	role: "user",
	text,
	status: "done",
	citations: [],
	createdAt: now(),
})

/**
 * The reader's AI threads: the ones the article loaded with, and the questions asked since, each
 * answer streamed into its card as it is written. One card is open at a time. When the page's data
 * loads again (an undo, a refresh), `reloaded` merges it in. With no questions left this month
 * (`allowance`), a question is refused here, as the server would.
 */
export function useAiThreads(
	documentId: string,
	loaded: AiThreadWithMessages[],
	allowance?: Pick<AiAllowanceState, "take" | "refused" | "refusal">,
) {
	const [cards, setCards] = useState<AiCard[]>(loaded)
	const [seen, setSeen] = useState(loaded)
	const [openId, setOpenId] = useState<string | null>(null)
	const [written] = useState(createAnswerStore)
	// Threads asked on this page, and deletes on their way: a load that began before them is stale.
	const asked = useRef(new Set<string>())
	const deleting = useRef(new Set<string>())
	if (seen !== loaded) {
		setSeen(loaded)
		setCards((prev) => reloaded(prev, loaded, asked.current, deleting.current))
	}
	const latest = useRef(cards)
	const quota = useRef(allowance)
	useInsertionEffect(() => {
		latest.current = cards
		quota.current = allowance
	})

	const update = useCallback((id: string, change: (card: AiCard) => AiCard) => {
		setCards((prev) => prev.map((c) => (c.id === id ? change(c) : c)))
	}, [])

	/**
	 * Streams the answer into the card `id`. `start` swaps a new thread's temporary id for its own,
	 * and the temporary question for the saved one.
	 */
	const run = useCallback(
		async (id: string, body: Record<string, unknown>) => {
			let current = id
			const onEvent = (event: AiStreamEvent) => {
				switch (event.type) {
					case "start": {
						const { thread, question: saved } = event
						quota.current?.take(event.allowance)
						const was = current
						current = thread.id
						asked.current.add(thread.id)
						setCards((prev) =>
							prev.map((c) =>
								c.id !== was
									? c
									: {
											...c,
											...thread,
											messages: withQuestion(c.messages, saved),
										},
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
			written.clear(id)
			const none = quota.current?.refusal()
			const result = none
				? ({ ok: false, error: none } as const)
				: await streamAnswer(documentId, body, onEvent)
			written.clear(current)
			if (!result.ok) quota.current?.refused(result.error)
			if (!result.ok)
				update(current, (c) => ({
					...c,
					streaming: undefined,
					failure: result.error,
					// A follow-up the server never took is not kept. A new thread's first question is: it
					// is all the card holds, and Answer again asks it again.
					messages: isTempThread(c.id)
						? c.messages
						: c.messages.filter((m) => !m.id.startsWith("tmp-ai-")),
				}))
		},
		[documentId, update, written],
	)

	/**
	 * Explain and Define are sent at once; Ask opens its question field first, or, with no questions
	 * left, says so.
	 */
	const start = useCallback(
		(passage: AiPassage, action: AiThreadAction, typed = "") => {
			const id = tempId("t")
			const none = action === "ask" ? quota.current?.refusal() : null
			const card: AiCard = {
				id,
				action,
				start: passage.start,
				end: passage.end,
				exact: passage.exact,
				versionId: passage.versionId,
				highlightId: passage.highlightId ?? null,
				orphaned: false,
				createdAt: now(),
				messages: action === "ask" ? [] : [question("")],
				...(none
					? { failure: none }
					: action === "ask"
						? { draft: { question: typed } }
						: { streaming: true }),
			}
			setCards((prev) => [...prev, card])
			setOpenId(id)
			if (action !== "ask") void run(id, askBody(passage, action))
		},
		[run],
	)

	const send = useCallback(
		(id: string, text: string) => {
			const card = latest.current.find((c) => c.id === id)
			if (!card || !text.trim()) return
			if (card.draft || (isTempThread(id) && card.failure)) {
				// A first question: an Ask's, or one refused before it began.
				update(id, (c) => ({
					...c,
					draft: undefined,
					failure: undefined,
					messages: [question(text)],
					streaming: true,
				}))
				void run(
					id,
					card.action === "chat"
						? { intent: "chat", question: text }
						: {
								...askBody(
									{ ...card, prefix: "", suffix: "", highlightId: card.highlightId ?? undefined },
									card.action,
								),
								question: text,
							},
				)
				return
			}
			update(id, (c) => ({
				...c,
				failure: undefined,
				messages: [...c.messages, question(text)],
				streaming: true,
			}))
			void run(id, { intent: "follow-up", id, question: text })
		},
		[run, update],
	)

	const retry = useCallback(
		(id: string) => {
			const card = latest.current.find((c) => c.id === id)
			if (!card) return
			if (isTempThread(id)) {
				// Refused before it began: ask again from the start.
				const text = card.messages[0]?.text ?? ""
				if (card.action === "ask" || card.action === "chat") send(id, text)
				else {
					update(id, (c) => ({
						...c,
						failure: undefined,
						messages: [question("")],
						streaming: true,
					}))
					void run(
						id,
						askBody(
							{ ...card, prefix: "", suffix: "", highlightId: card.highlightId ?? undefined },
							card.action,
						),
					)
				}
				return
			}
			// The old answer stays until the server takes the retry (`start`): a refusal keeps it.
			update(id, (c) => ({ ...c, failure: undefined, streaming: true }))
			void run(id, { intent: "retry", id })
		},
		[run, send, update],
	)

	/**
	 * A question about the whole article: the first one starts the article's chat, a later one
	 * follows up in it.
	 */
	const chat = useCallback(
		(text: string, versionId: string) => {
			if (!text.trim()) return
			const current = latest.current.find((c) => c.action === "chat")
			if (current && !current.draft) return send(current.id, text)
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
					createdAt: now(),
					messages: [question(text)],
					streaming: true,
				},
			])
			void run(id, { intent: "chat", question: text })
		},
		[run, send],
	)

	/** Takes a card off the page; a saved thread is deleted, and `onDeleted` offers the undo. */
	const remove = useCallback(
		(id: string, onDeleted?: () => void) => {
			setCards((prev) => prev.filter((c) => c.id !== id))
			setOpenId((open) => (open === id ? null : open))
			if (isTempThread(id)) return
			deleting.current.add(id)
			void changeThread(documentId, { intent: "delete", id }).then((result) => {
				deleting.current.delete(id)
				if (result.ok) onDeleted?.()
			})
		},
		[documentId],
	)

	/** Closes the open card. An Ask never sent goes with it. */
	const close = useCallback(() => {
		setOpenId(null)
		setCards((prev) => prev.filter((c) => !c.draft))
	}, [])

	const open = useCallback((id: string | null) => {
		setOpenId(id)
		setCards((prev) => prev.filter((c) => !c.draft || c.id === id))
	}, [])

	return { cards, openId, open, close, start, send, retry, remove, chat, written }
}

function askBody(
	passage: Pick<AiPassage, "exact" | "prefix" | "suffix" | "start" | "end" | "highlightId">,
	action: AiThreadAction,
) {
	return {
		intent: "ask",
		action,
		exact: passage.exact,
		prefix: passage.prefix || undefined,
		suffix: passage.suffix || undefined,
		start: passage.start,
		end: passage.end,
		highlightId: passage.highlightId,
	}
}

/**
 * The cards after the page's data loads again: the loaded threads, except the ones being deleted,
 * with the answer being written kept; then the cards the load doesn't know yet (asked on this page
 * after it began, or not sent).
 */
export function reloaded(
	cards: AiCard[],
	loaded: AiThreadWithMessages[],
	asked: ReadonlySet<string>,
	deleting: ReadonlySet<string>,
): AiCard[] {
	const local = new Map(cards.map((c) => [c.id, c]))
	const known = new Set(loaded.map((t) => t.id))
	return [
		...loaded
			.filter((t) => !deleting.has(t.id))
			.map((t): AiCard => {
				const card = local.get(t.id)
				if (card?.streaming) return { ...t, ...card }
				// A failure stays until the load brings something newer: the answer the server saved
				// after the stream broke, say.
				if (card?.failure && t.messages.at(-1)?.id === card.messages.at(-1)?.id)
					return { ...t, failure: card.failure }
				return t
			}),
		...cards.filter((c) => !known.has(c.id) && (isTempThread(c.id) || asked.has(c.id))),
	]
}

/**
 * A thread's turns once the server has taken its question: in place of the temporary one, or, for
 * a retry, the question already there (it is the same message), without the answer it replaces.
 */
export function withQuestion(messages: AiMessageView[], saved: AiMessageView): AiMessageView[] {
	const kept = messages.filter((m) => !m.id.startsWith("tmp-ai-"))
	const at = kept.findIndex((m) => m.id === saved.id)
	// A retry: the answer it replaces goes now that the server has taken it.
	return [...(at < 0 ? kept : kept.slice(0, at)), saved]
}

/** An answer as it is written: its text so far, and the citations given so far. */
export interface Written {
	text: string
	citations: AiCitation[]
}

/**
 * The answers being written, by thread, outside React state: each streamed piece re-renders only
 * the card that reads it (`useWritten`), not the reader with its article and margin.
 */
export function createAnswerStore() {
	let answers = new Map<string, Written>()
	const listeners = new Set<() => void>()
	const set = (id: string, next: Written | undefined) => {
		answers = new Map(answers)
		if (next) answers.set(id, next)
		else answers.delete(id)
		for (const listener of listeners) listener()
	}
	const at = (id: string) => answers.get(id) ?? { text: "", citations: [] }
	return {
		get: (id: string) => answers.get(id),
		write: (id: string, text: string) => set(id, { ...at(id), text: at(id).text + text }),
		cite: (id: string, citation: AiCitation) =>
			set(id, { ...at(id), citations: [...at(id).citations, citation] }),
		clear: (id: string) => {
			if (answers.has(id)) set(id, undefined)
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

export type AnswerStore = ReturnType<typeof createAnswerStore>

const NOTHING_WRITTEN: Written = { text: "", citations: [] }

/** What has been written of a thread's answer so far; re-renders as it grows. */
export function useWritten(store: AnswerStore, id: string): Written {
	return useSyncExternalStore(
		store.subscribe,
		() => store.get(id) ?? NOTHING_WRITTEN,
		() => NOTHING_WRITTEN,
	)
}
