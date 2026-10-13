import { useState } from "react"
import { useMutationQueue } from "~/hooks/use-mutation-queue"
import { useDraftUndoToast } from "./use-draft-undo-toast"

export type StateIntent =
	| "star"
	| "unstar"
	| "shortlist"
	| "unshortlist"
	| "archive"
	| "unarchive"
	| "finish"
	| "unread"
	| "delete"
	| "retry"

interface DocumentFlags {
	starredAt: Date | string | null
	shortlistedAt: Date | string | null
	archivedAt: Date | string | null
	readAt: Date | string | null
}
interface Shown {
	starred: boolean
	shortlisted: boolean
	archived: boolean
	finished: boolean
}

/** Changes after which the reader has nothing left to show. */
const LEAVING: ReadonlySet<StateIntent> = new Set(["finish", "unread", "delete"])

function apply(shown: Shown, intent: StateIntent): Shown {
	switch (intent) {
		case "star":
		case "unstar":
			return { ...shown, starred: intent === "star" }
		case "shortlist":
		case "unshortlist":
			return { ...shown, shortlisted: intent === "shortlist" }
		case "archive":
		case "unarchive":
			return { ...shown, archived: intent === "archive" }
		case "finish":
			return { ...shown, finished: true, archived: true }
		default:
			return shown
	}
}

function shownOf(doc: DocumentFlags): Shown {
	return {
		starred: Boolean(doc.starredAt),
		shortlisted: Boolean(doc.shortlistedAt),
		archived: Boolean(doc.archivedAt),
		finished: Boolean(doc.readAt),
	}
}

/**
 * The article loaded again (a live update, a retry, opening it): what the server's row changed is
 * the truth. What it did not change stays as this page last confirmed it, since a load that began
 * before a change landed answers with the row from before it: opening the article and marking it
 * at once must not unmark it.
 */
export function reloaded(before: Shown, confirmed: Shown, now: Shown): Shown {
	const pick = (key: keyof Shown) => (now[key] !== before[key] ? now[key] : confirmed[key])
	return {
		starred: pick("starred"),
		shortlisted: pick("shortlisted"),
		archived: pick("archived"),
		finished: pick("finished"),
	}
}

/**
 * The reader's article state: star, the mark for the next edition, archive, finish, unread, delete
 * and retry. Changes go out one
 * at a time; the page shows them at once and keeps what the server answered, without loading the
 * article again (`shouldRevalidate` in `routes/read.tsx`). Finishing, marking unread and deleting
 * call `onLeave` once the server has them.
 */
export function useDocumentState(documentId: string, doc: DocumentFlags, onLeave: () => void) {
	const [confirmed, setConfirmed] = useState(() => ({ doc, shown: shownOf(doc) }))
	const draftUndo = useDraftUndoToast()
	if (confirmed.doc !== doc)
		setConfirmed({ doc, shown: reloaded(shownOf(confirmed.doc), confirmed.shown, shownOf(doc)) })
	const queue = useMutationQueue<StateIntent, { ok: boolean; undo?: unknown }>({
		action: `/documents/${documentId}/state`,
		body: (intent) => ({ intent }),
		onSettled: (intent, answer) => {
			if (!answer?.ok) return
			setConfirmed((c) => ({ ...c, shown: apply(c.shown, intent) }))
			draftUndo(answer)
			if (LEAVING.has(intent)) onLeave()
		},
	})
	return { ...queue.pending.reduce(apply, confirmed.shown), change: queue.submit }
}
