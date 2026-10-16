import type { AiCitation, AiMessage, AiThreadWithMessages } from "@klipstack/sdk"
import type { AiFailure, Written } from "./ai"

/**
 * The reader's AI threads on screen, as the web reader keeps them (`use-ai-threads.ts`): what the
 * server keeps, plus what is happening to each now. Pure: the hook is `useAiCards`.
 */

/** A thread on screen. */
export interface AiCard extends AiThreadWithMessages {
	/** An Ask not sent yet: its question field. */
	draft?: { question: string }
	/** An answer is being written: its words are in the `AnswerStore`. */
	streaming?: boolean
	/** Why the last question was not answered (a refusal before it began, or the network). */
	failure?: AiFailure
}

let seq = 0
export const tempId = (kind: string) => `tmp-ai-${kind}-${++seq}`
export const isTempThread = (id: string) => id.startsWith("tmp-ai-")

/** A question not taken by the server yet. */
export function tempQuestion(text: string): AiMessage {
	return {
		id: tempId("q"),
		role: "user",
		text,
		status: "done",
		citations: [],
		createdAt: new Date().toISOString(),
	}
}

/**
 * A thread's turns once the server has taken its question: in place of the temporary one, or, for
 * a retry, the question already there (the same message), without the answer it replaces.
 */
export function withQuestion(messages: readonly AiMessage[], saved: AiMessage): AiMessage[] {
	const kept = messages.filter((m) => !isTempThread(m.id))
	const at = kept.findIndex((m) => m.id === saved.id)
	return [...(at < 0 ? kept : kept.slice(0, at)), saved]
}

/** A failed question is not kept, except a new chat's: it is all the card holds, and Try Again sends it. */
export function afterRefusal(card: AiCard, failure: AiFailure): AiCard {
	return {
		...card,
		streaming: undefined,
		failure,
		messages:
			card.action === "chat" && isTempThread(card.id)
				? card.messages
				: card.messages.filter((m) => !isTempThread(m.id)),
	}
}

/** What the card offers now. */
export function cardState(card: AiCard, none: boolean) {
	const busy = !!card.streaming
	const last = card.messages.at(-1)
	const lastAnswer = card.messages.findLast((m) => m.role === "assistant" && m.status === "done")
	return {
		busy,
		lastAnswer,
		// After an answer, or a question left without one (the answer was lost).
		canRetry: !busy && !card.draft && (!!last || !!card.failure) && !none,
		// A question still waiting for its answer takes no new one; nor a passage gone from the text.
		canFollowUp:
			!busy && !card.draft && !card.orphaned && !none && (last?.role !== "user" || !!card.failure),
	}
}

/**
 * The answers being written, by thread, outside React state: each piece re-renders only the card
 * that reads it, not the reader.
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
			return () => {
				listeners.delete(listener)
			}
		},
	}
}

export type AnswerStore = ReturnType<typeof createAnswerStore>
