import { useCallback, useInsertionEffect, useRef, useState } from "react"
import { type AiFailure, requestBrief } from "~/lib/ai-stream.client"
import type { AiBriefView } from "~/lib/ai-threads"
import type { AiAllowanceState } from "./use-ai-allowance"
import { createAnswerStore } from "./use-ai-threads"

/** The store key of the brief being written. */
export const BRIEF = "brief"

/**
 * The article's brief: the one kept for the version on screen, or none until the reader asks. While
 * it is written its words go to `written`, so only the card re-renders. A new one counts as a
 * question (`allowance`).
 */
export function useBrief(
	documentId: string,
	versionId: string | null,
	loaded: AiBriefView | null,
	allowance?: Pick<AiAllowanceState, "take" | "refused" | "refusal">,
) {
	const [brief, setBrief] = useState(loaded)
	const [seen, setSeen] = useState(loaded)
	const [writing, setWriting] = useState(false)
	const [failure, setFailure] = useState<AiFailure | null>(null)
	// A kept brief starts collapsed; one just asked for opens.
	const [open, setOpen] = useState(false)
	const [written] = useState(createAnswerStore)
	const quota = useRef(allowance)
	useInsertionEffect(() => {
		quota.current = allowance
	})
	if (seen !== loaded) {
		setSeen(loaded)
		if (!writing) setBrief(loaded)
	}

	const make = useCallback(async () => {
		setWriting(true)
		setFailure(null)
		setOpen(true)
		written.clear(BRIEF)
		const none = quota.current?.refusal()
		const result = none
			? ({ ok: false, error: none } as const)
			: await requestBrief(documentId, (event) => {
					if (event.type === "allowance") quota.current?.take(event.allowance)
					else if (event.type === "text") written.write(BRIEF, event.text)
					else if (event.type === "citation") written.cite(BRIEF, event.citation)
					else if (event.brief) setBrief(event.brief)
					else setFailure({ code: "other" })
				})
		if (!result.ok) {
			quota.current?.refused(result.error)
			setFailure(result.error)
		}
		setWriting(false)
		written.clear(BRIEF)
	}, [documentId, written])

	return {
		// One written for an older version of the article is not shown.
		brief: brief && brief.versionId === versionId ? brief : null,
		writing,
		failure,
		open,
		setOpen,
		make,
		written,
	}
}
