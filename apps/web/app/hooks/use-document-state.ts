import { useEffect, useState } from "react"
import { useRevalidator } from "react-router"
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

type Flag = keyof Shown
const FLAGS: readonly Flag[] = ["starred", "shortlisted", "archived", "finished"]

/**
 * The article loaded again (a live update, a retry, opening it): the server's row is the truth,
 * except for a flag this page changed since the last load (`changed`) and the row disagrees with.
 * That load may have begun before the change landed (opening the article and marking it at once),
 * so the page keeps its value and asks again (`recheck`); the next answer is the truth.
 */
export function reloaded(
	confirmed: Shown,
	changed: readonly Flag[],
	now: Shown,
): { shown: Shown; recheck: boolean } {
	const kept = FLAGS.filter((flag) => changed.includes(flag) && now[flag] !== confirmed[flag])
	const shown = { ...now }
	for (const flag of kept) shown[flag] = confirmed[flag]
	return { shown, recheck: kept.length > 0 }
}

/**
 * The reader's article state: star, the mark for the next edition, archive, finish, unread, delete
 * and retry. Changes go out one
 * at a time; the page shows them at once and keeps what the server answered, without loading the
 * article again (`shouldRevalidate` in `routes/read.tsx`). Finishing, marking unread and deleting
 * call `onLeave` once the server has them.
 */
export function useDocumentState(documentId: string, doc: DocumentFlags, onLeave: () => void) {
	const [confirmed, setConfirmed] = useState(() => ({
		doc,
		shown: shownOf(doc),
		changed: [] as Flag[],
		recheck: false,
	}))
	const draftUndo = useDraftUndoToast()
	if (confirmed.doc !== doc)
		setConfirmed({
			doc,
			...reloaded(confirmed.shown, confirmed.changed, shownOf(doc)),
			changed: [],
		})
	const { revalidate } = useRevalidator()
	useEffect(() => {
		if (confirmed.recheck) void revalidate()
	}, [confirmed.doc, confirmed.recheck, revalidate])
	const queue = useMutationQueue<StateIntent, { ok: boolean; undo?: unknown }>({
		action: `/documents/${documentId}/state`,
		body: (intent) => ({ intent }),
		onSettled: (intent, answer) => {
			if (!answer?.ok) return
			setConfirmed((c) => {
				const shown = apply(c.shown, intent)
				const changed = FLAGS.filter((flag) => shown[flag] !== c.shown[flag])
				return { ...c, shown, changed: [...c.changed, ...changed], recheck: false }
			})
			draftUndo(answer)
			if (LEAVING.has(intent)) onLeave()
		},
	})
	return { ...queue.pending.reduce(apply, confirmed.shown), change: queue.submit }
}
