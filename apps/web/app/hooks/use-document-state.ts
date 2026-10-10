import { useState } from "react"
import { useMutationQueue } from "~/hooks/use-mutation-queue"

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

/**
 * The reader's article state: star, the mark for the next edition, archive, finish, unread, delete
 * and retry. Changes go out one
 * at a time; the page shows them at once and keeps what the server answered, without loading the
 * article again (`shouldRevalidate` in `routes/read.tsx`). Finishing, marking unread and deleting
 * call `onLeave` once the server has them.
 */
export function useDocumentState(documentId: string, doc: DocumentFlags, onLeave: () => void) {
	const fromDocument = () => ({
		doc,
		shown: {
			starred: Boolean(doc.starredAt),
			shortlisted: Boolean(doc.shortlistedAt),
			archived: Boolean(doc.archivedAt),
			finished: Boolean(doc.readAt),
		},
	})
	const [confirmed, setConfirmed] = useState(fromDocument)
	// Loaded again (a live update, a retry): the server's row is the truth.
	if (confirmed.doc !== doc) setConfirmed(fromDocument())
	const queue = useMutationQueue<StateIntent, { ok: boolean }>({
		action: `/documents/${documentId}/state`,
		body: (intent) => ({ intent }),
		onSettled: (intent, answer) => {
			if (!answer?.ok) return
			setConfirmed((c) => ({ ...c, shown: apply(c.shown, intent) }))
			if (LEAVING.has(intent)) onLeave()
		},
	})
	return { ...queue.pending.reduce(apply, confirmed.shown), change: queue.submit }
}
