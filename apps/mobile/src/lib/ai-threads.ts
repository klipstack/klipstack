import type { AiCitation, AiMessage, AiThreadWithMessages } from "@klipstack/sdk"
import type { AiFailure, Written } from "./ai"

/**
 * The reader's AI threads on screen, as the web reader keeps them (`use-ai-threads.ts`): what the
 * server keeps, plus what is happening to each now. Pure: the hook is `useAiCards`.
 */

/** A passage to ask about: where it is in the text on the page. */
export interface AiPassage {
	exact: string
	prefix: string
	suffix: string
	start: number
	end: number
	versionId: string
}

/** What a draft offers above its question field, sent with one tap. */
export const DRAFT_CHOICES = ["explain", "define"] as const

/** A thread on screen. */
export interface AiCard extends AiThreadWithMessages {
	/** Not sent yet: its question field, with Explain and Define offered above it. */
	draft?: { question: string }
	/**
	 * The text around a passage asked about here, sent with its first question, and again if that
	 * one is refused before it began. The server keeps it once it takes the thread.
	 */
	around?: { prefix: string; suffix: string }
	/** An answer is being written: its words are in the `AnswerStore`. */
	streaming?: boolean
	/** Why the last question was not answered (a refusal before it began, or the network). */
	failure?: AiFailure
}

/**
 * Asking about a passage, before choosing how: a draft that sends nothing until the reader picks
 * Explain or Define, or sends a question. With no questions left, the card that says why.
 */
export function askCard(id: string, passage: AiPassage, none: boolean): AiCard {
	return {
		id,
		action: "ask",
		start: passage.start,
		end: passage.end,
		exact: passage.exact,
		versionId: passage.versionId,
		highlightId: null,
		orphaned: false,
		createdAt: new Date().toISOString(),
		messages: [],
		around: { prefix: passage.prefix, suffix: passage.suffix },
		...(none ? { failure: { code: "limit_reached" } } : { draft: { question: "" } }),
	}
}

/** A draft become an Explain or a Define, being answered. */
export function chosen(card: AiCard, action: (typeof DRAFT_CHOICES)[number]): AiCard {
	return { ...card, action, draft: undefined, messages: [tempQuestion("")], streaming: true }
}

/** The passage a new card asks about, with the text around it. */
export function passageOf(card: AiCard): AiPassage {
	return {
		exact: card.exact,
		prefix: card.around?.prefix ?? "",
		suffix: card.around?.suffix ?? "",
		start: card.start,
		end: card.end,
		versionId: card.versionId,
	}
}

/** Nothing asked yet (a draft, or none left this month): asking AI, how still to choose. */
export const unasked = (card: AiCard) =>
	!!card.draft || (card.action === "ask" && card.messages.length === 0)

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

/**
 * A question the server refused stays where it was asked, with the reason: a new thread's first
 * question or a follow-up. Answer Again asks it (`retryOf`); another follow-up takes its place
 * (`followingUp`). A follow-up cut off by the network may have reached the server, which keeps it:
 * it is not kept here, so Answer Again has the server answer it rather than send it twice.
 */
export function afterRefusal(card: AiCard, failure: AiFailure): AiCard {
	const unsure = failure.code === "network" && !isTempThread(card.id)
	return {
		...card,
		streaming: undefined,
		failure,
		messages: unsure ? card.messages.filter((m) => !isTempThread(m.id)) : card.messages,
	}
}

/** What Answer Again asks. */
export type Retry =
	/** A new thread refused before it began, with its question (an Ask's or the chat's). */
	| { kind: "first"; question: string }
	/** A new Explain or Define refused before it began. */
	| { kind: "passage" }
	/** A follow-up the server never took. */
	| { kind: "follow-up"; question: string }
	/** The server answers the thread's last question again. */
	| { kind: "retry" }

export function retryOf(card: AiCard): Retry {
	if (isTempThread(card.id))
		return card.action === "ask" || card.action === "chat"
			? { kind: "first", question: card.messages[0]?.text ?? "" }
			: { kind: "passage" }
	const last = card.messages.at(-1)
	if (last?.role === "user" && isTempThread(last.id))
		return { kind: "follow-up", question: last.text }
	return { kind: "retry" }
}

/** A thread's turns with a follow-up asked: in place of one refused before it. */
export function followingUp(messages: readonly AiMessage[], text: string): AiMessage[] {
	return [...messages.filter((m) => !isTempThread(m.id)), tempQuestion(text)]
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

/** A card for a passage refused before it began: nothing kept, nothing to show once it closes. */
export const refusedNew = (card: AiCard) =>
	isTempThread(card.id) && !!card.failure && !card.streaming
