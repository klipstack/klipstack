import type { TextSelector } from "@klipstack/anchor"
import type { Highlight } from "@klipstack/db"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useMutationQueue } from "~/hooks/use-mutation-queue"
import { DEFAULT_HIGHLIGHT_COLOR } from "~/lib/highlight-colors"
import type { WebResult } from "~/lib/web-result"

export type HighlightChange =
	| { intent: "create"; tempId: string; selector: TextSelector }
	| { intent: "update"; id: string; note?: string; color?: number }
	| { intent: "delete"; id: string }

type Answer = WebResult<{ highlight?: Highlight }>

/** How long a refused change says so. */
const FAILURE_MS = 4000

/** A just-made highlight has this id until the server gives it one. */
export const isTemporary = (id: string) => id.startsWith("tmp-")

function withChange(items: Highlight[], change: HighlightChange, documentId: string): Highlight[] {
	switch (change.intent) {
		case "create": {
			const { selector } = change
			const now = new Date()
			return [
				...items,
				{
					id: change.tempId,
					documentId,
					userId: "",
					versionId: "",
					startOffset: selector.start,
					endOffset: selector.end,
					exact: selector.exact,
					prefix: selector.prefix,
					suffix: selector.suffix,
					color: DEFAULT_HIGHLIGHT_COLOR,
					note: null,
					orphaned: false,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			]
		}
		case "update":
			return items.map((h) =>
				h.id !== change.id
					? h
					: {
							...h,
							...(change.note !== undefined ? { note: change.note.trim() || null } : {}),
							...(change.color !== undefined ? { color: change.color } : {}),
						},
			)
		case "delete":
			return items.filter((h) => h.id !== change.id)
	}
}

/** The refusals the reader tells apart (`highlights.errors.*`); any other means the quote was not found. */
const highlightError = (code: string): "ambiguous" | "network" | "not_ready" | "no_match" =>
	code === "ambiguous_quote"
		? "ambiguous"
		: code === "network" || code === "not_ready"
			? code
			: "no_match"

const saved = (items: Highlight[], highlight: Highlight) =>
	items.some((h) => h.id === highlight.id)
		? items.map((h) => (h.id === highlight.id ? highlight : h))
		: [...items, highlight]

/**
 * The reader's highlights: the ones the server has confirmed, with the changes still on their way
 * already applied. The server's answer to each change is the truth, so the article does not load
 * again after one (`shouldRevalidate` in `routes/read.tsx`); a refused change just drops out, and
 * `error` says why for a few seconds. When the page's data loads again, its list starts over.
 */
export function useHighlightList(documentId: string, loaded: Highlight[]) {
	const [confirmed, setConfirmed] = useState(loaded)
	const [seen, setSeen] = useState(loaded)
	if (seen !== loaded) {
		setSeen(loaded)
		setConfirmed(loaded)
	}
	const [failure, setFailure] = useState<{ error: string } | null>(null)
	useEffect(() => {
		if (!failure) return
		const timer = window.setTimeout(() => setFailure(null), FAILURE_MS)
		return () => window.clearTimeout(timer)
	}, [failure])

	const queue = useMutationQueue<HighlightChange, Answer>({
		action: `/documents/${documentId}/highlights`,
		encType: "application/json",
		body: (change) => {
			if (change.intent !== "create") return change
			return { intent: "create", ...change.selector }
		},
		onSettled: (change, answer) => {
			if (!answer?.ok) setFailure({ error: answer?.error.code ?? "network" })
			else if (change.intent === "delete")
				setConfirmed((prev) => prev.filter((h) => h.id !== change.id))
			else if (answer.highlight) {
				const { highlight } = answer
				setConfirmed((prev) => saved(prev, highlight))
			}
		},
	})
	const confirm = useCallback(
		(highlight: Highlight) => setConfirmed((prev) => saved(prev, highlight)),
		[],
	)
	const { pending } = queue
	const items = useMemo(
		() => pending.reduce((list, change) => withChange(list, change, documentId), confirmed),
		[pending, confirmed, documentId],
	)
	const error = failure ? highlightError(failure.error) : null

	return { items, change: queue.submit, confirm, pending: pending.length > 0, error }
}
