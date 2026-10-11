import { createContext, useCallback, useContext, useInsertionEffect, useRef, useState } from "react"
import type { AiFailure } from "~/lib/ai-stream.client"
import { type AiAllowance, questionsLeft } from "~/lib/ai-threads"

/**
 * The account's AI questions this month, for the whole reader: from the page's data, then from each
 * answer (the server counts it), and at the cap when a question is refused for it.
 */
export function useAiAllowance(loaded: AiAllowance | null) {
	const [allowance, setAllowance] = useState(loaded)
	const [seen, setSeen] = useState(loaded)
	if (seen !== loaded) {
		setSeen(loaded)
		setAllowance(loaded)
	}
	const latest = useRef(allowance)
	useInsertionEffect(() => {
		latest.current = allowance
	})
	/** The count the server gave with an answer. */
	const take = useCallback((next: AiAllowance) => setAllowance(next), [])
	/** A refusal at the cap: none left, whatever the page thought. */
	const refused = useCallback((failure: AiFailure) => {
		if (failure.code !== "limit_reached") return
		setAllowance((now) => {
			const max = typeof failure.details?.max === "number" ? failure.details.max : now?.max
			const resetsAt =
				typeof failure.details?.resetsAt === "string" ? failure.details.resetsAt : now?.resetsAt
			return max === undefined || resetsAt === undefined ? now : { used: max, max, resetsAt }
		})
	}, [])
	/** None left: the refusal to show instead of sending a question the server would refuse. */
	const refusal = useCallback((): AiFailure | null => {
		const now = latest.current
		if (!now || !questionsLeft(now).none) return null
		return { code: "limit_reached", details: { max: now.max, resetsAt: now.resetsAt } }
	}, [])
	return { allowance, take, refused, refusal }
}

export type AiAllowanceState = ReturnType<typeof useAiAllowance>

/** The reader's allowance, for the cards and buttons that ask. Null without AI. */
export const AiAllowanceContext = createContext<AiAllowance | null>(null)

export const useQuestionsLeft = () => questionsLeft(useContext(AiAllowanceContext))
