import type { AiBrief, AiCitation, AiMessage, AiThread, AiThreadAction } from "@klipstack/db"

/** A thread as the reader shows it. Safe to import from client code. */
export interface AiThreadView {
	id: string
	action: AiThreadAction
	start: number
	end: number
	exact: string
	versionId: string
	highlightId: string | null
	orphaned: boolean
	createdAt: string
}

/** A turn as the reader shows it: no tokens or model. */
export interface AiMessageView {
	id: string
	role: "user" | "assistant"
	text: string
	status: "done" | "failed" | "refused"
	citations: AiCitation[]
	createdAt: string
}

export type AiThreadWithMessages = AiThreadView & { messages: AiMessageView[] }

export function threadView(thread: AiThread): AiThreadView {
	return {
		id: thread.id,
		action: thread.action,
		start: thread.startOffset,
		end: thread.endOffset,
		exact: thread.exact,
		versionId: thread.versionId,
		highlightId: thread.highlightId,
		orphaned: thread.orphaned,
		createdAt: thread.createdAt.toISOString(),
	}
}

export function messageView(message: AiMessage): AiMessageView {
	return {
		id: message.id,
		role: message.role,
		text: message.text,
		status: message.status,
		citations: message.citations,
		createdAt: message.createdAt.toISOString(),
	}
}

/** What the answer stream sends, one event per `data:` line (`routes/documents.ai.ts`). */
export type AiStreamEvent =
	| { type: "start"; thread: AiThreadView; question: AiMessageView }
	| { type: "text"; text: string }
	| { type: "citation"; citation: AiCitation }
	| { type: "answer"; message: AiMessageView }

/** A brief as the reader shows it. */
export interface AiBriefView {
	id: string
	versionId: string
	text: string
	citations: AiCitation[]
}

export function briefView(brief: AiBrief): AiBriefView {
	return { id: brief.id, versionId: brief.versionId, text: brief.text, citations: brief.citations }
}

/** What the brief stream sends: its text and citations as written, then the brief as kept. */
export type AiBriefEvent =
	| { type: "text"; text: string }
	| { type: "citation"; citation: AiCitation }
	| { type: "brief"; brief: AiBriefView | null }
